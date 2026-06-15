/**
 * Unified outbound-message drainer (2026-05-19).
 *
 * Single consumer of the outbound_messages queue. Enforces the
 * coordinator rules that the previous parallel-writers architecture
 * lacked (which caused the 2026-05-18 "Iris digest interrupted Devon's
 * question" bug):
 *
 *   1. PRIORITY ROUTING
 *      - urgent → send immediately, no hold
 *      - chat_reply → send immediately (rare in this queue — chat
 *        usually bypasses, but if it ends up here we still ship fast)
 *      - digest → eligible for hold + merge
 *
 *   2. ACTIVE-CHAT HOLD
 *      Before sending a digest, check the tenant's
 *      whatsapp_contexts row:
 *        - last_owner_message_at (owner just texted)
 *        - last_assistant_message_at (Iris just replied)
 *      If EITHER is within 60s → defer 5min so we don't interrupt
 *      a live exchange.
 *
 *   3. MERGE
 *      When multiple pending digests exist for the same tenant,
 *      merge them into one combined send (preserves all content but
 *      doesn't blast the owner with N WhatsApps).
 *
 * Runs every minute. Reactivates 'deferred' rows whose deferred_until
 * has passed. Idempotent on the row id (state machine: pending →
 * sent | deferred | failed | merged).
 */

import { NextResponse } from 'next/server';
import { deliverOutboundFromQueue, type OwnerMessageSource } from '../../_lib/owner-message';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

// Active-chat hold window: digests don't ship if owner activity is
// inside this window. 60s keeps natural conversations uninterrupted
// without delaying digests when the owner has actually walked away.
const ACTIVE_CHAT_WINDOW_SECONDS = 60;
// How long to defer when we hold. Cron runs every minute, so 5min
// gives the conversation room to finish without spinning.
const DEFER_MINUTES = 5;

interface OutboundRow {
  id: string;
  tenant_phone: string;
  priority: 'chat_reply' | 'urgent' | 'digest';
  body: string;
  source: string;
  media: { type: 'video' | 'image' | 'document'; url: string; filename?: string } | null;
  status: 'pending' | 'deferred' | 'sent' | 'failed' | 'merged';
  deferred_until: string | null;
  created_at: string;
  metadata: Record<string, unknown>;
}

export async function GET(request: Request) {
  // Same dual-auth pattern as the other crons.
  const cronSecret = process.env.CRON_SECRET;
  const ownerToken = process.env.OWNER_API_TOKEN;
  const auth = request.headers.get('authorization');
  if (cronSecret || ownerToken) {
    const validCron = cronSecret && auth === `Bearer ${cronSecret}`;
    const validOwner = ownerToken && auth === `Bearer ${ownerToken}`;
    if (!validCron && !validOwner) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  } else {
    console.warn('[outbound-drainer] WARNING: neither CRON_SECRET nor OWNER_API_TOKEN set.');
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  try {
    // 1. Reactivate deferred rows whose hold has expired.
    const nowIso = new Date().toISOString();
    const reactivateRes = await fetch(
      `${SUPABASE_URL}/rest/v1/outbound_messages?status=eq.deferred&deferred_until=lte.${nowIso}`,
      {
        method: 'PATCH',
        headers: { ...headers(), Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'pending', deferred_until: null }),
      },
    );
    if (!reactivateRes.ok) {
      console.warn('[outbound-drainer] reactivate-deferred failed:', reactivateRes.status);
    }

    // 2. Fetch pending rows. Order: urgent first, then chat_reply, then
    //    digest. Within priority, oldest first.
    const pendingRes = await fetch(
      `${SUPABASE_URL}/rest/v1/outbound_messages?status=eq.pending&select=id,tenant_phone,priority,body,source,media,status,deferred_until,created_at,metadata&order=created_at.asc&limit=200`,
      { headers: headers() },
    );
    if (!pendingRes.ok) {
      return NextResponse.json({ error: `read pending failed: ${pendingRes.status}` }, { status: 500 });
    }
    const pending: OutboundRow[] = await pendingRes.json();

    // 3. Group by tenant_phone for active-chat checks + digest merging.
    const byTenant = new Map<string, OutboundRow[]>();
    for (const row of pending) {
      if (!byTenant.has(row.tenant_phone)) byTenant.set(row.tenant_phone, []);
      byTenant.get(row.tenant_phone)!.push(row);
    }

    let sent = 0;
    let deferred = 0;
    let merged = 0;
    let failed = 0;

    // Lazy-import mute helper (matches daily-briefing / digest / email-sift
    // pattern). Other crons honor mute; the drainer didn't, which let
    // queued messages (workflow results, briefings, etc) bypass an
    // explicit mute. 2026-05-23 — Devon at the pool muted himself for
    // 120 min via mute_assistant; the 10:23 Tasklet-followup message
    // bypassed because the drainer never checked.
    const { isMuted } = await import('../../_lib/mute-state');

    for (const [tenantPhone, rows] of byTenant) {
      // Mute check FIRST — if owner is muted, defer everything (don't
      // send, don't merge, don't lose). Urgent messages still go through
      // because the only way to escape an active mute is explicit owner
      // override, but if the owner asked for quiet, even urgent items
      // should defer (they're queued, so they don't get lost — just
      // wait for the mute to expire).
      try {
        const mute = await isMuted(tenantPhone);
        if (mute?.muted) {
          // Defer every pending row for this tenant until the mute expires.
          const deferUntil = mute.until
            ? new Date(mute.until).toISOString()
            : new Date(Date.now() + DEFER_MINUTES * 60_000).toISOString();
          for (const r of rows) {
            await fetch(`${SUPABASE_URL}/rest/v1/outbound_messages?id=eq.${r.id}`, {
              method: 'PATCH',
              headers: { ...headers(), Prefer: 'return=minimal' },
              body: JSON.stringify({ status: 'deferred', deferred_until: deferUntil }),
            });
            deferred++;
          }
          console.log(`[outbound-drainer] ${tenantPhone} muted (${mute.reason ?? 'no reason'}), deferred ${rows.length} message(s) until ${deferUntil}`);
          continue;
        }
      } catch (err) {
        console.warn(`[outbound-drainer] mute check failed for ${tenantPhone}, proceeding:`, err);
      }

      // Active-chat check: pull the tenant's last_owner_message_at +
      // last_assistant_message_at. last_seen is the owner-side
      // timestamp updated on every inbound webhook.
      let activeChat = false;
      try {
        const ctxRes = await fetch(
          `${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${tenantPhone}&select=last_seen,last_assistant_message_at`,
          { headers: headers() },
        );
        if (ctxRes.ok) {
          const ctxRows = await ctxRes.json();
          const ctx = ctxRows?.[0];
          const cutoffMs = Date.now() - ACTIVE_CHAT_WINDOW_SECONDS * 1000;
          const ownerActive = ctx?.last_seen && new Date(ctx.last_seen).getTime() > cutoffMs;
          const assistantActive =
            ctx?.last_assistant_message_at &&
            new Date(ctx.last_assistant_message_at).getTime() > cutoffMs;
          activeChat = !!(ownerActive || assistantActive);
        }
      } catch {
        // Best-effort — if we can't read the context, fall through and
        // attempt delivery anyway. Worse to silently swallow real
        // messages than to interrupt one chat.
      }

      // Partition by priority. urgent + chat_reply ignore activeChat.
      const urgent = rows.filter((r) => r.priority === 'urgent' || r.priority === 'chat_reply');
      const digests = rows.filter((r) => r.priority === 'digest');

      // Deliver urgent / chat_reply rows individually.
      for (const r of urgent) {
        const res = await deliverOne(r);
        if (res === 'sent') sent++;
        else if (res === 'deferred') deferred++;
        else failed++;
      }

      // Digest path: if active chat, defer ALL digests for this tenant.
      if (digests.length > 0 && activeChat) {
        const newDeferredUntil = new Date(Date.now() + DEFER_MINUTES * 60_000).toISOString();
        for (const r of digests) {
          await fetch(`${SUPABASE_URL}/rest/v1/outbound_messages?id=eq.${r.id}`, {
            method: 'PATCH',
            headers: { ...headers(), Prefer: 'return=minimal' },
            body: JSON.stringify({ status: 'deferred', deferred_until: newDeferredUntil }),
          });
          deferred++;
        }
        continue;
      }

      // Digest path: not active chat. Send. If multiple pending, merge
      // into a single combined send and mark the absorbed rows.
      if (digests.length === 0) continue;
      if (digests.length === 1) {
        const res = await deliverOne(digests[0]!);
        if (res === 'sent') sent++;
        else if (res === 'deferred') deferred++;
        else failed++;
      } else {
        // Merge: build a single body listing all pending digests.
        // Format: "## <source>\n<body>" per piece, separated by blank line.
        const mergedBody = digests
          .map((r) => `${formatSourceHeader(r.source)}${r.body}`)
          .join('\n\n');
        const mergedSource = (digests[0]!.source as OwnerMessageSource) ?? 'digest';
        // Send the merged content using the FIRST digest's row as the
        // "primary" — its id will be marked sent. The others get
        // status='merged' with merged_into pointing at the primary.
        const primary = digests[0]!;
        // Full merged body — no 4096 slice. deliverOutboundFromQueue chunks
        // it into sequential sends, so absorbed rows aren't silently lost past
        // the limit (they used to be sliced off AND marked 'merged' = gone).
        const res = await deliverOne({ ...primary, body: mergedBody });
        if (res === 'sent') {
          sent++;
          merged += digests.length - 1;
          // Mark the absorbed rows
          for (const r of digests.slice(1)) {
            await fetch(`${SUPABASE_URL}/rest/v1/outbound_messages?id=eq.${r.id}`, {
              method: 'PATCH',
              headers: { ...headers(), Prefer: 'return=minimal' },
              body: JSON.stringify({
                status: 'merged',
                merged_into: primary.id,
              }),
            });
          }
        } else if (res === 'deferred') {
          // Primary deferred for retry; absorbed rows stay 'pending' and
          // re-merge on the next drain — nothing lost.
          deferred++;
        } else {
          failed++;
        }
        // Suppress unused-variable warning when source isn't read
        void mergedSource;
      }
    }

    console.log(
      `[outbound-drainer] pending=${pending.length} sent=${sent} merged=${merged} deferred=${deferred} failed=${failed}`,
    );

    return NextResponse.json({
      ok: true,
      pending_seen: pending.length,
      sent,
      merged_into_others: merged,
      deferred,
      failed,
      active_chat_window_seconds: ACTIVE_CHAT_WINDOW_SECONDS,
      defer_minutes: DEFER_MINUTES,
    });
  } catch (err: any) {
    console.error('[outbound-drainer] error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// A transient Graph hiccup must not permanently lose the deliverable. Retry
// via the existing 'deferred' reactivation (no schema change — attempts ride
// in metadata) with backoff, and only mark 'failed' after exhausting them.
const MAX_DELIVERY_ATTEMPTS = 4;

async function deliverOne(row: OutboundRow): Promise<'sent' | 'failed' | 'deferred'> {
  const result = await deliverOutboundFromQueue({
    tenantPhone: row.tenant_phone,
    body: row.body,
    source: row.source as OwnerMessageSource,
    media: row.media ?? undefined,
  });
  if (result.ok) {
    await fetch(`${SUPABASE_URL}/rest/v1/outbound_messages?id=eq.${row.id}`, {
      method: 'PATCH',
      headers: { ...headers(), Prefer: 'return=minimal' },
      body: JSON.stringify({
        status: 'sent',
        sent_at: new Date().toISOString(),
        whatsapp_message_id: result.messageId ?? null,
      }),
    });
    return 'sent';
  }

  const priorAttempts = typeof row.metadata?.delivery_attempts === 'number' ? row.metadata.delivery_attempts : 0;
  const attempts = priorAttempts + 1;
  if (attempts < MAX_DELIVERY_ATTEMPTS) {
    const backoffMin = Math.min(30, 2 ** attempts); // 2, 4, 8 min
    const deferUntil = new Date(Date.now() + backoffMin * 60_000).toISOString();
    await fetch(`${SUPABASE_URL}/rest/v1/outbound_messages?id=eq.${row.id}`, {
      method: 'PATCH',
      headers: { ...headers(), Prefer: 'return=minimal' },
      body: JSON.stringify({
        status: 'deferred',
        deferred_until: deferUntil,
        metadata: { ...row.metadata, delivery_attempts: attempts, last_error: result.error?.slice(0, 500) ?? 'unknown' },
      }),
    });
    console.warn(`[outbound-drainer] deferred ${row.id} (attempt ${attempts}/${MAX_DELIVERY_ATTEMPTS}, retry in ${backoffMin}m): ${result.error?.slice(0, 200)}`);
    return 'deferred';
  }

  // Exhausted — mark failed AND make it loud (don't lose content silently).
  console.error(`[outbound-drainer] PERMANENT delivery failure for ${row.id} after ${attempts} attempts (source=${row.source}): ${result.error}`);
  await fetch(`${SUPABASE_URL}/rest/v1/outbound_messages?id=eq.${row.id}`, {
    method: 'PATCH',
    headers: { ...headers(), Prefer: 'return=minimal' },
    body: JSON.stringify({
      status: 'failed',
      last_error: result.error?.slice(0, 1000) ?? 'unknown',
      metadata: { ...row.metadata, delivery_attempts: attempts },
    }),
  });
  return 'failed';
}

function formatSourceHeader(source: string): string {
  // Cron sources sometimes already format their own headers, but for
  // merged sends from multiple sources we prefix a small label so the
  // owner sees which digest produced which slice. Lowercase + simple.
  const labels: Record<string, string> = {
    'daily-briefing': '🌅 Daily briefing\n',
    'digest': '📋 Digest\n',
    'email-sift': '📧 Email summary\n',
    'email-followup': '↩ Follow-ups\n',
    'calendar-sync': '📅 Calendar\n',
    'marketing-loop': '📊 Marketing\n',
    'agent-tick': '🤖 Agent update\n',
  };
  return labels[source] ?? '';
}

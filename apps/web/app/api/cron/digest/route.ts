/**
 * Scheduled digest drain — runs at 12:00 and 17:00 UTC.
 *
 * Pulls pending notifications off the queue, builds ONE structured
 * "Important / Worth a glance / FYI" WhatsApp message per tenant, and
 * marks the items delivered. Honors mute. Skips silently if the queue
 * is empty for a tenant.
 *
 * Morning digest (07:00) is handled by /api/cron/daily-briefing which
 * combines the overnight narrative with the queue drain.
 */

import { NextResponse } from 'next/server';
import {
  loadPending,
  markDelivered,
  expireStaleNotifications,
  synthesizeStructuredDigest,
} from '../../_lib/notifications';
import { isMuted } from '../../_lib/mute-state';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const WHATSAPP_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const GRAPH_API = 'https://graph.facebook.com/v25.0';

async function loadOrchestratorName(tenantPhone: string): Promise<string> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return 'Sophia';
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_configs?tenant_phone=eq.${tenantPhone}&select=agent_name,config&order=created_at.asc`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
    );
    const rows = res.ok ? await res.json() : [];
    const orch = rows.find((r: any) => r.config?.category === 'orchestrator');
    return orch?.agent_name ?? rows[0]?.agent_name ?? 'Sophia';
  } catch {
    return 'Sophia';
  }
}

async function sendWhatsApp(to: string, message: string): Promise<string | null> {
  if (!WHATSAPP_PHONE_ID || !WHATSAPP_TOKEN) return null;
  try {
    const res = await fetch(`${GRAPH_API}/${WHATSAPP_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: message },
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.messages?.[0]?.id ?? null;
  } catch (err) {
    console.warn('[digest] send failed:', err);
    return null;
  }
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  // Sweep stale items first so they don't stack up
  const expired = await expireStaleNotifications();

  // Find every tenant that has at least one pending notification
  const pendingRes = await fetch(
    `${SUPABASE_URL}/rest/v1/notification_queue?status=eq.pending&select=tenant_phone`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
  );
  const pending: { tenant_phone: string }[] = pendingRes.ok ? await pendingRes.json() : [];
  const tenantSet = Array.from(new Set(pending.map((p) => p.tenant_phone)));

  let sent = 0;
  let muted = 0;
  let empty = 0;
  let noSignal = 0;

  for (const tenantPhone of tenantSet) {
    try {
      const mute = await isMuted(tenantPhone);
      if (mute.muted) {
        console.log(`[digest] ${tenantPhone} muted, holding queue (${mute.reason ?? 'no reason'})`);
        muted++;
        continue;
      }

      const items = await loadPending(tenantPhone);
      if (items.length === 0) { empty++; continue; }

      const orchestratorName = await loadOrchestratorName(tenantPhone);
      const synth = await synthesizeStructuredDigest({
        orchestratorName,
        notifications: items,
        recentAgentRuns: [],
      });
      if (!synth.hasSignal) { noSignal++; continue; }

      const messageId = await sendWhatsApp(tenantPhone, synth.message);
      await markDelivered(synth.deliveredIds, messageId ?? undefined);
      sent++;
      console.log(`[digest] ${tenantPhone}: bundled ${items.length} item${items.length === 1 ? '' : 's'} into one message`);
    } catch (err) {
      console.warn(`[digest] tenant ${tenantPhone} failed:`, err);
    }
  }

  return NextResponse.json({
    ok: true,
    tenants_with_queue: tenantSet.length,
    sent,
    muted,
    empty,
    noSignal,
    expired,
  });
}

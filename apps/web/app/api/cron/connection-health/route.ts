/**
 * Connection Health cron — daily scan of oauth_connections for two
 * security-relevant signals:
 *
 *   1. Token rotation reminders — any connection whose access_token
 *      hasn't been rotated in 90+ days gets surfaced. Owner can
 *      reconnect to refresh credentials. Reduces blast radius if a
 *      token leaks.
 *
 *   2. Connection hijack detection — same account_email connected to
 *      multiple tenant phone numbers. In normal use a single Google
 *      account belongs to one tenant; the cross-tenant case is either
 *      a sharing arrangement we should know about OR a legitimate
 *      anomaly worth surfacing.
 *
 * Both findings emit governance.bypass / compliance.profile_change
 * audit log entries plus a notification queued to the owner via
 * sendOwnerMessage so it lands in the next morning brief.
 *
 * Schedule: 0 4 * * *  (4am UTC daily). Cheap — single SELECT, in-memory
 * dedup, then per-finding audit + notify.
 */

import { NextResponse } from 'next/server';
import { logAuditEvent } from '../../_lib/audit-log';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ROTATION_REMINDER_DAYS = 90;

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
});

interface OauthRow {
  phone_number: string;
  provider: string;
  service: string;
  account_email: string | null;
  status: string;
  created_at: string;
  last_rotated_at: string | null;
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) return new Response('Unauthorized', { status: 401 });
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/oauth_connections?status=eq.active&select=phone_number,provider,service,account_email,status,created_at,last_rotated_at`,
      { headers: headers() },
    );
    if (!res.ok) return NextResponse.json({ error: `load failed: ${res.status}` }, { status: 500 });
    const rows: OauthRow[] = await res.json();

    const cutoff = Date.now() - ROTATION_REMINDER_DAYS * 24 * 60 * 60 * 1000;

    // ─── 1. Rotation reminders ────────────────────────────────────────────
    // Pick the freshest timestamp per row (last_rotated_at OR created_at).
    // Group reminders per tenant so the owner gets ONE message listing all
    // their stale connections rather than N separate pings.
    const stalePerTenant = new Map<string, Array<{ provider: string; service: string; ageDays: number }>>();
    for (const row of rows) {
      const fresh = new Date(row.last_rotated_at ?? row.created_at).getTime();
      if (fresh > cutoff) continue;
      const ageDays = Math.floor((Date.now() - fresh) / (24 * 60 * 60 * 1000));
      const list = stalePerTenant.get(row.phone_number) ?? [];
      list.push({ provider: row.provider, service: row.service, ageDays });
      stalePerTenant.set(row.phone_number, list);
    }

    let staleNotifications = 0;
    for (const [tenantPhone, stale] of stalePerTenant) {
      void logAuditEvent({
        tenantPhone,
        actor: 'connection-health-cron',
        actorType: 'system',
        action: 'compliance.profile_change',
        resource: 'oauth_connections',
        outcome: 'success',
        payload: {
          detector: 'rotation_reminder',
          stale_count: stale.length,
          stale_connections: stale,
        },
        redact: false,
      });
      // Surface to owner via the morning-brief notification queue (not a
      // direct WhatsApp push — the cron runs at 4am, owner's asleep).
      try {
        const { enqueueNotification } = await import('../../_lib/notifications');
        const lines = stale.map((s) => `  - ${s.provider}/${s.service} (${s.ageDays} days old)`).join('\n');
        await enqueueNotification({
          tenantPhone,
          kind: 'agent_observation',
          severity: 'low',
          title: `${stale.length} connection${stale.length === 1 ? '' : 's'} due for rotation`,
          body: `These tokens haven't been refreshed in 90+ days. Reconnecting in the deck mints fresh tokens, reducing risk if any of them ever leaks:\n${lines}`,
          sourceAgent: 'connection-health-cron',
          metadata: { detector: 'rotation_reminder', stale_connections: stale },
        });
        staleNotifications++;
      } catch (err) {
        console.warn('[connection-health] notification enqueue failed:', err);
      }
    }

    // ─── 2. Hijack detection — same account across tenants ─────────────
    // Group by (provider, account_email) and report any group with > 1
    // distinct tenant phone. Skip rows with no email since those can't be
    // matched.
    const acctMap = new Map<string, Set<string>>();
    for (const row of rows) {
      if (!row.account_email) continue;
      const key = `${row.provider}|${row.account_email.toLowerCase()}`;
      const set = acctMap.get(key) ?? new Set();
      set.add(row.phone_number);
      acctMap.set(key, set);
    }

    const hijackFindings: Array<{ provider: string; account_email: string; tenants: string[] }> = [];
    for (const [key, tenants] of acctMap) {
      if (tenants.size <= 1) continue;
      const [provider, account_email] = key.split('|');
      hijackFindings.push({
        provider: provider!,
        account_email: account_email!,
        tenants: [...tenants],
      });
      // Audit per-tenant so each affected tenant has the finding in their
      // own audit chain.
      for (const tenantPhone of tenants) {
        void logAuditEvent({
          tenantPhone,
          actor: 'connection-health-cron',
          actorType: 'system',
          action: 'governance.bypass',
          resource: 'oauth_connections',
          outcome: 'failure',
          payload: {
            detector: 'multi_tenant_account',
            provider,
            account_email,
            other_tenants: [...tenants].filter((t) => t !== tenantPhone),
          },
          redact: false,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      scanned_at: new Date().toISOString(),
      total_connections: rows.length,
      stale_tenants: stalePerTenant.size,
      stale_notifications_sent: staleNotifications,
      hijack_findings: hijackFindings.length,
      hijack_sample: hijackFindings.slice(0, 10),
    });
  } catch (err: any) {
    console.error('[connection-health] error:', err);
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}

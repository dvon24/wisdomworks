/**
 * Deferred-delegation drainer — the auto-resume half of the spend-cap recovery
 * door (see _lib/deferred-delegations.ts + 2026-06-06-deferred-delegations.sql).
 *
 * Every few minutes: load pending queued delegations, and for each tenant that
 * is now BACK UNDER the daily spend cap, run the real delegation through the
 * normal executeTool(delegate_to_agent) path and notify the owner with the
 * result. Tenants still over cap are left pending (they drain at the next UTC
 * midnight rollover, when spend resets). The owner can also force-run early via
 * the run_queued_delegations tool ("run it now").
 *
 * Bounded: at most MAX_PER_RUN delegations per invocation so a backlog of heavy
 * worker loops can't exceed maxDuration — the next run picks up the rest.
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_PER_RUN = 5;

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
  }

  const { loadPendingDeferred, runOneDeferred } = await import('../../_lib/deferred-delegations');
  const pending = await loadPendingDeferred(undefined, 100);
  if (pending.length === 0) return NextResponse.json({ ok: true, pending: 0, ran: 0 });

  const { getDailySpend } = await import('../../_lib/spend-cap');
  const { executeTool } = await import('../../webhooks/whatsapp/agent-tools');
  const { loadConnectionsForPhone } = await import('@wisdomworks/shared');
  const { loadUserContext } = await import('../../webhooks/whatsapp/context-store');
  const { sendOwnerMessage } = await import('../../_lib/owner-message');

  // Group by tenant so we check the cap + load context once per tenant.
  const byTenant = new Map<string, typeof pending>();
  for (const row of pending) {
    const arr = byTenant.get(row.tenant_phone) ?? [];
    arr.push(row);
    byTenant.set(row.tenant_phone, arr);
  }

  let ran = 0;
  let skipped = 0;
  for (const [tenant, rows] of byTenant) {
    if (ran >= MAX_PER_RUN) break; // budget the run; next invocation continues

    // Only auto-run once the tenant is BACK under the cap. Fail-open: if the
    // spend check errors, skip this tenant this round (don't risk over-spending).
    let over = true;
    try {
      over = (await getDailySpend(tenant)).over;
    } catch {
      over = true;
    }
    if (over) { skipped += rows.length; continue; }

    let connections: any[] = [];
    let user: any = null;
    try {
      connections = await loadConnectionsForPhone(tenant);
      user = await loadUserContext(tenant, 'WisdomWorks');
    } catch (err) {
      console.warn('[deferred-drainer] context load failed for', tenant, err);
      continue;
    }
    if (!user) continue;

    const results: string[] = [];
    for (const row of rows) {
      if (ran >= MAX_PER_RUN) break;
      const r = await runOneDeferred(row, { executeTool, connections, user });
      ran++;
      results.push(r.ok
        ? `From ${row.target_agent}:\n${r.content.slice(0, 800)}`
        : `⚠️ ${row.target_agent} couldn't complete the queued task: ${r.content.slice(0, 200)}`);
    }

    if (results.length > 0) {
      await sendOwnerMessage({
        tenantPhone: tenant,
        body: `✅ Budget reset — I ran the ${results.length} task${results.length === 1 ? '' : 's'} you had queued:\n\n${results.join('\n\n')}`,
        source: 'deferred-delegation',
      }).catch((e) => console.warn('[deferred-drainer] owner notify failed:', e));
    }
  }

  return NextResponse.json({ ok: true, pending: pending.length, ran, skipped });
}

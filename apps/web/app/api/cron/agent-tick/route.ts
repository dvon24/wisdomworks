/**
 * Story 2.1 — Agent tick cron.
 *
 * Wakes every running agent every 15 minutes (schedule lives in vercel.json).
 * Each tick runs the agent's primary loop placeholder and logs a row to
 * agent_runs. Foundation for the full LangGraph runtime in 2.1b.
 */

import { NextResponse } from 'next/server';
import { tickRunningAgents } from '../../_lib/agent-runtime';
import { computeMonthlyUsage, evaluateBudget, enforceBudgetCap } from '../../_lib/usage-tracker';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

export async function GET(request: Request) {
  // Vercel sets this header on cron requests; reject anything else in prod.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  try {
    const result = await tickRunningAgents();
    console.log(`[agent-tick] tenants=${result.tenants} ticked=${result.ticked} failed=${result.failed}`);

    // Hard cap enforcement — after the tick, scan every tenant we just
    // ticked and pause anyone who's now over budget for the month.
    if (SUPABASE_URL && SUPABASE_KEY) {
      const tenantsRes = await fetch(
        `${SUPABASE_URL}/rest/v1/agent_instances?status=eq.running&select=tenant_phone`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
      );
      const tenantRows = tenantsRes.ok ? await tenantsRes.json() : [];
      const uniqueTenants = Array.from(new Set(tenantRows.map((r: any) => r.tenant_phone)));
      let pausedTenants = 0;
      for (const tenant of uniqueTenants) {
        const usage = await computeMonthlyUsage(tenant as string);
        if (!usage) continue;
        const specRes = await fetch(
          `${SUPABASE_URL}/rest/v1/tenant_configs?tenant_phone=eq.${tenant}&config_type=eq.deployment_spec&select=config`,
          { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
        );
        const specRows = specRes.ok ? await specRes.json() : [];
        const monthlyBudget = specRows[0]?.config?.pricing?.monthlyBase ?? 50;
        const budget = evaluateBudget(usage, monthlyBudget);
        if (budget.status === 'exceeded') {
          const enforce = await enforceBudgetCap(tenant as string, budget);
          if (enforce.pausedCount > 0) pausedTenants++;
        }
      }
      if (pausedTenants > 0) console.log(`[agent-tick] paused ${pausedTenants} over-budget tenant(s)`);
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[agent-tick] error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

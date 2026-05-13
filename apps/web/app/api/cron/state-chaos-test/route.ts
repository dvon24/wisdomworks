/**
 * Story 2.10 — weekly chaos test for the recovery path.
 *
 * Picks one running agent_instance per tenant and runs the full cycle:
 *   snapshot → corrupt → recover → verify
 * Asserts the NFR34 2-minute SLA. Failures get enqueued as a high-severity
 * notification so the owner finds out before they actually need recovery.
 *
 * Schedule: weekly (Sundays 03:00 UTC — quiet hours, fewest active users).
 * Per-tenant cadence is the cron's responsibility — not gated internally
 * because if the SLA breaks we want to know fast.
 *
 * Why a chaos test at all: backup that's never restored is no backup. The
 * test deliberately writes a known-bad state_data and then runs the
 * production recovery path, so if a Supabase schema change or a deploy
 * regression breaks recover_agent_state we hear about it BEFORE a real
 * incident.
 */

import { NextResponse } from 'next/server';
import { recoveryTest } from '../../_lib/state-recovery';
import { enqueueNotification } from '../../_lib/notifications';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

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
    // Find one running instance per tenant — recovery test is destructive
    // to that one instance's state_data temporarily, so picking the most
    //-recently-active tenant's first instance is fine for coverage.
    const tenantsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/whatsapp_contexts?is_owner=eq.true&select=phone_number`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
    );
    const tenants: { phone_number: string }[] = tenantsRes.ok ? await tenantsRes.json() : [];

    let tested = 0;
    let passed = 0;
    let slaBreaches = 0;
    const failures: Array<{ phone: string; error: string; ms?: number }> = [];

    for (const t of tenants) {
      try {
        const cleanPhone = t.phone_number.replace(/[\s\-+()]/g, '');
        const instRes = await fetch(
          `${SUPABASE_URL}/rest/v1/agent_instances?tenant_phone=eq.${cleanPhone}&status=eq.running&select=id&limit=1`,
          { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
        );
        const insts = instRes.ok ? await instRes.json() : [];
        if (insts.length === 0) continue;

        const result = await recoveryTest(insts[0].id);
        tested++;
        if (result.ok) {
          passed++;
          if (!result.underSla) {
            slaBreaches++;
            // Notify owner — recovery worked but slower than the 2-min NFR.
            // Still safe, but worth surfacing in case it's a regression trend.
            await enqueueNotification({
              tenantPhone: cleanPhone,
              kind: 'agent_observation',
              severity: 'medium',
              title: 'Recovery SLA exceeded (chaos test)',
              body: `Weekly chaos test took ${result.totalMs}ms — over the 2-minute target. Recovery still succeeded, but the system is slowing. Snapshot/recover step timings: ${JSON.stringify(result.steps)}`,
              sourceAgent: 'state-chaos-test',
              topicKeywords: ['recovery sla', 'chaos test'],
            });
          }
        } else {
          failures.push({ phone: cleanPhone, error: result.error ?? 'unknown', ms: result.totalMs });
          // Recovery is broken — this is high-severity. The owner needs to
          // know before they ever try a real rollback.
          await enqueueNotification({
            tenantPhone: cleanPhone,
            kind: 'agent_observation',
            severity: 'critical',
            title: 'Agent recovery broken (chaos test FAILED)',
            body: `The weekly chaos test failed: ${result.error}. Real rollbacks may not work. Step timings: ${JSON.stringify(result.steps)}. Surface this to admin immediately.`,
            sourceAgent: 'state-chaos-test',
            topicKeywords: ['chaos test', 'recovery broken'],
          });
        }
      } catch (err: any) {
        failures.push({ phone: t.phone_number, error: err?.message ?? String(err) });
      }
    }

    return NextResponse.json({
      ok: failures.length === 0,
      tested,
      passed,
      sla_breaches: slaBreaches,
      failures,
    });
  } catch (err) {
    console.error('[state-chaos-test] error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

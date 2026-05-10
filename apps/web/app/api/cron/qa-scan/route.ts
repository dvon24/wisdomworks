/**
 * Story 2.13 — Daily QA scan across every tenant.
 *
 * Looks for: low-confidence classification runs, repeated misclass
 * patterns, uncertain spikes. Findings persist as agent_runs from a
 * synthetic 'QA Agent' so they show in the activity feed and high-
 * severity items get escalated to the owner via the regular runtime
 * push-on-escalation flow.
 *
 * Schedule: 6:15 AM daily (just before the 7AM morning briefing so
 * findings can be folded in).
 */

import { NextResponse } from 'next/server';
import { runQaScan, persistQaFindings } from '../../_lib/classification-learning';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }
  try {
    const tenRes = await fetch(
      `${SUPABASE_URL}/rest/v1/whatsapp_contexts?select=phone_number`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
    );
    const tenants: { phone_number: string }[] = tenRes.ok ? await tenRes.json() : [];
    let totalFindings = 0;
    for (const t of tenants) {
      try {
        const findings = await runQaScan(t.phone_number);
        await persistQaFindings(t.phone_number, findings);
        totalFindings += findings.length;
      } catch (err) {
        console.warn(`[qa-scan] tenant ${t.phone_number} failed:`, err);
      }
    }
    console.log(`[qa-scan] tenants=${tenants.length} findings=${totalFindings}`);
    return NextResponse.json({ ok: true, tenants: tenants.length, findings: totalFindings });
  } catch (err) {
    console.error('[qa-scan] error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

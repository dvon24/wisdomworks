/**
 * Story 2.15 — Weekly Business Type Framework Dictionary aggregator.
 *
 * Scans all commercial tenants' active agent_skills, groups by
 * (business_type, lane, technique_signature), and promotes skills that
 * cleared the promotion thresholds (≥3 tenants, ≥0.7 success rate,
 * ≥5 uses) into business_type_skills with anonymized payloads.
 *
 * Air-gapped tenants are excluded by env_class filter. Government
 * tenants don't contribute (read-only against a frozen snapshot).
 *
 * Schedule: weekly Sundays 04:00 UTC (right after the state-chaos-test
 * at 03:00 — quiet hours, fewest active users).
 */

import { NextResponse } from 'next/server';
import { runDictionaryAggregator } from '../../_lib/cross-tenant-dictionary';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) return new Response('Unauthorized', { status: 401 });
  }
  try {
    const result = await runDictionaryAggregator();
    console.log('[dictionary-aggregator]', JSON.stringify(result));
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[dictionary-aggregator] error:', err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

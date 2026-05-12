/**
 * Insights scan — runs all business-insight detectors once per day across
 * every active tenant. Detected insights land in business_insights and
 * also surface via notification_queue so they ride the digest cron.
 *
 * Schedule: vercel.json '0 6 * * *' (06:00 UTC daily — before the noon
 * digest so the morning detection lands in the lunchtime push).
 */

import { NextResponse } from 'next/server';
import { runDetectors } from '../../_lib/business-insights';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

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
    // Active tenants only — same shape as daily-briefing / proactive-loop
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/whatsapp_contexts?is_owner=eq.true&select=phone_number`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
    );
    const tenants: { phone_number: string }[] = res.ok ? await res.json() : [];

    let totalEmitted = 0;
    let totalDetectors = 0;

    for (const t of tenants) {
      try {
        const r = await runDetectors(t.phone_number);
        totalEmitted += r.emitted;
        totalDetectors += r.detectors;
        if (r.emitted > 0) {
          console.log(`[insights-scan] ${t.phone_number}: ${r.emitted} new insight${r.emitted === 1 ? '' : 's'}`);
        }
      } catch (err) {
        console.warn(`[insights-scan] tenant ${t.phone_number} failed:`, err);
      }
    }

    return NextResponse.json({
      ok: true,
      tenants: tenants.length,
      detectors_run: totalDetectors,
      insights_emitted: totalEmitted,
    });
  } catch (err) {
    console.error('[insights-scan] error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

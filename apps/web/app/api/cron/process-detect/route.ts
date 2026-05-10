/**
 * Story 2.14 — Hourly process detection across all tenants.
 *
 * Walks every tenant, runs the detect_recurring_processes RPC, upserts
 * matching process_records. New high-occurrence patterns get
 * automatically transitioned to 'proposed' so the orchestrator surfaces
 * them in the next tick.
 */

import { NextResponse } from 'next/server';
import { captureProcesses, transitionProcess } from '../../_lib/process-capture';

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
    let totalNew = 0;
    let totalUpdated = 0;
    let totalProposed = 0;

    for (const t of tenants) {
      try {
        const result = await captureProcesses(t.phone_number);
        totalNew += result.new;
        totalUpdated += result.updated;

        // Auto-propose any 'observed' record with 5+ occurrences
        const obsRes = await fetch(
          `${SUPABASE_URL}/rest/v1/process_records?tenant_phone=eq.${t.phone_number}&automation_status=eq.observed&occurrence_count=gte.5&select=id`,
          { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
        );
        const obs = obsRes.ok ? await obsRes.json() : [];
        for (const o of obs) {
          await transitionProcess(o.id, 'proposed');
          totalProposed++;
        }
      } catch (err) {
        console.warn(`[process-detect] tenant ${t.phone_number} failed:`, err);
      }
    }
    console.log(`[process-detect] tenants=${tenants.length} new=${totalNew} updated=${totalUpdated} proposed=${totalProposed}`);
    return NextResponse.json({ ok: true, tenants: tenants.length, new: totalNew, updated: totalUpdated, proposed: totalProposed });
  } catch (err) {
    console.error('[process-detect] error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

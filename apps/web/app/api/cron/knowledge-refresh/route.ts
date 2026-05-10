/**
 * Story 2.9 — Hourly knowledge refresh cron.
 *
 * Walks every active tenant and re-ingests their ontology. Cheap because
 * ingestOntology is idempotent and skips entities whose chunks are newer
 * than the entity itself. Only changed entities re-embed.
 */

import { NextResponse } from 'next/server';
import { ingestOntology } from '../../_lib/knowledge-base';

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
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/whatsapp_contexts?select=phone_number`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
    );
    const tenants: { phone_number: string }[] = res.ok ? await res.json() : [];
    let totalIngested = 0;
    let totalChunks = 0;
    for (const t of tenants) {
      try {
        const r = await ingestOntology(t.phone_number);
        totalIngested += r.ingested;
        totalChunks += r.chunks;
      } catch (err) {
        console.warn(`[knowledge-refresh] tenant ${t.phone_number} failed:`, err);
      }
    }
    console.log(`[knowledge-refresh] tenants=${tenants.length} ingested=${totalIngested} chunks=${totalChunks}`);
    return NextResponse.json({ ok: true, tenants: tenants.length, ingested: totalIngested, chunks: totalChunks });
  } catch (err) {
    console.error('[knowledge-refresh] error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

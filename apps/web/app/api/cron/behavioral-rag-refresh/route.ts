/**
 * Behavioral RAG refresh — Phase 2 of Story 2.9.
 *
 * Runs every 30 min. For each active tenant, ingests new / updated rows
 * from the behavioral sources (atoms, documents, insights, visits,
 * conversation summary) into knowledge_chunks so semantic search works
 * across the rolling memory layer.
 *
 * Idempotent — last_indexed_at tracking on the source tables prevents
 * re-embedding rows that haven't changed. Failed ingests don't mark
 * indexed; the next tick retries.
 *
 * Cost shape (per tenant per tick):
 *   - text-embedding-3-small @ $0.00002 / 1k tokens
 *   - Average behavioral chunk ~150 tokens → ~$0.000003 per chunk
 *   - 50 chunks per tick (worst case for a busy tenant) = $0.00015
 *   - Per tenant per month at 48 ticks/day = ~$0.22 worst case
 *   Cheap.
 */

import { NextResponse } from 'next/server';
import { refreshBehavioralRagForTenant } from '../../_lib/behavioral-rag-ingest';

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
    const tenantsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/whatsapp_contexts?is_owner=eq.true&select=phone_number`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
    );
    const tenants: { phone_number: string }[] = tenantsRes.ok ? await tenantsRes.json() : [];
    if (tenants.length === 0) {
      return NextResponse.json({ ok: true, tenants: 0, ingested: 0 });
    }

    let totalIngested = 0;
    let totalErrors = 0;
    const perTenant: Array<{ phone: string; ingested: number; errors: string[] }> = [];

    for (const t of tenants) {
      try {
        const r = await refreshBehavioralRagForTenant(t.phone_number);
        const sum = r.atoms.ingested + r.documents.ingested + r.insights.ingested + r.visits.ingested + r.conversation.ingested;
        const errs = [
          ...r.atoms.errors,
          ...r.documents.errors,
          ...r.insights.errors,
          ...r.visits.errors,
          ...r.conversation.errors,
        ];
        totalIngested += sum;
        totalErrors += errs.length;
        if (sum > 0 || errs.length > 0) {
          perTenant.push({ phone: t.phone_number, ingested: sum, errors: errs });
          console.log(`[behavioral-rag-refresh] ${t.phone_number}: ingested ${sum} chunks (atoms ${r.atoms.ingested}, docs ${r.documents.ingested}, insights ${r.insights.ingested}, visits ${r.visits.ingested}, conv ${r.conversation.ingested})`);
        }
      } catch (err: any) {
        totalErrors++;
        perTenant.push({ phone: t.phone_number, ingested: 0, errors: [err?.message ?? String(err)] });
      }
    }

    return NextResponse.json({
      ok: true,
      tenants: tenants.length,
      ingested: totalIngested,
      error_count: totalErrors,
      per_tenant: perTenant.slice(0, 20),
    });
  } catch (err) {
    console.error('[behavioral-rag-refresh] error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

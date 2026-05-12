/**
 * Story 2.9 — Knowledge base ingestion endpoint.
 *
 * POST /api/knowledge/ingest { phone }
 *
 * Walks every ontology entity for the tenant, chunks + embeds + upserts
 * into knowledge_chunks. Idempotent — entities whose updated_at is older
 * than their latest chunk are skipped.
 *
 * Called from:
 *   - /api/deploy-complete (after onboarding writes the initial ontology)
 *   - /api/cron/knowledge-refresh (periodic, every hour)
 *   - manually for re-ingestion
 */

import { NextResponse } from 'next/server';
import { ingestOntology } from '../../_lib/knowledge-base';
import { requireOwnerAuth } from '../../_lib/api-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const { phone } = await request.json();
    if (!phone) return NextResponse.json({ error: 'phone required' }, { status: 400 });
    const cleanPhone = phone.replace(/[\s\-+()]/g, '');

    // Story 6.1 deadbolt
    const denied = await requireOwnerAuth(request, cleanPhone);
    if (denied) return denied;
    const result = await ingestOntology(cleanPhone);
    console.log(`[knowledge/ingest] ${cleanPhone}: ingested=${result.ingested} skipped=${result.skipped} chunks=${result.chunks}`);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[knowledge/ingest] error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

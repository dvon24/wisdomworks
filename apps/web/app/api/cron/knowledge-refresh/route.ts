/**
 * Story 2.9 — Hourly knowledge refresh cron.
 *
 * Walks every active tenant and re-ingests:
 *   1. Their ontology entities (Phase 1 — shipped 2026-05-10)
 *   2. Their knowledge_atoms (Phase 2 — shipped 2026-05-15)
 *   3. Their chat_runs (Phase 2 — shipped 2026-05-15)
 *
 * All three are idempotent + watermarked, so the cron is cheap to run
 * even with many tenants. Only changed or new rows re-embed.
 */

import { NextResponse } from 'next/server';
import { ingestOntology, ingestKnowledgeAtoms, ingestChatRuns, ingestBusinessInsights } from '../../_lib/knowledge-base';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function GET(request: Request) {
  // Auth: accept EITHER Vercel's CRON_SECRET (auto-invocation) OR the
  // platform owner's OWNER_API_TOKEN (manual admin trigger). If neither
  // env var is set, the route is unauthenticated — log a warning so it's
  // visible during ops. (Production should always have CRON_SECRET set.)
  const cronSecret = process.env.CRON_SECRET;
  const ownerToken = process.env.OWNER_API_TOKEN;
  const auth = request.headers.get('authorization');
  if (cronSecret || ownerToken) {
    const validCron = cronSecret && auth === `Bearer ${cronSecret}`;
    const validOwner = ownerToken && auth === `Bearer ${ownerToken}`;
    if (!validCron && !validOwner) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  } else {
    console.warn('[knowledge-refresh] WARNING: neither CRON_SECRET nor OWNER_API_TOKEN set — route is unauthenticated. Set CRON_SECRET in Vercel env vars.');
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

    const totals = {
      ontology: { ingested: 0, chunks: 0 },
      atoms: { ingested: 0, chunks: 0 },
      conversations: { ingested: 0, chunks: 0 },
      insights: { ingested: 0, chunks: 0 },
    };
    for (const t of tenants) {
      try {
        const o = await ingestOntology(t.phone_number);
        totals.ontology.ingested += o.ingested;
        totals.ontology.chunks += o.chunks;
      } catch (err) {
        console.warn(`[knowledge-refresh] ontology ${t.phone_number} failed:`, err);
      }
      try {
        const a = await ingestKnowledgeAtoms(t.phone_number);
        totals.atoms.ingested += a.ingested;
        totals.atoms.chunks += a.chunks;
      } catch (err) {
        console.warn(`[knowledge-refresh] atoms ${t.phone_number} failed:`, err);
      }
      try {
        const c = await ingestChatRuns(t.phone_number);
        totals.conversations.ingested += c.ingested;
        totals.conversations.chunks += c.chunks;
      } catch (err) {
        console.warn(`[knowledge-refresh] chat_runs ${t.phone_number} failed:`, err);
      }
      try {
        const i = await ingestBusinessInsights(t.phone_number);
        totals.insights.ingested += i.ingested;
        totals.insights.chunks += i.chunks;
      } catch (err) {
        console.warn(`[knowledge-refresh] insights ${t.phone_number} failed:`, err);
      }
    }
    console.log(
      `[knowledge-refresh] tenants=${tenants.length} ` +
      `ontology=${totals.ontology.ingested}/${totals.ontology.chunks} ` +
      `atoms=${totals.atoms.ingested}/${totals.atoms.chunks} ` +
      `chats=${totals.conversations.ingested}/${totals.conversations.chunks} ` +
      `insights=${totals.insights.ingested}/${totals.insights.chunks}`,
    );
    return NextResponse.json({ ok: true, tenants: tenants.length, totals });
  } catch (err) {
    console.error('[knowledge-refresh] error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

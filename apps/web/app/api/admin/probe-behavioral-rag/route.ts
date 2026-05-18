/**
 * POST /api/admin/probe-behavioral-rag
 *   Bearer OWNER_API_TOKEN
 *   Body: { phone: string, question?: string }
 *
 * One-shot end-to-end check for Story 2.9 Phase 2 — behavioral RAG.
 *
 * Steps:
 *   1. Run all three behavioral ingest functions (atoms, chat_runs,
 *      business_insights) for the given tenant — bypasses the hourly
 *      cron so admins can verify immediately after a migration.
 *   2. Query the knowledge base with the supplied question (defaults
 *      to a behavioral-style probe) scoped to behavioral source kinds
 *      only.
 *   3. Return: per-source ingest counts, top matches with their
 *      source_kind + similarity. If migration hasn't run yet (no
 *      source_kind column), the ingests fail and the error makes the
 *      cause obvious.
 *
 * Use this when:
 *   - Verifying the 2026-05-15a-behavioral-rag.sql migration applied
 *   - Testing whether a specific recall query hits memory
 *   - Diagnosing why Iris's recall_from_memory returned nothing
 */

import { ingestKnowledgeAtoms, ingestChatRuns, ingestBusinessInsights, ingestSentEmails, queryKnowledge } from '../../_lib/knowledge-base';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request) {
  const auth = request.headers.get('authorization');
  const ownerToken = process.env.OWNER_API_TOKEN;
  if (!ownerToken || !auth?.startsWith('Bearer ') || auth.slice(7) !== ownerToken) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }
  const phone: string | undefined = body?.phone;
  if (!phone) return Response.json({ error: 'phone required in body' }, { status: 400 });
  const cleanPhone = String(phone).replace(/[\s\-+()]/g, '');
  const question: string = body?.question?.toString().trim() || 'What did we discuss recently and what facts have I told you?';

  // Cap ingest rows so the probe fits inside Vercel's 60s function timeout.
  // Each row = one OpenAI embed call (~300-800ms) + one Supabase upsert.
  // Full bulk ingestion is the cron's job — the probe just verifies that
  // the chain works. Caller can override via `?maxRows=NN` if needed.
  const url = new URL(request.url);
  const maxRowsOverride = Number(url.searchParams.get('maxRows')) || 0;
  const maxRows = maxRowsOverride > 0 ? Math.min(maxRowsOverride, 100) : 20;

  const ingest = {
    atoms: { ingested: 0, skipped: 0, chunks: 0, error: undefined as string | undefined },
    chat_runs: { ingested: 0, skipped: 0, chunks: 0, error: undefined as string | undefined },
    insights: { ingested: 0, skipped: 0, chunks: 0, error: undefined as string | undefined },
    sent_emails: { ingested: 0, skipped: 0, chunks: 0, redactedAny: 0, error: undefined as string | undefined },
  };
  try {
    Object.assign(ingest.atoms, await ingestKnowledgeAtoms(cleanPhone, { maxRows }));
  } catch (err: any) {
    ingest.atoms.error = err?.message ?? String(err);
  }
  try {
    Object.assign(ingest.chat_runs, await ingestChatRuns(cleanPhone, { maxRows }));
  } catch (err: any) {
    ingest.chat_runs.error = err?.message ?? String(err);
  }
  try {
    Object.assign(ingest.insights, await ingestBusinessInsights(cleanPhone, { maxRows }));
  } catch (err: any) {
    ingest.insights.error = err?.message ?? String(err);
  }
  try {
    // Sent emails capped tighter (provider API + redaction is slower per row)
    Object.assign(ingest.sent_emails, await ingestSentEmails(cleanPhone, { maxRows: Math.min(maxRows, 10) }));
  } catch (err: any) {
    ingest.sent_emails.error = err?.message ?? String(err);
  }

  let matches: any[] = [];
  let embedTokens = 0;
  let queryError: string | undefined;
  try {
    const result = await queryKnowledge(cleanPhone, question, {
      limit: 8,
      minSimilarity: 0.15, // probe-only — lower than prod's 0.4 so partial matches surface
      sourceKinds: ['atom', 'conversation', 'insight', 'email'],
      audit: false,
      source: 'probe',
    });
    matches = result.matches.map((m) => ({
      source_kind: (m as any).source_kind ?? m.source_entity_type,
      source_name: m.source_entity_name,
      similarity: Number(m.similarity.toFixed(3)),
      content_preview: m.content.slice(0, 200),
    }));
    embedTokens = result.embedTokens;
  } catch (err: any) {
    queryError = err?.message ?? String(err);
  }

  const totalChunks = ingest.atoms.chunks + ingest.chat_runs.chunks + ingest.insights.chunks;
  const anyError = ingest.atoms.error || ingest.chat_runs.error || ingest.insights.error || queryError;

  // Quick interpretation so a tired-Devon doesn't need to parse JSON.
  let interpretation: string;
  if (anyError && (ingest.atoms.error?.includes('source_kind') || ingest.atoms.error?.includes('source_row_id'))) {
    interpretation = 'Migration 2026-05-15a-behavioral-rag.sql has NOT been applied yet — run it in Supabase SQL Editor.';
  } else if (totalChunks === 0 && ingest.atoms.skipped === 0 && ingest.chat_runs.skipped === 0) {
    interpretation = 'No atoms / chat_runs / insights found for this tenant — nothing to index yet. Talk to Iris to generate some history first.';
  } else if (matches.length === 0) {
    interpretation = `Ingested ${totalChunks} chunks across ${ingest.atoms.ingested + ingest.chat_runs.ingested + ingest.insights.ingested} new rows, but query "${question}" matched nothing. Try a different question, or wait — embeddings might still be propagating.`;
  } else {
    interpretation = `✓ Behavioral RAG is healthy. ${matches.length} matches across ${new Set(matches.map((m) => m.source_kind)).size} source kinds.`;
  }

  return Response.json({
    tenant: cleanPhone,
    question,
    interpretation,
    ingest,
    query: { matches, embed_tokens: embedTokens, error: queryError },
  });
}

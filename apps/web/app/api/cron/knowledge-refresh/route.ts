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
import {
  ingestOntology,
  ingestKnowledgeAtoms,
  ingestChatRuns,
  ingestBusinessInsights,
  ingestSentEmails,
  ingestReceivedEmails,
} from '../../_lib/knowledge-base';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// 2026-05-30: was 120 and 504'd on 5/27. The internal HARD_DEADLINE_MS (50s)
// only guards BETWEEN tenants, so a single tenant whose 6 sequential ingests
// (esp. the uncapped ontology ingest, before the 0fa63b5 on_conflict fix)
// overran ~120s got killed mid-run. Raising to 300 lets the in-flight tenant
// finish while the between-tenant deadline still defers the rest — no 504.
// Follow-up hardening: cap ingestOntology + check the deadline before each
// ingest within a tenant (not just between tenants).
export const maxDuration = 300;

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

    // Per-source batch caps. Embedding is the slow step (~300-800ms per
    // OpenAI call), so a full run of unbounded ingests easily blows past
    // Vercel's 60s timeout when there's months of history to backfill.
    // 30 rows × 4 sources = ~120 OpenAI calls per tenant per hour, which
    // fits comfortably even at conservative latency. Watermarks (per-row
    // source_row_id "seen" set) mean already-ingested rows are skipped
    // fast on subsequent runs.
    const ATOMS_PER_RUN = 30;
    const CHAT_RUNS_PER_RUN = 30;
    const INSIGHTS_PER_RUN = 30;
    // Sent + received emails are slower per row (provider API roundtrip +
    // larger bodies + PII redaction). Conservative caps so a tenant with
    // both directions enabled still fits in the 50s deadline budget.
    const SENT_EMAILS_PER_RUN = 10;
    const RECEIVED_EMAILS_PER_RUN = 10;

    const totals = {
      ontology: { ingested: 0, chunks: 0 },
      atoms: { ingested: 0, chunks: 0 },
      conversations: { ingested: 0, chunks: 0 },
      insights: { ingested: 0, chunks: 0 },
      sent_emails: { ingested: 0, chunks: 0, redacted: 0 },
      received_emails: { ingested: 0, chunks: 0, redacted: 0 },
    };
    // Deadline guard — bail at 50s in case we underestimate per-row cost
    // and don't want a 504 on the last tenant. Each tenant gets equal
    // share of the remaining budget.
    const startedAt = Date.now();
    const HARD_DEADLINE_MS = 50_000;

    for (const t of tenants) {
      if (Date.now() - startedAt > HARD_DEADLINE_MS) {
        console.warn(`[knowledge-refresh] deadline reached; ${tenants.length - tenants.indexOf(t)} tenants deferred to next run`);
        break;
      }
      try {
        const o = await ingestOntology(t.phone_number);
        totals.ontology.ingested += o.ingested;
        totals.ontology.chunks += o.chunks;
      } catch (err) {
        console.warn(`[knowledge-refresh] ontology ${t.phone_number} failed:`, err);
      }
      try {
        const a = await ingestKnowledgeAtoms(t.phone_number, { maxRows: ATOMS_PER_RUN });
        totals.atoms.ingested += a.ingested;
        totals.atoms.chunks += a.chunks;
      } catch (err) {
        console.warn(`[knowledge-refresh] atoms ${t.phone_number} failed:`, err);
      }
      try {
        const c = await ingestChatRuns(t.phone_number, { maxRows: CHAT_RUNS_PER_RUN });
        totals.conversations.ingested += c.ingested;
        totals.conversations.chunks += c.chunks;
      } catch (err) {
        console.warn(`[knowledge-refresh] chat_runs ${t.phone_number} failed:`, err);
      }
      try {
        const i = await ingestBusinessInsights(t.phone_number, { maxRows: INSIGHTS_PER_RUN });
        totals.insights.ingested += i.ingested;
        totals.insights.chunks += i.chunks;
      } catch (err) {
        console.warn(`[knowledge-refresh] insights ${t.phone_number} failed:`, err);
      }
      try {
        const s = await ingestSentEmails(t.phone_number, { maxRows: SENT_EMAILS_PER_RUN });
        totals.sent_emails.ingested += s.ingested;
        totals.sent_emails.chunks += s.chunks;
        totals.sent_emails.redacted += s.redactedAny;
      } catch (err) {
        console.warn(`[knowledge-refresh] sent_emails ${t.phone_number} failed:`, err);
      }
      try {
        const r = await ingestReceivedEmails(t.phone_number, { maxRows: RECEIVED_EMAILS_PER_RUN });
        totals.received_emails.ingested += r.ingested;
        totals.received_emails.chunks += r.chunks;
        totals.received_emails.redacted += r.redactedAny;
      } catch (err) {
        console.warn(`[knowledge-refresh] received_emails ${t.phone_number} failed:`, err);
      }
    }
    console.log(
      `[knowledge-refresh] tenants=${tenants.length} ` +
      `ontology=${totals.ontology.ingested}/${totals.ontology.chunks} ` +
      `atoms=${totals.atoms.ingested}/${totals.atoms.chunks} ` +
      `chats=${totals.conversations.ingested}/${totals.conversations.chunks} ` +
      `insights=${totals.insights.ingested}/${totals.insights.chunks} ` +
      `sent_emails=${totals.sent_emails.ingested}/${totals.sent_emails.chunks} (PII-redacted: ${totals.sent_emails.redacted}) ` +
      `received_emails=${totals.received_emails.ingested}/${totals.received_emails.chunks} (PII-redacted: ${totals.received_emails.redacted})`,
    );
    return NextResponse.json({ ok: true, tenants: tenants.length, totals });
  } catch (err) {
    console.error('[knowledge-refresh] error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

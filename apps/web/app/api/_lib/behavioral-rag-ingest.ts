/**
 * Behavioral RAG ingest — Phase 2 of Story 2.9.
 *
 * The ontology layer (`source_kind='ontology'`) was already RAG-ready
 * via ingestOntology + the knowledge-refresh cron. This module adds
 * the BEHAVIORAL layer: knowledge_atoms, received_documents summaries,
 * business_insights, client visits, and trimmed conversation chunks.
 *
 * Idempotent — each ingester reads its source table, computes a
 * stable signature per chunk, embeds, upserts into knowledge_chunks
 * with the right source_kind. Re-running an ingester is a no-op for
 * already-indexed rows.
 *
 * Triggered by:
 *   - /api/cron/behavioral-rag-refresh every 30 min (catches new rows)
 *   - Manual invocation via admin lifecycle (future)
 *
 * Embedding model: text-embedding-3-small (1536d) — same as ontology
 * path so the index stays homogeneous and match_knowledge works
 * across both layers in one query.
 */

import { embedBatch, embedText } from './embeddings';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

type SourceKind = 'atom' | 'document' | 'visit' | 'insight' | 'conversation';

interface IngestResult {
  ingested: number;
  skipped: number;
  errors: string[];
}

/**
 * Upsert a chunk into knowledge_chunks with a deterministic
 * source_entity_id so re-runs idempotently update the same row.
 * The on_conflict=source_entity_id,chunk_index unique constraint
 * (already in the original migration) handles the dedup.
 */
async function upsertBehavioralChunk(args: {
  tenantPhone: string;
  sourceKind: SourceKind;
  sourceId: string;
  sourceName: string;
  sourceType: string;
  chunkIndex: number;
  content: string;
  embedding: number[];
  tokens: number;
  metadata?: Record<string, unknown>;
}): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/knowledge_chunks?on_conflict=source_entity_id,chunk_index`,
      {
        method: 'POST',
        headers: { ...headers(), Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({
          tenant_phone: args.tenantPhone,
          source_entity_id: args.sourceId,
          source_entity_type: args.sourceType,
          source_entity_name: args.sourceName.slice(0, 250),
          source_kind: args.sourceKind,
          chunk_index: args.chunkIndex,
          content: args.content.slice(0, 4000),
          embedding: args.embedding,
          tokens: args.tokens,
          metadata: args.metadata ?? {},
        }),
      },
    );
    return res.ok;
  } catch (err) {
    console.warn(`[behavioral-rag] upsert chunk failed (${args.sourceKind}/${args.sourceId}):`, err);
    return false;
  }
}

async function markIndexed(table: string, ids: string[]): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY || ids.length === 0) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=in.(${ids.join(',')})`, {
      method: 'PATCH',
      headers: { ...headers(), Prefer: 'return=minimal' },
      body: JSON.stringify({ last_indexed_at: new Date().toISOString() }),
    });
  } catch {}
}

// ─── Atoms ────────────────────────────────────────────────────────────────

interface KnowledgeAtomRow {
  id: string;
  kind: string;
  title?: string | null;
  summary?: string | null;
  content?: string | null;
  tags?: string[];
  source?: string;
  updated_at: string;
  last_indexed_at?: string | null;
}

function atomEmbeddableText(a: KnowledgeAtomRow): string {
  const parts: string[] = [];
  parts.push(`[${a.kind}] ${a.title ?? '(unnamed)'}`);
  if (a.summary) parts.push(a.summary);
  if (a.content && a.content !== a.summary) parts.push(a.content);
  if (a.tags && a.tags.length > 0) parts.push(`tags: ${a.tags.join(', ')}`);
  return parts.join('\n');
}

export async function ingestAtoms(tenantPhone: string, limit = 100): Promise<IngestResult> {
  const result: IngestResult = { ingested: 0, skipped: 0, errors: [] };
  if (!SUPABASE_URL || !SUPABASE_KEY) return result;
  try {
    // Pull atoms updated since their last index (or never indexed)
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/knowledge_atoms?tenant_phone=eq.${tenantPhone}&or=(last_indexed_at.is.null,updated_at.gt.last_indexed_at)&limit=${limit}&select=id,kind,title,summary,content,tags,source,updated_at,last_indexed_at`,
      { headers: headers() },
    );
    if (!res.ok) {
      result.errors.push(`atoms fetch ${res.status}`);
      return result;
    }
    const rows: KnowledgeAtomRow[] = await res.json();
    if (rows.length === 0) return result;

    const texts = rows.map(atomEmbeddableText);
    const embeddings = await embedBatch(texts);
    const successIds: string[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const emb = embeddings[i];
      if (!emb) { result.skipped++; continue; }
      const ok = await upsertBehavioralChunk({
        tenantPhone,
        sourceKind: 'atom',
        sourceId: row.id,
        sourceName: (row.title ?? row.kind).slice(0, 250),
        sourceType: `atom:${row.kind}`,
        chunkIndex: 0,
        content: texts[i]!,
        embedding: emb.embedding,
        tokens: emb.tokens,
        metadata: { kind: row.kind, tags: row.tags ?? [] },
      });
      if (ok) {
        result.ingested++;
        successIds.push(row.id);
      } else {
        result.skipped++;
      }
    }
    await markIndexed('knowledge_atoms', successIds);
    return result;
  } catch (err: any) {
    result.errors.push(err?.message ?? String(err));
    return result;
  }
}

// ─── Received documents ───────────────────────────────────────────────────

interface ReceivedDocRow {
  id: string;
  source: string;
  filename?: string | null;
  summary?: string | null;
  key_dates?: Array<{ when: string; what: string }>;
  key_amounts?: Array<{ amount: string; what: string }>;
  key_parties?: Array<{ name: string; role: string }>;
  action_items?: Array<{ task: string; due?: string }>;
  risks?: Array<{ severity: string; concern: string }>;
  tags?: string[];
  analyzed_at: string;
  last_indexed_at?: string | null;
}

function docEmbeddableText(d: ReceivedDocRow): string {
  const parts: string[] = [];
  parts.push(`Document: ${d.filename ?? '(unnamed)'} (source: ${d.source})`);
  if (d.summary) parts.push(d.summary);
  if (d.tags && d.tags.length > 0) parts.push(`tags: ${d.tags.join(', ')}`);
  if (d.key_parties && d.key_parties.length > 0) {
    parts.push('parties: ' + d.key_parties.map((p) => `${p.name} (${p.role})`).join(', '));
  }
  if (d.key_dates && d.key_dates.length > 0) {
    parts.push('dates: ' + d.key_dates.map((x) => `${x.when} — ${x.what}`).join('; '));
  }
  if (d.key_amounts && d.key_amounts.length > 0) {
    parts.push('amounts: ' + d.key_amounts.map((x) => `${x.amount} — ${x.what}`).join('; '));
  }
  if (d.action_items && d.action_items.length > 0) {
    parts.push('actions: ' + d.action_items.map((a) => a.task).join('; '));
  }
  if (d.risks && d.risks.length > 0) {
    parts.push('risks: ' + d.risks.map((r) => `[${r.severity}] ${r.concern}`).join('; '));
  }
  return parts.join('\n');
}

export async function ingestDocuments(tenantPhone: string, limit = 50): Promise<IngestResult> {
  const result: IngestResult = { ingested: 0, skipped: 0, errors: [] };
  if (!SUPABASE_URL || !SUPABASE_KEY) return result;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/received_documents?tenant_phone=eq.${tenantPhone}&status=eq.analyzed&or=(last_indexed_at.is.null,analyzed_at.gt.last_indexed_at)&limit=${limit}&select=*`,
      { headers: headers() },
    );
    if (!res.ok) {
      result.errors.push(`documents fetch ${res.status}`);
      return result;
    }
    const rows: ReceivedDocRow[] = await res.json();
    if (rows.length === 0) return result;

    const texts = rows.map(docEmbeddableText);
    const embeddings = await embedBatch(texts);
    const successIds: string[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const emb = embeddings[i];
      if (!emb) { result.skipped++; continue; }
      const ok = await upsertBehavioralChunk({
        tenantPhone,
        sourceKind: 'document',
        sourceId: row.id,
        sourceName: (row.filename ?? `${row.source} document`).slice(0, 250),
        sourceType: `document:${row.source}`,
        chunkIndex: 0,
        content: texts[i]!,
        embedding: emb.embedding,
        tokens: emb.tokens,
        metadata: { source: row.source, tags: row.tags ?? [] },
      });
      if (ok) {
        result.ingested++;
        successIds.push(row.id);
      } else {
        result.skipped++;
      }
    }
    await markIndexed('received_documents', successIds);
    return result;
  } catch (err: any) {
    result.errors.push(err?.message ?? String(err));
    return result;
  }
}

// ─── Business insights ────────────────────────────────────────────────────

interface InsightRow {
  id: string;
  detector: string;
  severity: string;
  title: string;
  why?: string;
  recommended_action?: string;
  expected_impact?: string;
  detected_at: string;
  last_indexed_at?: string | null;
}

function insightEmbeddableText(i: InsightRow): string {
  const parts: string[] = [];
  parts.push(`[${i.detector}] ${i.title}`);
  if (i.why) parts.push(`why: ${i.why}`);
  if (i.recommended_action) parts.push(`recommendation: ${i.recommended_action}`);
  if (i.expected_impact) parts.push(`impact: ${i.expected_impact}`);
  return parts.join('\n');
}

export async function ingestInsights(tenantPhone: string, limit = 50): Promise<IngestResult> {
  const result: IngestResult = { ingested: 0, skipped: 0, errors: [] };
  if (!SUPABASE_URL || !SUPABASE_KEY) return result;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/business_insights?tenant_phone=eq.${tenantPhone}&or=(last_indexed_at.is.null,detected_at.gt.last_indexed_at)&limit=${limit}&select=id,detector,severity,title,why,recommended_action,expected_impact,detected_at,last_indexed_at`,
      { headers: headers() },
    );
    if (!res.ok) {
      result.errors.push(`insights fetch ${res.status}`);
      return result;
    }
    const rows: InsightRow[] = await res.json();
    if (rows.length === 0) return result;

    const texts = rows.map(insightEmbeddableText);
    const embeddings = await embedBatch(texts);
    const successIds: string[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const emb = embeddings[i];
      if (!emb) { result.skipped++; continue; }
      const ok = await upsertBehavioralChunk({
        tenantPhone,
        sourceKind: 'insight',
        sourceId: row.id,
        sourceName: row.title.slice(0, 250),
        sourceType: `insight:${row.detector}`,
        chunkIndex: 0,
        content: texts[i]!,
        embedding: emb.embedding,
        tokens: emb.tokens,
        metadata: { detector: row.detector, severity: row.severity },
      });
      if (ok) {
        result.ingested++;
        successIds.push(row.id);
      } else {
        result.skipped++;
      }
    }
    await markIndexed('business_insights', successIds);
    return result;
  } catch (err: any) {
    result.errors.push(err?.message ?? String(err));
    return result;
  }
}

// ─── Client visits ────────────────────────────────────────────────────────

interface ClientVisitRow {
  id: string;
  client_id: string;
  visit_at: string;
  service: string;
  notes?: string | null;
  outcome?: string | null;
  client_name?: string;
}

function visitEmbeddableText(v: ClientVisitRow): string {
  const parts: string[] = [];
  parts.push(`Visit ${v.visit_at}${v.client_name ? ` — ${v.client_name}` : ''}`);
  if (v.service) parts.push(`service: ${v.service}`);
  if (v.outcome) parts.push(`outcome: ${v.outcome}`);
  if (v.notes) parts.push(`notes: ${v.notes}`);
  return parts.join('\n');
}

export async function ingestClientVisits(tenantPhone: string, limit = 100): Promise<IngestResult> {
  const result: IngestResult = { ingested: 0, skipped: 0, errors: [] };
  if (!SUPABASE_URL || !SUPABASE_KEY) return result;
  try {
    // Visits don't have last_indexed_at — dedup happens via the
    // source_entity_id+chunk_index unique constraint in knowledge_chunks.
    // Re-running is idempotent; the upsert merges duplicates.
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/client_visits?tenant_phone=eq.${tenantPhone}&order=visit_at.desc&limit=${limit}&select=id,client_id,visit_at,service,notes,outcome,client_profiles(display_name)`,
      { headers: headers() },
    );
    if (!res.ok) {
      result.errors.push(`visits fetch ${res.status}`);
      return result;
    }
    const rows = await res.json();
    if (rows.length === 0) return result;

    const visits: ClientVisitRow[] = rows.map((r: any) => ({
      id: r.id,
      client_id: r.client_id,
      visit_at: r.visit_at,
      service: r.service,
      notes: r.notes,
      outcome: r.outcome,
      client_name: r.client_profiles?.display_name,
    }));
    const texts = visits.map(visitEmbeddableText);
    const embeddings = await embedBatch(texts);
    for (let i = 0; i < visits.length; i++) {
      const v = visits[i]!;
      const emb = embeddings[i];
      if (!emb) { result.skipped++; continue; }
      const ok = await upsertBehavioralChunk({
        tenantPhone,
        sourceKind: 'visit',
        sourceId: v.id,
        sourceName: `${v.client_name ?? 'visit'} — ${v.service ?? ''}`.slice(0, 250),
        sourceType: 'visit',
        chunkIndex: 0,
        content: texts[i]!,
        embedding: emb.embedding,
        tokens: emb.tokens,
        metadata: { client_id: v.client_id, visit_at: v.visit_at },
      });
      if (ok) result.ingested++;
      else result.skipped++;
    }
    return result;
  } catch (err: any) {
    result.errors.push(err?.message ?? String(err));
    return result;
  }
}

// ─── Conversation summaries ──────────────────────────────────────────────

/**
 * For conversation history, we don't index every message (too noisy,
 * mostly redundant signal). We embed the rolling summary stored on
 * whatsapp_contexts.profile.conversationSummary — the trim logic in
 * context-store updates this each time history exceeds the 50-msg cap.
 * One chunk per tenant, replaced on each refresh.
 */
export async function ingestConversationSummary(tenantPhone: string): Promise<IngestResult> {
  const result: IngestResult = { ingested: 0, skipped: 0, errors: [] };
  if (!SUPABASE_URL || !SUPABASE_KEY) return result;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${tenantPhone}&select=profile`,
      { headers: headers() },
    );
    if (!res.ok) return result;
    const rows = await res.json();
    const summary = rows[0]?.profile?.conversationSummary;
    if (!summary || typeof summary !== 'string' || summary.length < 20) return result;
    const text = `Conversation summary (older history beyond the 50-message window):\n${summary}`;
    const emb = await embedText(text);
    // Stable id derived from tenant_phone so re-runs overwrite the same row.
    // The unique constraint is on (source_entity_id, chunk_index) — we use
    // a synthetic UUID-namespace, but since we don't have a real UUID we
    // use the tenant_phone hash via a known seeded namespace approach.
    // Simpler: query the existing row first, then upsert via PATCH if it
    // exists, INSERT if not.
    const existingRes = await fetch(
      `${SUPABASE_URL}/rest/v1/knowledge_chunks?tenant_phone=eq.${tenantPhone}&source_kind=eq.conversation&select=id&limit=1`,
      { headers: headers() },
    );
    const existing = existingRes.ok ? (await existingRes.json())[0] : null;
    if (existing) {
      await fetch(`${SUPABASE_URL}/rest/v1/knowledge_chunks?id=eq.${existing.id}`, {
        method: 'PATCH',
        headers: { ...headers(), Prefer: 'return=minimal' },
        body: JSON.stringify({
          content: text.slice(0, 4000),
          embedding: emb.embedding,
          tokens: emb.tokens,
        }),
      });
    } else {
      await fetch(`${SUPABASE_URL}/rest/v1/knowledge_chunks`, {
        method: 'POST',
        headers: { ...headers(), Prefer: 'return=minimal' },
        body: JSON.stringify({
          tenant_phone: tenantPhone,
          source_entity_id: null,
          source_entity_type: 'conversation_summary',
          source_entity_name: 'conversation history',
          source_kind: 'conversation',
          chunk_index: 0,
          content: text.slice(0, 4000),
          embedding: emb.embedding,
          tokens: emb.tokens,
        }),
      });
    }
    result.ingested = 1;
    return result;
  } catch (err: any) {
    result.errors.push(err?.message ?? String(err));
    return result;
  }
}

// ─── Combined per-tenant refresh ─────────────────────────────────────────

export interface TenantRefreshSummary {
  tenant_phone: string;
  atoms: IngestResult;
  documents: IngestResult;
  insights: IngestResult;
  visits: IngestResult;
  conversation: IngestResult;
}

export async function refreshBehavioralRagForTenant(tenantPhone: string): Promise<TenantRefreshSummary> {
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  const [atoms, documents, insights, visits, conversation] = await Promise.all([
    ingestAtoms(cleanPhone),
    ingestDocuments(cleanPhone),
    ingestInsights(cleanPhone),
    ingestClientVisits(cleanPhone),
    ingestConversationSummary(cleanPhone),
  ]);
  return { tenant_phone: cleanPhone, atoms, documents, insights, visits, conversation };
}

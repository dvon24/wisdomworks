/**
 * Story 2.9 — Knowledge Base & Error Prevention.
 *
 * - chunkText:    splits long text into ~500-token chunks with overlap
 * - ingestEntity: chunks an ontology entity, embeds, upserts to knowledge_chunks
 * - ingestOntology: ingest ALL the tenant's entities (idempotent — skips
 *                   chunks whose source content hasn't changed)
 * - queryKnowledge: embed a query, run match_knowledge, return cited chunks
 *
 * Audit trail: every queryKnowledge call lands in agent_runs with
 * phase='analyze', tokens used, and the matched chunk ids in metadata.
 */

import { embedBatch, embedText, estimateTokens } from './embeddings';
import { redactPII, listSentEmails, listReceivedEmails, type OAuthConnection } from '@wisdomworks/shared';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CHUNK_TARGET_TOKENS = 500;
const CHUNK_OVERLAP_TOKENS = 50;
// 1 token ≈ 4 chars in English; flip the chunking to character math for speed
const CHUNK_TARGET_CHARS = CHUNK_TARGET_TOKENS * 4;
const CHUNK_OVERLAP_CHARS = CHUNK_OVERLAP_TOKENS * 4;

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

/**
 * Split text into chunks of ~500 tokens with 50-token overlap so the
 * boundary context isn't lost. Tries to break on paragraph/sentence
 * boundaries when possible.
 */
export function chunkText(text: string): string[] {
  if (!text?.trim()) return [];
  if (text.length <= CHUNK_TARGET_CHARS) return [text];

  const chunks: string[] = [];
  let pos = 0;
  while (pos < text.length) {
    let end = Math.min(pos + CHUNK_TARGET_CHARS, text.length);
    // Try to break at a paragraph boundary if one exists in the last 20% of the chunk
    const earliestBreak = pos + Math.floor(CHUNK_TARGET_CHARS * 0.8);
    if (end < text.length) {
      const paragraphBreak = text.lastIndexOf('\n\n', end);
      const sentenceBreak = text.lastIndexOf('. ', end);
      if (paragraphBreak >= earliestBreak) end = paragraphBreak + 2;
      else if (sentenceBreak >= earliestBreak) end = sentenceBreak + 2;
    }
    chunks.push(text.slice(pos, end).trim());
    if (end >= text.length) break;
    pos = end - CHUNK_OVERLAP_CHARS;
    if (pos < 0) pos = 0;
  }
  return chunks.filter((c) => c.length > 0);
}

interface OntologyEntity {
  id: string;
  tenant_phone: string;
  entity_type: string;
  name: string;
  metadata: any;
}

/**
 * Build the text we'll embed for a given entity. Different entity types
 * have different "important" fields — for documentation we embed the full
 * markdown text; for roles we embed name + role description; etc.
 */
function entityToEmbeddableText(entity: OntologyEntity): string {
  const meta = entity.metadata ?? {};
  switch (entity.entity_type) {
    case 'documentation':
      return meta.text ?? entity.name;
    case 'role':
      return [
        `Role: ${entity.name}`,
        meta.role ? `Function: ${meta.role}` : '',
        meta.channels?.length ? `Channels: ${meta.channels.join(', ')}` : '',
        meta.tools?.length ? `Tools: ${meta.tools.join(', ')}` : '',
        meta.parent_role ? `Reports to: ${meta.parent_role}` : '',
      ].filter(Boolean).join('\n');
    case 'capability':
      return `Capability: ${entity.name}${meta.source_layer ? ` (${meta.source_layer})` : ''}`;
    case 'risk':
      return `Risk / pain point: ${entity.name}`;
    case 'task':
      return `Task: ${entity.name}${meta.from_email_subject ? ` — from email: "${meta.from_email_subject}"` : ''}`;
    case 'project':
      return `Project: ${entity.name}`;
    case 'employee':
      return `Person: ${entity.name}${meta.role ? `, ${meta.role}` : ''}`;
    case 'department':
      return `Department: ${entity.name}${meta.industry ? ` (${meta.industry})` : ''}`;
    case 'decision':
      return `Decision/date: ${entity.name}`;
    default:
      return `${entity.entity_type}: ${entity.name}`;
  }
}

/**
 * Ingest a single ontology entity — chunk its text, embed each chunk,
 * upsert into knowledge_chunks. Returns count of chunks written.
 */
export async function ingestEntity(entity: OntologyEntity): Promise<number> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return 0;
  const text = entityToEmbeddableText(entity);
  const chunks = chunkText(text);
  if (chunks.length === 0) return 0;

  // Embed all chunks in a single OpenAI call (faster + cheaper)
  let embeddings;
  try {
    embeddings = await embedBatch(chunks);
  } catch (err) {
    console.warn(`[kb] embed failed for entity ${entity.id}:`, err);
    return 0;
  }

  // Build the rows
  const rows = chunks.map((content, i) => ({
    tenant_phone: entity.tenant_phone,
    source_kind: 'ontology',
    source_row_id: entity.id,
    source_entity_id: entity.id,
    source_entity_type: entity.entity_type,
    source_entity_name: entity.name,
    chunk_index: i,
    content,
    embedding: embeddings[i]?.embedding,
    tokens: embeddings[i]?.tokens ?? estimateTokens(content),
    metadata: { ingested_at: new Date().toISOString() },
  }));

  // Upsert by (tenant_phone, source_kind, source_row_id, chunk_index)
  // so re-ingesting the same source row overwrites cleanly without
  // duplicating.
  //
  // 2026-05-28 — PostgREST `merge-duplicates` requires the unique
  // constraint columns specified via on_conflict=. Without it, the
  // upsert falls back to PRIMARY KEY (id is gen_random_uuid, never
  // matches) and crashes on the unique index. Devon's morning logs
  // showed this 504'ing the knowledge-refresh cron and cascading
  // to "agents failing" symptoms upstream.
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/knowledge_chunks?on_conflict=tenant_phone,source_kind,source_row_id,chunk_index`,
    {
      method: 'POST',
      headers: { ...headers(), Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows),
    },
  );
  if (!res.ok) {
    console.warn(`[kb] upsert failed for entity ${entity.id}: ${res.status} ${await res.text()}`);
    return 0;
  }
  return rows.length;
}

// ─── Behavioral RAG (Story 2.9 Phase 2) ─────────────────────────────
//
// The ontology layer indexes "who the tenant IS" — agents, roles,
// projects, etc. The behavioral layer indexes "what HAPPENED" — past
// chats, atoms the owner taught Iris, client visits, etc. Different
// retrieval purpose: ontology answers "who handles X"; behavioral
// answers "what did we discuss last week / what was that thing
// Maria said about her allergy."
//
// All behavioral chunks live in the same knowledge_chunks table with
// source_kind discriminating which kind of row they came from.

/**
 * Generic helper: chunk + embed + upsert a behavioral row. Caller
 * supplies the kind, the row id, an optional preview name (for citing
 * results), and the raw text to embed. Idempotent on
 * (tenant_phone, source_kind, source_row_id, chunk_index).
 */
async function ingestBehavioral(args: {
  tenantPhone: string;
  sourceKind: 'atom' | 'conversation' | 'visit' | 'document' | 'insight' | 'email';
  sourceRowId: string;
  sourceName?: string;
  text: string;
  metadata?: Record<string, unknown>;
}): Promise<number> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return 0;
  if (!args.text?.trim()) return 0;

  const chunks = chunkText(args.text);
  if (chunks.length === 0) return 0;

  let embeddings;
  try {
    embeddings = await embedBatch(chunks);
  } catch (err) {
    console.warn(`[kb-behavioral] embed failed (${args.sourceKind} ${args.sourceRowId}):`, err);
    return 0;
  }

  const rows = chunks.map((content, i) => ({
    tenant_phone: args.tenantPhone,
    source_kind: args.sourceKind,
    source_row_id: args.sourceRowId,
    // source_entity_id stays NULL for behavioral rows — they don't
    // reference an ontology entity.
    source_entity_id: null,
    source_entity_type: args.sourceKind,
    source_entity_name: args.sourceName ?? null,
    chunk_index: i,
    content,
    embedding: embeddings[i]?.embedding,
    tokens: embeddings[i]?.tokens ?? estimateTokens(content),
    metadata: { ingested_at: new Date().toISOString(), ...(args.metadata ?? {}) },
  }));

  // 2026-05-28 — see ontology upsert comment above. Same PostgREST
  // gotcha: merge-duplicates needs on_conflict= explicitly.
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/knowledge_chunks?on_conflict=tenant_phone,source_kind,source_row_id,chunk_index`,
    {
      method: 'POST',
      headers: { ...headers(), Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows),
    },
  );
  if (!res.ok) {
    console.warn(`[kb-behavioral] upsert failed (${args.sourceKind} ${args.sourceRowId}): ${res.status} ${await res.text()}`);
    return 0;
  }
  return rows.length;
}

/**
 * Ingest the tenant's knowledge_atoms. Pulls atoms updated since the
 * last ingestion run (per source_row_id watermark on knowledge_chunks),
 * embeds, upserts. Cheap to run repeatedly.
 */
export async function ingestKnowledgeAtoms(
  tenantPhone: string,
  options: { maxRows?: number } = {},
): Promise<{ ingested: number; skipped: number; chunks: number }> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { ingested: 0, skipped: 0, chunks: 0 };
  // maxRows is the TOTAL embed budget per call. Split half for forward fill
  // (atoms updated since last ingest) and half for backfill (older atoms
  // that haven't been ingested yet) so each cron run progresses both ends.
  const maxRows = Math.max(2, Math.min(options.maxRows ?? 500, 500));
  const half = Math.ceil(maxRows / 2);

  // Watermark map (source_row_id → last ingested timestamp) for the
  // updated-since check used by the forward pass.
  const wmRes = await fetch(
    `${SUPABASE_URL}/rest/v1/knowledge_chunks?tenant_phone=eq.${tenantPhone}&source_kind=eq.atom&select=source_row_id,updated_at`,
    { headers: headers() },
  );
  const wmRows: Array<{ source_row_id: string; updated_at: string }> = wmRes.ok ? await wmRes.json() : [];
  const wm = new Map<string, number>();
  const seenIds = new Set<string>();
  for (const r of wmRows) {
    seenIds.add(r.source_row_id);
    const ts = new Date(r.updated_at).getTime();
    if (ts > (wm.get(r.source_row_id) ?? 0)) wm.set(r.source_row_id, ts);
  }

  // FORWARD PASS — atoms with updated_at greater than our chunk's
  // updated_at (recent edits + brand-new atoms). Pulled DESC.
  // BACKFILL PASS — atoms whose id has NEVER been ingested. Pulled ASC
  // so the oldest unseen atoms come first; each run nibbles further back.
  // We over-fetch by 2× seen size on both sides so we always have enough
  // headroom to find `half` unseen rows even when the boundary is dense
  // with already-seen IDs.
  const overFetch = Math.min(500, Math.max(half, seenIds.size * 2 + half));
  const [recentRes, oldestRes] = await Promise.all([
    fetch(
      `${SUPABASE_URL}/rest/v1/tenant_knowledge_atoms?tenant_phone=eq.${tenantPhone}&status=eq.active&select=id,kind,content,tags,owner_confirmed,updated_at&order=updated_at.desc&limit=${overFetch}`,
      { headers: headers() },
    ),
    fetch(
      `${SUPABASE_URL}/rest/v1/tenant_knowledge_atoms?tenant_phone=eq.${tenantPhone}&status=eq.active&select=id,kind,content,tags,owner_confirmed,updated_at&order=updated_at.asc&limit=${overFetch}`,
      { headers: headers() },
    ),
  ]);
  if (!recentRes.ok && !oldestRes.ok) return { ingested: 0, skipped: 0, chunks: 0 };
  const recent: Array<{ id: string; kind: string; content: string; tags?: string[]; owner_confirmed?: boolean; updated_at: string }> =
    recentRes.ok ? await recentRes.json() : [];
  const oldest: typeof recent = oldestRes.ok ? await oldestRes.json() : [];

  // De-dup across the two query results (small atom collections may
  // overlap entirely).
  const candidates: typeof recent = [];
  const candidateIds = new Set<string>();
  for (const a of recent) {
    if (candidateIds.has(a.id)) continue;
    candidateIds.add(a.id);
    candidates.push(a);
  }
  for (const a of oldest) {
    if (candidateIds.has(a.id)) continue;
    candidateIds.add(a.id);
    candidates.push(a);
  }
  if (candidates.length === 0) return { ingested: 0, skipped: 0, chunks: 0 };

  let ingested = 0;
  let skipped = 0;
  let chunksTotal = 0;
  for (const atom of candidates) {
    if (ingested >= maxRows) break;
    const atomTs = new Date(atom.updated_at).getTime();
    if ((wm.get(atom.id) ?? 0) >= atomTs) {
      skipped++;
      continue;
    }
    const written = await ingestBehavioral({
      tenantPhone,
      sourceKind: 'atom',
      sourceRowId: atom.id,
      sourceName: `${atom.kind} atom`,
      text: atom.content,
      metadata: {
        kind: atom.kind,
        tags: atom.tags ?? [],
        owner_confirmed: !!atom.owner_confirmed,
      },
    });
    if (written > 0) {
      ingested++;
      chunksTotal += written;
    }
  }
  return { ingested, skipped, chunks: chunksTotal };
}

/**
 * Ingest the tenant's business insights — past detector findings,
 * recommendations, QA flags, lapsed-client alerts, etc. These are
 * already curated summaries (no raw PII), so embedding is safe and
 * cheap. Useful for owner queries like "what did Marcus flag last
 * month about scheduling?" or "did we ever spot a lapsed customer
 * pattern with Maria's segment."
 *
 * Bounded to the last 180 days so old, fully-resolved insights stop
 * re-embedding once they age out.
 */
export async function ingestBusinessInsights(
  tenantPhone: string,
  options: { maxRows?: number } = {},
): Promise<{ ingested: number; skipped: number; chunks: number }> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { ingested: 0, skipped: 0, chunks: 0 };
  const maxRows = Math.max(2, Math.min(options.maxRows ?? 300, 300));
  const since = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();

  const wmRes = await fetch(
    `${SUPABASE_URL}/rest/v1/knowledge_chunks?tenant_phone=eq.${tenantPhone}&source_kind=eq.insight&select=source_row_id`,
    { headers: headers() },
  );
  const seen = new Set<string>(
    wmRes.ok ? ((await wmRes.json()) as Array<{ source_row_id: string }>).map((r) => r.source_row_id) : [],
  );
  const half = Math.ceil(maxRows / 2);
  const overFetch = Math.min(500, Math.max(half, seen.size * 2 + half));

  // Two-pass: newest (forward fill) + oldest unseen (backfill). Same
  // pattern as ingestKnowledgeAtoms — see comments there for rationale.
  const [recentRes, oldestRes] = await Promise.all([
    fetch(
      `${SUPABASE_URL}/rest/v1/business_insights?tenant_phone=eq.${tenantPhone}&detected_at=gte.${since}&select=id,detector,severity,title,why,recommended_action,expected_impact,status,detected_at&order=detected_at.desc&limit=${overFetch}`,
      { headers: headers() },
    ),
    fetch(
      `${SUPABASE_URL}/rest/v1/business_insights?tenant_phone=eq.${tenantPhone}&detected_at=gte.${since}&select=id,detector,severity,title,why,recommended_action,expected_impact,status,detected_at&order=detected_at.asc&limit=${overFetch}`,
      { headers: headers() },
    ),
  ]);
  if (!recentRes.ok && !oldestRes.ok) return { ingested: 0, skipped: 0, chunks: 0 };
  const recent: Array<{
    id: string;
    detector: string;
    severity: string;
    title: string;
    why?: string;
    recommended_action?: string;
    expected_impact?: string;
    status: string;
    detected_at: string;
  }> = recentRes.ok ? await recentRes.json() : [];
  const oldest: typeof recent = oldestRes.ok ? await oldestRes.json() : [];

  const candidates: typeof recent = [];
  const candidateIds = new Set<string>();
  for (const i of recent) {
    if (candidateIds.has(i.id)) continue;
    candidateIds.add(i.id);
    candidates.push(i);
  }
  for (const i of oldest) {
    if (candidateIds.has(i.id)) continue;
    candidateIds.add(i.id);
    candidates.push(i);
  }
  if (candidates.length === 0) return { ingested: 0, skipped: 0, chunks: 0 };

  let ingested = 0;
  let skipped = 0;
  let chunksTotal = 0;
  for (const ins of candidates) {
    if (ingested >= maxRows) break;
    if (seen.has(ins.id)) {
      skipped++;
      continue;
    }
    const text = [
      `${ins.detector} flagged: ${ins.title}`,
      ins.why ? `Reason: ${ins.why}` : '',
      ins.recommended_action ? `Recommended: ${ins.recommended_action}` : '',
      ins.expected_impact ? `Impact: ${ins.expected_impact}` : '',
      `Status: ${ins.status}`,
    ].filter(Boolean).join('\n');
    const written = await ingestBehavioral({
      tenantPhone,
      sourceKind: 'insight',
      sourceRowId: ins.id,
      sourceName: ins.title,
      text,
      metadata: {
        detector: ins.detector,
        severity: ins.severity,
        status: ins.status,
        detected_at: ins.detected_at,
      },
    });
    if (written > 0) {
      ingested++;
      chunksTotal += written;
    }
  }
  return { ingested, skipped, chunks: chunksTotal };
}

/**
 * Ingest the tenant's chat history (Iris ↔ owner). Each chat_runs row
 * = one Iris reply turn. We embed `assistant_reply_preview` so the
 * owner can later semantically recall things like "what did you tell
 * me about pricing last week."
 *
 * Bounded to the last 90 days to avoid runaway re-ingestion of ancient
 * chats. Older chats stay queryable but won't be re-embedded if the
 * preview ever changes.
 */
export async function ingestChatRuns(
  tenantPhone: string,
  options: { maxRows?: number } = {},
): Promise<{ ingested: number; skipped: number; chunks: number }> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { ingested: 0, skipped: 0, chunks: 0 };
  const maxRows = Math.max(2, Math.min(options.maxRows ?? 300, 300));
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const wmRes = await fetch(
    `${SUPABASE_URL}/rest/v1/knowledge_chunks?tenant_phone=eq.${tenantPhone}&source_kind=eq.conversation&select=source_row_id`,
    { headers: headers() },
  );
  const seen = new Set<string>(
    wmRes.ok ? ((await wmRes.json()) as Array<{ source_row_id: string }>).map((r) => r.source_row_id) : [],
  );
  const half = Math.ceil(maxRows / 2);
  const overFetch = Math.min(500, Math.max(half, seen.size * 2 + half));

  // Two-pass: forward fill (most recent chat_runs) + backfill (oldest
  // unseen). With only forward fill the cron would index the last 30
  // chats and never touch older history — owner queries about anything
  // from a month ago would miss. The backfill pass walks oldest-first
  // and nibbles further back each run until caught up.
  const [recentRes, oldestRes] = await Promise.all([
    fetch(
      `${SUPABASE_URL}/rest/v1/chat_runs?tenant_phone=eq.${tenantPhone}&started_at=gte.${since}&select=id,user_message_preview,assistant_reply_preview,started_at&order=started_at.desc&limit=${overFetch}`,
      { headers: headers() },
    ),
    fetch(
      `${SUPABASE_URL}/rest/v1/chat_runs?tenant_phone=eq.${tenantPhone}&started_at=gte.${since}&select=id,user_message_preview,assistant_reply_preview,started_at&order=started_at.asc&limit=${overFetch}`,
      { headers: headers() },
    ),
  ]);
  if (!recentRes.ok && !oldestRes.ok) return { ingested: 0, skipped: 0, chunks: 0 };
  const recent: Array<{
    id: string;
    user_message_preview?: string;
    assistant_reply_preview?: string;
    started_at: string;
  }> = recentRes.ok ? await recentRes.json() : [];
  const oldest: typeof recent = oldestRes.ok ? await oldestRes.json() : [];

  const candidates: typeof recent = [];
  const candidateIds = new Set<string>();
  for (const r of recent) {
    if (candidateIds.has(r.id)) continue;
    candidateIds.add(r.id);
    candidates.push(r);
  }
  for (const r of oldest) {
    if (candidateIds.has(r.id)) continue;
    candidateIds.add(r.id);
    candidates.push(r);
  }
  if (candidates.length === 0) return { ingested: 0, skipped: 0, chunks: 0 };

  let ingested = 0;
  let skipped = 0;
  let chunksTotal = 0;
  for (const run of candidates) {
    if (ingested >= maxRows) break;
    if (seen.has(run.id)) {
      skipped++;
      continue;
    }
    // Embed both sides of the turn so either-side recall works.
    const text = [
      run.user_message_preview ? `Owner asked: ${run.user_message_preview}` : '',
      run.assistant_reply_preview ? `Iris replied: ${run.assistant_reply_preview}` : '',
    ].filter(Boolean).join('\n\n');
    if (!text.trim()) {
      skipped++;
      continue;
    }
    const date = new Date(run.started_at).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
    const written = await ingestBehavioral({
      tenantPhone,
      sourceKind: 'conversation',
      sourceRowId: run.id,
      sourceName: `Chat on ${date}`,
      text,
      metadata: { chat_run_id: run.id, occurred_at: run.started_at },
    });
    if (written > 0) {
      ingested++;
      chunksTotal += written;
    }
  }
  return { ingested, skipped, chunks: chunksTotal };
}

/**
 * Ingest every ontology entity for a tenant. Used after deploy-complete
 * and from the cron that keeps embeddings fresh.
 *
 * Skips entities that already have chunks AND haven't been updated since
 * their last ingestion (fast no-op for unchanged entities).
 */
export async function ingestOntology(tenantPhone: string): Promise<{ ingested: number; skipped: number; chunks: number }> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { ingested: 0, skipped: 0, chunks: 0 };

  const entRes = await fetch(
    `${SUPABASE_URL}/rest/v1/ontology_entities?tenant_phone=eq.${tenantPhone}&select=id,tenant_phone,entity_type,name,metadata,updated_at`,
    { headers: headers() },
  );
  if (!entRes.ok) return { ingested: 0, skipped: 0, chunks: 0 };
  const entities: (OntologyEntity & { updated_at: string })[] = await entRes.json();

  // For each entity, see if we already have chunks newer than its updated_at
  const chunkRes = await fetch(
    `${SUPABASE_URL}/rest/v1/knowledge_chunks?tenant_phone=eq.${tenantPhone}&select=source_entity_id,updated_at`,
    { headers: headers() },
  );
  const existingChunks: { source_entity_id: string; updated_at: string }[] = chunkRes.ok ? await chunkRes.json() : [];
  const latestChunkByEntity = new Map<string, number>();
  for (const c of existingChunks) {
    const ts = new Date(c.updated_at).getTime();
    const cur = latestChunkByEntity.get(c.source_entity_id) ?? 0;
    if (ts > cur) latestChunkByEntity.set(c.source_entity_id, ts);
  }

  let ingested = 0;
  let skipped = 0;
  let chunks = 0;
  for (const entity of entities) {
    const entityTs = new Date(entity.updated_at).getTime();
    const lastIngestTs = latestChunkByEntity.get(entity.id) ?? 0;
    if (lastIngestTs >= entityTs) {
      skipped++;
      continue;
    }
    const written = await ingestEntity(entity);
    if (written > 0) {
      ingested++;
      chunks += written;
    }
  }
  return { ingested, skipped, chunks };
}

/**
 * Ingest the owner's SENT emails — the canonical "what did I actually
 * say" recall layer. Pulled from Gmail's in:sent folder, redacted via
 * the shared PII helper (emails/phones/SSNs/CCs/addresses/IPs become
 * type markers like [EMAIL]), then embedded.
 *
 * Privacy posture (important for the project_security_epic / compliance):
 *   - Recipient addresses → [EMAIL] (the WHO is opaque, only the WHAT
 *     remains; the recipient is still identifiable via the email row
 *     in oauth_connections or the original Gmail thread if subpoenaed)
 *   - Phone numbers, SSNs, credit cards, street addresses, IPs → markers
 *   - Person names + company names + business content → preserved
 *     (intentional — losing names would defeat semantic recall like
 *     "what did I tell Ron about the timeline")
 *
 * This means a recovered chunk leaks names but NOT direct-contact
 * identifiers. The original raw mail still lives in the provider's
 * inbox — we're not the system of record. We're indexing for recall.
 *
 * Bounded to last 90 days. Watermarked + two-pass like other ingest
 * functions so the cron stays within the 60s budget.
 */
export interface SentEmailIngestResult {
  ingested: number;
  skipped: number;
  chunks: number;
  redactedAny: number;
  /** Emails that matched the owner's deny list and were skipped before
   *  embedding (privacy opt-out). Reported separately from skipped so
   *  the owner can see the privacy filter is working. */
  denied: number;
  /** True if the tenant has the master switch off. */
  disabled?: boolean;
}

export async function ingestSentEmails(
  tenantPhone: string,
  options: { maxRows?: number } = {},
): Promise<SentEmailIngestResult> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { ingested: 0, skipped: 0, chunks: 0, redactedAny: 0, denied: 0 };
  const maxRows = Math.max(2, Math.min(options.maxRows ?? 100, 100));
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');

  // Check the tenant's privacy prefs first. If disabled or unreachable,
  // skip cleanly — don't fail the cron.
  const prefs = await getEmailIndexingPrefs(cleanPhone);
  if (prefs && prefs.sent_emails_enabled === false) {
    return { ingested: 0, skipped: 0, chunks: 0, redactedAny: 0, denied: 0, disabled: true };
  }
  const denyAddrs = new Set(
    (prefs?.deny_addresses ?? []).map((a) => a.toLowerCase().trim()).filter(Boolean),
  );
  const denyDomains = (prefs?.deny_domains ?? []).map((d) => d.toLowerCase().trim().replace(/^\./, '')).filter(Boolean);

  // Find the tenant's active email connections (Gmail-only support today
  // — see listSentEmails in shared router).
  const connRes = await fetch(
    `${SUPABASE_URL}/rest/v1/oauth_connections?phone_number=eq.${cleanPhone}&service=eq.email&status=eq.active&provider=eq.google&select=phone_number,provider,service,account_email,access_token,refresh_token,expires_at,metadata`,
    { headers: headers() },
  );
  if (!connRes.ok) return { ingested: 0, skipped: 0, chunks: 0, redactedAny: 0, denied: 0 };
  const conns: OAuthConnection[] = await connRes.json();
  if (conns.length === 0) return { ingested: 0, skipped: 0, chunks: 0, redactedAny: 0, denied: 0 };
  const conn = conns[0]!;

  // Watermark — already-ingested sent-email IDs.
  const wmRes = await fetch(
    `${SUPABASE_URL}/rest/v1/knowledge_chunks?tenant_phone=eq.${cleanPhone}&source_kind=eq.email&select=source_row_id`,
    { headers: headers() },
  );
  const seen = new Set<string>(
    wmRes.ok ? ((await wmRes.json()) as Array<{ source_row_id: string }>).map((r) => r.source_row_id) : [],
  );

  // Pull recent sent emails (Gmail q=in:sent, 90 days, capped).
  const overFetch = Math.min(100, Math.max(maxRows, seen.size + maxRows));
  const listed = await listSentEmails(conn, { sinceDays: 90, limit: overFetch });
  if (!listed.success || !listed.data) {
    return { ingested: 0, skipped: 0, chunks: 0, redactedAny: 0, denied: 0 };
  }
  if (listed.data.length === 0) return { ingested: 0, skipped: 0, chunks: 0, redactedAny: 0, denied: 0 };

  let ingested = 0;
  let skipped = 0;
  let chunksTotal = 0;
  let redactedAnyCount = 0;
  let denied = 0;
  for (const mail of listed.data) {
    if (ingested >= maxRows) break;
    if (seen.has(mail.id)) {
      skipped++;
      continue;
    }
    // Privacy filter — if ANY recipient matches the owner's deny list,
    // skip the entire email. Conservative: one denied recipient on a
    // multi-recipient thread blocks the whole email rather than trying
    // to redact just one address.
    const recipients = (mail.to ?? []).concat(mail.cc ?? []);
    const matchesDeny = recipients.some((addr) => {
      const lower = addr.toLowerCase().trim();
      // Strip "Name <email>" wrappers if present
      const bare = lower.match(/<([^>]+)>/)?.[1] ?? lower;
      if (denyAddrs.has(bare)) return true;
      const domain = bare.split('@')[1];
      if (!domain) return false;
      return denyDomains.some((d) => domain === d || domain.endsWith(`.${d}`));
    });
    if (matchesDeny) {
      denied++;
      continue;
    }
    // Build the text we'll embed. Subject + recipients + body, all
    // redacted. Note: rawToEmail's `from` is the OWNER's own address
    // since these are sent items; the recipient lives in `to` / cc.
    const rawRecipients = (mail.to ?? []).join(', ');
    const rawText = [
      `Subject: ${mail.subject ?? ''}`,
      `To: ${rawRecipients}`,
      `Sent: ${mail.date}`,
      '',
      mail.body ?? mail.bodyPreview ?? '',
    ].join('\n');
    const { redacted, redactedAny } = redactPII(rawText);
    if (redactedAny) redactedAnyCount++;

    const sentDate = new Date(mail.date).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    const written = await ingestBehavioral({
      tenantPhone: cleanPhone,
      sourceKind: 'email',
      sourceRowId: mail.id,
      sourceName: `Sent: ${(mail.subject ?? '(no subject)').slice(0, 80)} (${sentDate})`,
      text: redacted,
      metadata: {
        kind: 'sent_email',
        sent_at: mail.date,
        provider: conn.provider,
        pii_redacted: redactedAny,
      },
    });
    if (written > 0) {
      ingested++;
      chunksTotal += written;
    }
  }
  return { ingested, skipped, chunks: chunksTotal, redactedAny: redactedAnyCount, denied };
}

/**
 * Mirror of ingestSentEmails for INBOX (received) mail. Same PII
 * redaction, same deny-list filtering (deny "kp.org" blocks mail FROM
 * kp.org addresses on this path, mail TO them on the sent path), but
 * gated by a separate `received_emails_enabled` master switch so the
 * owner can independently toggle each direction.
 *
 * Source kind is still 'email' (single bucket for both directions) —
 * metadata.kind distinguishes 'sent_email' vs 'received_email' for
 * filtering at query time.
 */
export async function ingestReceivedEmails(
  tenantPhone: string,
  options: { maxRows?: number } = {},
): Promise<SentEmailIngestResult> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { ingested: 0, skipped: 0, chunks: 0, redactedAny: 0, denied: 0 };
  const maxRows = Math.max(2, Math.min(options.maxRows ?? 100, 100));
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');

  // Privacy gate — separate master switch from sent emails.
  const prefs = await getEmailIndexingPrefs(cleanPhone);
  if (prefs && prefs.received_emails_enabled === false) {
    return { ingested: 0, skipped: 0, chunks: 0, redactedAny: 0, denied: 0, disabled: true };
  }
  const denyAddrs = new Set(
    (prefs?.deny_addresses ?? []).map((a) => a.toLowerCase().trim()).filter(Boolean),
  );
  const denyDomains = (prefs?.deny_domains ?? []).map((d) => d.toLowerCase().trim().replace(/^\./, '')).filter(Boolean);

  const connRes = await fetch(
    `${SUPABASE_URL}/rest/v1/oauth_connections?phone_number=eq.${cleanPhone}&service=eq.email&status=eq.active&provider=eq.google&select=phone_number,provider,service,account_email,access_token,refresh_token,expires_at,metadata`,
    { headers: headers() },
  );
  if (!connRes.ok) return { ingested: 0, skipped: 0, chunks: 0, redactedAny: 0, denied: 0 };
  const conns: OAuthConnection[] = await connRes.json();
  if (conns.length === 0) return { ingested: 0, skipped: 0, chunks: 0, redactedAny: 0, denied: 0 };
  const conn = conns[0]!;

  const wmRes = await fetch(
    `${SUPABASE_URL}/rest/v1/knowledge_chunks?tenant_phone=eq.${cleanPhone}&source_kind=eq.email&select=source_row_id`,
    { headers: headers() },
  );
  const seen = new Set<string>(
    wmRes.ok ? ((await wmRes.json()) as Array<{ source_row_id: string }>).map((r) => r.source_row_id) : [],
  );

  const overFetch = Math.min(100, Math.max(maxRows, seen.size + maxRows));
  const listed = await listReceivedEmails(conn, { sinceDays: 90, limit: overFetch });
  if (!listed.success || !listed.data) {
    return { ingested: 0, skipped: 0, chunks: 0, redactedAny: 0, denied: 0 };
  }
  if (listed.data.length === 0) return { ingested: 0, skipped: 0, chunks: 0, redactedAny: 0, denied: 0 };

  let ingested = 0;
  let skipped = 0;
  let chunksTotal = 0;
  let redactedAnyCount = 0;
  let denied = 0;
  for (const mail of listed.data) {
    if (ingested >= maxRows) break;
    if (seen.has(mail.id)) {
      skipped++;
      continue;
    }
    // Privacy filter — for received mail, the contact is the SENDER.
    // Check `from` against deny list.
    const fromLower = (mail.from ?? '').toLowerCase().trim();
    const fromBare = fromLower.match(/<([^>]+)>/)?.[1] ?? fromLower;
    const fromDomain = fromBare.split('@')[1];
    const isDenied =
      denyAddrs.has(fromBare) ||
      (fromDomain ? denyDomains.some((d) => fromDomain === d || fromDomain.endsWith(`.${d}`)) : false);
    if (isDenied) {
      denied++;
      continue;
    }
    const rawText = [
      `From: ${mail.fromName ? `${mail.fromName} <${mail.from}>` : mail.from}`,
      `Subject: ${mail.subject ?? ''}`,
      `Received: ${mail.date}`,
      '',
      mail.body ?? mail.bodyPreview ?? '',
    ].join('\n');
    const { redacted, redactedAny } = redactPII(rawText);
    if (redactedAny) redactedAnyCount++;

    const receivedDate = new Date(mail.date).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    const written = await ingestBehavioral({
      tenantPhone: cleanPhone,
      sourceKind: 'email',
      sourceRowId: mail.id,
      sourceName: `Received: ${(mail.subject ?? '(no subject)').slice(0, 80)} (${receivedDate})`,
      text: redacted,
      metadata: {
        kind: 'received_email',
        received_at: mail.date,
        sender: fromBare,
        provider: conn.provider,
        pii_redacted: redactedAny,
      },
    });
    if (written > 0) {
      ingested++;
      chunksTotal += written;
    }
  }
  return { ingested, skipped, chunks: chunksTotal, redactedAny: redactedAnyCount, denied };
}

// ─── Email indexing preferences (privacy controls) ──────────────────────

export interface EmailIndexingPrefs {
  tenant_phone: string;
  sent_emails_enabled: boolean;
  /** Added 2026-05-18 — separate master switch for inbox-side indexing
   *  so owner can independently toggle each direction. Default true. */
  received_emails_enabled: boolean;
  deny_addresses: string[];
  deny_domains: string[];
  notes?: string;
  updated_at: string;
}

/**
 * Fetch the tenant's email indexing prefs. Returns null if the row
 * doesn't exist (treat as defaults: enabled, empty deny lists).
 */
export async function getEmailIndexingPrefs(
  tenantPhone: string,
): Promise<EmailIndexingPrefs | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_email_indexing_prefs?tenant_phone=eq.${cleanPhone}&limit=1`,
      { headers: headers() },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return Array.isArray(rows) && rows.length > 0 ? (rows[0] as EmailIndexingPrefs) : null;
  } catch {
    return null;
  }
}

/**
 * Upsert the tenant's email indexing prefs. Caller passes only the
 * fields they want to change — others are preserved.
 */
export async function setEmailIndexingPrefs(
  tenantPhone: string,
  patch: Partial<Pick<EmailIndexingPrefs, 'sent_emails_enabled' | 'received_emails_enabled' | 'deny_addresses' | 'deny_domains' | 'notes'>>,
): Promise<EmailIndexingPrefs | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  const existing = await getEmailIndexingPrefs(cleanPhone);
  const body = {
    tenant_phone: cleanPhone,
    sent_emails_enabled: patch.sent_emails_enabled ?? existing?.sent_emails_enabled ?? true,
    received_emails_enabled: patch.received_emails_enabled ?? existing?.received_emails_enabled ?? true,
    deny_addresses: patch.deny_addresses ?? existing?.deny_addresses ?? [],
    deny_domains: patch.deny_domains ?? existing?.deny_domains ?? [],
    notes: patch.notes ?? existing?.notes ?? null,
  };
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_email_indexing_prefs?on_conflict=tenant_phone`,
      {
        method: 'POST',
        headers: {
          ...headers(),
          Prefer: 'resolution=merge-duplicates,return=representation',
        },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      console.warn('[email-indexing-prefs] upsert failed:', res.status, await res.text());
      return null;
    }
    const rows = await res.json();
    return Array.isArray(rows) && rows.length > 0 ? (rows[0] as EmailIndexingPrefs) : null;
  } catch (err) {
    console.warn('[email-indexing-prefs] upsert exception:', err);
    return null;
  }
}

/**
 * Delete every indexed sent-email chunk for the tenant where the
 * recipient matches the given pattern (exact address OR domain).
 * Called after the owner adds a deny rule so previously-indexed mail
 * to that recipient is retroactively removed from the vector store.
 *
 * Returns the count of chunks deleted.
 */
export async function purgeSentEmailChunks(
  tenantPhone: string,
  pattern: { address?: string; domain?: string },
): Promise<number> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return 0;
  if (!pattern.address && !pattern.domain) return 0;
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');

  // Pull all email-source chunks for this tenant and filter client-side
  // — content embedding strings have the form "Subject: ... | To: <addr>".
  // Cheap enough at typical chunk counts (<1k per tenant).
  const listRes = await fetch(
    `${SUPABASE_URL}/rest/v1/knowledge_chunks?tenant_phone=eq.${cleanPhone}&source_kind=eq.email&select=id,content`,
    { headers: headers() },
  );
  if (!listRes.ok) return 0;
  const rows: Array<{ id: string; content: string }> = await listRes.json();
  const toDelete = rows
    .filter((r) => {
      const c = r.content.toLowerCase();
      if (pattern.address && c.includes(pattern.address.toLowerCase())) return true;
      if (pattern.domain) {
        const d = pattern.domain.toLowerCase().replace(/^\./, '');
        // Match an @ prefix so we don't false-match the domain inside a body
        if (c.includes(`@${d}`)) return true;
      }
      return false;
    })
    .map((r) => r.id);

  if (toDelete.length === 0) return 0;

  // Delete in chunks of 50 to keep URL length reasonable.
  let deleted = 0;
  for (let i = 0; i < toDelete.length; i += 50) {
    const batch = toDelete.slice(i, i + 50);
    const ids = batch.map((id) => `"${id}"`).join(',');
    const delRes = await fetch(
      `${SUPABASE_URL}/rest/v1/knowledge_chunks?id=in.(${ids})`,
      {
        method: 'DELETE',
        headers: { ...headers(), Prefer: 'return=representation' },
      },
    );
    if (delRes.ok) {
      const out = await delRes.json().catch(() => []);
      deleted += Array.isArray(out) ? out.length : batch.length;
    }
  }
  return deleted;
}

export interface KnowledgeMatch {
  id: string;
  content: string;
  source_entity_id: string;
  source_entity_type: string;
  source_entity_name: string;
  source_kind?: 'ontology' | 'atom' | 'conversation' | 'document' | 'visit' | 'insight' | 'email';
  chunk_index: number;
  similarity: number;
}

/**
 * Embed the question, find the top N most-similar chunks for this tenant,
 * return them with citations. Caller composes the answer using these
 * snippets as context.
 *
 * Audit trail: every call lands in agent_runs with phase='analyze' so the
 * KB usage shows up in the activity feed and per-tenant token accounting.
 * (Story 2.9 AC: "all queries and responses are tenant-scoped and audit-logged".)
 * Pass `audit: false` for internal pre-flight calls that shouldn't pollute
 * the feed (e.g. background error-checks the user never asked for).
 */
export async function queryKnowledge(
  tenantPhone: string,
  question: string,
  options: {
    limit?: number;
    minSimilarity?: number;
    audit?: boolean;
    source?: string;
    /** Filter by source kind. Defaults to all kinds. Pass ['atom',
     *  'conversation', 'document', 'visit', 'insight', 'email'] for
     *  behavioral-only recall; ['ontology'] for ontology-only. */
    sourceKinds?: Array<'ontology' | 'atom' | 'conversation' | 'document' | 'visit' | 'insight' | 'email'>;
  } = {},
): Promise<{ matches: KnowledgeMatch[]; embedTokens: number }> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { matches: [], embedTokens: 0 };

  const { embedding, tokens } = await embedText(question);
  const body: Record<string, unknown> = {
    p_tenant_phone: tenantPhone,
    p_query_embedding: embedding,
    p_match_count: options.limit ?? 5,
    p_min_similarity: options.minSimilarity ?? 0.4,
  };
  if (options.sourceKinds && options.sourceKinds.length > 0) {
    body.p_source_kinds = options.sourceKinds;
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/match_knowledge`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.warn('[kb] match_knowledge failed:', res.status, await res.text());
    return { matches: [], embedTokens: tokens };
  }
  const matches: KnowledgeMatch[] = await res.json();

  // Fire-and-forget audit log. Never block the query result on this.
  if (options.audit !== false) {
    void logKnowledgeQuery({
      tenantPhone,
      question,
      matches,
      embedTokens: tokens,
      source: options.source ?? 'agent',
    });
  }

  return { matches, embedTokens: tokens };
}

/**
 * Write a structured agent_runs row capturing a KB query: the question,
 * which chunks matched, top similarity, and the tokens spent on the embed.
 * Lives in the activity feed; aggregated by usage-tracker for the dashboard.
 */
async function logKnowledgeQuery(args: {
  tenantPhone: string;
  question: string;
  matches: KnowledgeMatch[];
  embedTokens: number;
  source: string;
}): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  const topSim = args.matches[0]?.similarity ?? 0;
  const sourceTypes = Array.from(new Set(args.matches.map((m) => m.source_entity_type)));
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/agent_runs`, {
      method: 'POST',
      headers: { ...headers(), Prefer: 'return=minimal' },
      body: JSON.stringify({
        tenant_phone: args.tenantPhone,
        trigger: 'manual',
        phase: 'analyze',
        outcome: args.matches.length > 0 ? 'observed' : 'no_signal',
        input_summary: redactPII(`[KB] ${args.question.slice(0, 200)}`).redacted,
        output_summary: args.matches.length > 0
          ? `${args.matches.length} match${args.matches.length === 1 ? '' : 'es'} (top ${(topSim * 100).toFixed(0)}%) from ${sourceTypes.join(', ')}`
          : 'no matches',
        metadata: {
          kb_query: redactPII(args.question.slice(0, 500)).redacted,
          kb_source: args.source,
          embed_tokens: args.embedTokens,
          match_count: args.matches.length,
          top_similarity: topSim,
          matched_chunk_ids: args.matches.map((m) => m.id),
          matched_entities: args.matches.map((m) => ({
            type: m.source_entity_type,
            name: m.source_entity_name,
            similarity: m.similarity,
          })),
        },
      }),
    });
  } catch (err) {
    console.warn('[kb] audit log failed:', err);
  }
}

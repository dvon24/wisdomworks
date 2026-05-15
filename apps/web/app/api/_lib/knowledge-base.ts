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
import { redactPII } from '@wisdomworks/shared';

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

  // Upsert by (source_kind, source_row_id, chunk_index) so re-ingesting
  // the same source row overwrites cleanly without duplicating.
  const res = await fetch(`${SUPABASE_URL}/rest/v1/knowledge_chunks`, {
    method: 'POST',
    headers: { ...headers(), Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  });
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

  const res = await fetch(`${SUPABASE_URL}/rest/v1/knowledge_chunks`, {
    method: 'POST',
    headers: { ...headers(), Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  });
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
): Promise<{ ingested: number; skipped: number; chunks: number }> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { ingested: 0, skipped: 0, chunks: 0 };
  // Pull all live atoms for this tenant.
  const atomsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/knowledge_atoms?tenant_phone=eq.${tenantPhone}&status=neq.archived&select=id,kind,content,tags,owner_confirmed,updated_at&order=updated_at.desc&limit=500`,
    { headers: headers() },
  );
  if (!atomsRes.ok) return { ingested: 0, skipped: 0, chunks: 0 };
  const atoms: Array<{ id: string; kind: string; content: string; tags?: string[]; owner_confirmed?: boolean; updated_at: string }> =
    await atomsRes.json();
  if (atoms.length === 0) return { ingested: 0, skipped: 0, chunks: 0 };

  // Watermark: chunks already ingested for this kind, keyed by source_row_id.
  const wmRes = await fetch(
    `${SUPABASE_URL}/rest/v1/knowledge_chunks?tenant_phone=eq.${tenantPhone}&source_kind=eq.atom&select=source_row_id,updated_at`,
    { headers: headers() },
  );
  const wmRows: Array<{ source_row_id: string; updated_at: string }> = wmRes.ok ? await wmRes.json() : [];
  const wm = new Map<string, number>();
  for (const r of wmRows) {
    const ts = new Date(r.updated_at).getTime();
    if (ts > (wm.get(r.source_row_id) ?? 0)) wm.set(r.source_row_id, ts);
  }

  let ingested = 0;
  let skipped = 0;
  let chunksTotal = 0;
  for (const atom of atoms) {
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
): Promise<{ ingested: number; skipped: number; chunks: number }> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { ingested: 0, skipped: 0, chunks: 0 };
  const since = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
  const insRes = await fetch(
    `${SUPABASE_URL}/rest/v1/business_insights?tenant_phone=eq.${tenantPhone}&detected_at=gte.${since}&select=id,detector,severity,title,why,recommended_action,expected_impact,status,detected_at&order=detected_at.desc&limit=300`,
    { headers: headers() },
  );
  if (!insRes.ok) return { ingested: 0, skipped: 0, chunks: 0 };
  const insights: Array<{
    id: string;
    detector: string;
    severity: string;
    title: string;
    why?: string;
    recommended_action?: string;
    expected_impact?: string;
    status: string;
    detected_at: string;
  }> = await insRes.json();
  if (insights.length === 0) return { ingested: 0, skipped: 0, chunks: 0 };

  const wmRes = await fetch(
    `${SUPABASE_URL}/rest/v1/knowledge_chunks?tenant_phone=eq.${tenantPhone}&source_kind=eq.insight&select=source_row_id`,
    { headers: headers() },
  );
  const seen = new Set<string>(
    wmRes.ok ? ((await wmRes.json()) as Array<{ source_row_id: string }>).map((r) => r.source_row_id) : [],
  );

  let ingested = 0;
  let skipped = 0;
  let chunksTotal = 0;
  for (const ins of insights) {
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
): Promise<{ ingested: number; skipped: number; chunks: number }> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { ingested: 0, skipped: 0, chunks: 0 };
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const runsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/chat_runs?tenant_phone=eq.${tenantPhone}&created_at=gte.${since}&select=id,user_message_preview,assistant_reply_preview,created_at&order=created_at.desc&limit=300`,
    { headers: headers() },
  );
  if (!runsRes.ok) return { ingested: 0, skipped: 0, chunks: 0 };
  const runs: Array<{
    id: string;
    user_message_preview?: string;
    assistant_reply_preview?: string;
    created_at: string;
  }> = await runsRes.json();
  if (runs.length === 0) return { ingested: 0, skipped: 0, chunks: 0 };

  const wmRes = await fetch(
    `${SUPABASE_URL}/rest/v1/knowledge_chunks?tenant_phone=eq.${tenantPhone}&source_kind=eq.conversation&select=source_row_id`,
    { headers: headers() },
  );
  const seen = new Set<string>(
    wmRes.ok ? ((await wmRes.json()) as Array<{ source_row_id: string }>).map((r) => r.source_row_id) : [],
  );

  let ingested = 0;
  let skipped = 0;
  let chunksTotal = 0;
  for (const run of runs) {
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
    const date = new Date(run.created_at).toLocaleString('en-US', {
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
      metadata: { chat_run_id: run.id, occurred_at: run.created_at },
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

export interface KnowledgeMatch {
  id: string;
  content: string;
  source_entity_id: string;
  source_entity_type: string;
  source_entity_name: string;
  source_kind?: 'ontology' | 'atom' | 'conversation' | 'document' | 'visit' | 'insight';
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
     *  'conversation', 'document', 'visit', 'insight'] for
     *  behavioral-only recall; ['ontology'] for ontology-only. */
    sourceKinds?: Array<'ontology' | 'atom' | 'conversation' | 'document' | 'visit' | 'insight'>;
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

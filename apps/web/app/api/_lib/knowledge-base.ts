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
    source_entity_id: entity.id,
    source_entity_type: entity.entity_type,
    source_entity_name: entity.name,
    chunk_index: i,
    content,
    embedding: embeddings[i]?.embedding,
    tokens: embeddings[i]?.tokens ?? estimateTokens(content),
    metadata: { ingested_at: new Date().toISOString() },
  }));

  // Upsert by (source_entity_id, chunk_index) so re-ingesting the same
  // entity overwrites cleanly without duplicating.
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
  chunk_index: number;
  similarity: number;
}

/**
 * Embed the question, find the top N most-similar chunks for this tenant,
 * return them with citations. Caller composes the answer using these
 * snippets as context.
 */
export async function queryKnowledge(
  tenantPhone: string,
  question: string,
  options: { limit?: number; minSimilarity?: number } = {},
): Promise<{ matches: KnowledgeMatch[]; embedTokens: number }> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { matches: [], embedTokens: 0 };

  const { embedding, tokens } = await embedText(question);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/match_knowledge`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      p_tenant_phone: tenantPhone,
      p_query_embedding: embedding,
      p_match_count: options.limit ?? 5,
      p_min_similarity: options.minSimilarity ?? 0.4,
    }),
  });
  if (!res.ok) {
    console.warn('[kb] match_knowledge failed:', res.status, await res.text());
    return { matches: [], embedTokens: tokens };
  }
  const matches: KnowledgeMatch[] = await res.json();
  return { matches, embedTokens: tokens };
}

/**
 * OpenAI embeddings wrapper.
 *
 * We use OpenAI's text-embedding-3-small (1536 dims) because Anthropic
 * doesn't have an embeddings API. Cost is negligible:
 *   $0.02 / 1M input tokens. A 50-entity ontology averages ~50K tokens
 *   to ingest, so each onboarding costs ~$0.001 in embeddings.
 *
 * Embeddings come back pre-normalized, so cosine similarity in pgvector
 * is just a dot product (fast). Match function in
 * 2026-05-10-pgvector-knowledge-base.sql uses vector_cosine_ops.
 */

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_EMBED_URL = 'https://api.openai.com/v1/embeddings';
const EMBED_MODEL = 'text-embedding-3-small';
const EMBED_DIMS = 1536;

export interface EmbeddingResult {
  embedding: number[];
  tokens: number;
}

/**
 * Embed a single text. Throws on API failure (caller should catch and
 * decide whether to skip or fail the whole ingestion).
 */
export async function embedText(text: string): Promise<EmbeddingResult> {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured');
  if (!text?.trim()) throw new Error('embedText called with empty text');

  const res = await fetch(OPENAI_EMBED_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: EMBED_MODEL,
      input: text,
      // Force 1536 dims so the pgvector column always matches
      dimensions: EMBED_DIMS,
    }),
  });

  if (!res.ok) {
    throw new Error(`OpenAI embeddings ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  const embedding = data.data?.[0]?.embedding;
  const tokens = data.usage?.total_tokens ?? 0;
  if (!embedding || !Array.isArray(embedding)) {
    throw new Error('OpenAI returned no embedding');
  }
  return { embedding, tokens };
}

/**
 * Batch-embed multiple texts in one request. OpenAI handles up to 2048
 * inputs per request and returns embeddings in the same order.
 */
export async function embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured');
  const filtered = texts.filter((t) => t?.trim());
  if (filtered.length === 0) return [];

  const res = await fetch(OPENAI_EMBED_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: EMBED_MODEL,
      input: filtered,
      dimensions: EMBED_DIMS,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI embeddings ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const items = data.data ?? [];
  if (items.length !== filtered.length) {
    throw new Error(`OpenAI returned ${items.length} embeddings for ${filtered.length} inputs`);
  }
  // Total token usage gets attributed proportionally — useful for budget tracking
  const totalTokens = data.usage?.total_tokens ?? 0;
  const perItem = totalTokens > 0 ? Math.round(totalTokens / filtered.length) : 0;
  return items
    .sort((a: any, b: any) => a.index - b.index)
    .map((item: any) => ({ embedding: item.embedding, tokens: perItem }));
}

/**
 * Token count estimator — rough but cheap. OpenAI uses ~4 chars per token
 * on English text. Used for chunking decisions where we don't want to pay
 * for the precise tokenizer.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

-- Story 2.9 — Knowledge Base & Error Prevention (full enterprise).
--
-- Enables pgvector and creates the knowledge_chunks store + a cosine
-- similarity match function. Each chunk references a source ontology
-- entity so query results can cite their origin (FR15).
--
-- Run once in the Supabase SQL Editor.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_phone TEXT NOT NULL,
  -- The ontology entity this chunk was derived from (cite-back source).
  source_entity_id UUID REFERENCES ontology_entities(id) ON DELETE CASCADE,
  source_entity_type TEXT,
  source_entity_name TEXT,
  -- Position within the source so we can reassemble or show which slice
  chunk_index INTEGER NOT NULL DEFAULT 0,
  content TEXT NOT NULL,
  -- text-embedding-3-small is 1536 dims. If we ever upgrade to -large
  -- (3072 dims), spin a new column rather than ALTER (HNSW won't survive).
  embedding vector(1536),
  tokens INTEGER,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Same source can't have two chunks at the same position
  UNIQUE (source_entity_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS knowledge_chunks_tenant_idx
  ON knowledge_chunks (tenant_phone);
CREATE INDEX IF NOT EXISTS knowledge_chunks_source_idx
  ON knowledge_chunks (source_entity_id);

-- HNSW index on embedding for fast approximate nearest neighbor search.
-- m=16 + ef_construction=64 are pgvector's recommended defaults; cosine
-- ops because we're storing normalized embeddings (OpenAI returns them
-- pre-normalized).
CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_hnsw_idx
  ON knowledge_chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Auto-touch updated_at
CREATE OR REPLACE FUNCTION knowledge_chunks_touch()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS knowledge_chunks_touch ON knowledge_chunks;
CREATE TRIGGER knowledge_chunks_touch BEFORE UPDATE ON knowledge_chunks
  FOR EACH ROW EXECUTE FUNCTION knowledge_chunks_touch();

-- ─── Match function — cosine similarity search ──────────────────────────
-- Caller passes a query embedding; we return top N chunks with their
-- source entity reference and similarity score (1 - cosine distance).
-- Tenant-scoped at the function level so query writers can't leak
-- across tenants by accident.

CREATE OR REPLACE FUNCTION match_knowledge(
  p_tenant_phone TEXT,
  p_query_embedding vector(1536),
  p_match_count INTEGER DEFAULT 5,
  p_min_similarity FLOAT DEFAULT 0.5
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  source_entity_id UUID,
  source_entity_type TEXT,
  source_entity_name TEXT,
  chunk_index INTEGER,
  similarity FLOAT,
  metadata JSONB
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    kc.id,
    kc.content,
    kc.source_entity_id,
    kc.source_entity_type,
    kc.source_entity_name,
    kc.chunk_index,
    1 - (kc.embedding <=> p_query_embedding) AS similarity,
    kc.metadata
  FROM knowledge_chunks kc
  WHERE kc.tenant_phone = p_tenant_phone
    AND kc.embedding IS NOT NULL
    AND 1 - (kc.embedding <=> p_query_embedding) >= p_min_similarity
  ORDER BY kc.embedding <=> p_query_embedding
  LIMIT p_match_count;
$$;

SELECT 'pgvector + knowledge_chunks ready' AS status;

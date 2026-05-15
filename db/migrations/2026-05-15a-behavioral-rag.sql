-- Story 2.9 Phase 2 — Behavioral RAG.
--
-- The original knowledge_chunks schema (2026-05-10) hard-wired
-- source_entity_id to ontology_entities only. queryKnowledge was
-- already designed for behavioral sources (sourceKinds filter), but
-- there was no place to actually store them.
--
-- This migration:
--   1. Adds source_kind + source_row_id discriminator columns so the
--      same table can hold ontology chunks AND behavioral chunks
--      (knowledge_atoms, chat_runs, client visits, emails, insights).
--   2. Backfills existing rows with source_kind='ontology'.
--   3. Drops the (source_entity_id, chunk_index) uniqueness — that
--      constraint only made sense when every chunk had an ontology FK.
--      Replaces it with a kind-aware uniqueness so re-ingesting the
--      same source row overwrites cleanly.
--   4. Updates match_knowledge to optionally filter by source_kind.
--
-- IDEMPOTENT — safe to re-run.

ALTER TABLE knowledge_chunks
  ADD COLUMN IF NOT EXISTS source_kind TEXT,
  ADD COLUMN IF NOT EXISTS source_row_id TEXT;

-- Backfill: every existing row came from the ontology ingest path.
UPDATE knowledge_chunks
   SET source_kind = 'ontology',
       source_row_id = COALESCE(source_row_id, source_entity_id::text)
 WHERE source_kind IS NULL;

-- Useful index for filtering by kind during recall.
CREATE INDEX IF NOT EXISTS knowledge_chunks_kind_idx
  ON knowledge_chunks (tenant_phone, source_kind);

-- The old uniqueness (source_entity_id, chunk_index) is a problem for
-- behavioral chunks because source_entity_id is NULL for non-ontology
-- sources. Drop it and add a kind-aware replacement: same source row
-- can't have two chunks at the same index.
ALTER TABLE knowledge_chunks
  DROP CONSTRAINT IF EXISTS knowledge_chunks_source_entity_id_chunk_index_key;

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_chunks_kind_row_idx_uq
  ON knowledge_chunks (tenant_phone, source_kind, source_row_id, chunk_index)
  WHERE source_row_id IS NOT NULL;

-- ─── Updated match_knowledge — accepts optional source_kinds filter ──
--
-- Backwards-compatible: callers that don't pass p_source_kinds get the
-- old behavior (search across everything). New callers can scope to
-- behavioral content ('atom', 'conversation', 'visit', 'document',
-- 'insight') or ontology-only ('ontology').
--
-- Drop both the original 4-arg signature AND any prior 5-arg variant
-- before recreating — CREATE OR REPLACE can't change the RETURNS shape
-- (we're adding source_kind + source_row_id columns to the result set).

DROP FUNCTION IF EXISTS match_knowledge(TEXT, vector, INTEGER, FLOAT);
DROP FUNCTION IF EXISTS match_knowledge(TEXT, vector, INTEGER, FLOAT, TEXT[]);

CREATE OR REPLACE FUNCTION match_knowledge(
  p_tenant_phone TEXT,
  p_query_embedding vector(1536),
  p_match_count INTEGER DEFAULT 5,
  p_min_similarity FLOAT DEFAULT 0.5,
  p_source_kinds TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  source_entity_id UUID,
  source_entity_type TEXT,
  source_entity_name TEXT,
  source_kind TEXT,
  source_row_id TEXT,
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
    kc.source_kind,
    kc.source_row_id,
    kc.chunk_index,
    1 - (kc.embedding <=> p_query_embedding) AS similarity,
    kc.metadata
  FROM knowledge_chunks kc
  WHERE kc.tenant_phone = p_tenant_phone
    AND kc.embedding IS NOT NULL
    AND 1 - (kc.embedding <=> p_query_embedding) >= p_min_similarity
    AND (p_source_kinds IS NULL OR kc.source_kind = ANY(p_source_kinds))
  ORDER BY kc.embedding <=> p_query_embedding
  LIMIT p_match_count;
$$;

SELECT 'behavioral RAG schema ready (source_kind + source_row_id)' AS status;

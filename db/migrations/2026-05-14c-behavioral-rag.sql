-- Behavioral RAG — extend knowledge_chunks for non-ontology sources.
--
-- Phase 1 (already shipped) — knowledge_chunks indexes the ONTOLOGY
-- layer (roles, capabilities, risks, tasks, projects, employees,
-- departments, decisions, documentation) via ingestOntology + the
-- knowledge-refresh cron. Semantic search works over that.
--
-- Phase 2 (this) — also index the BEHAVIORAL layer: durable facts
-- from conversations (knowledge_atoms), client visit summaries
-- (client_profiles.visits), analyzed document summaries
-- (received_documents.summary), historical business_insights, and
-- chunked-out conversation_history.
--
-- The existing source_entity_id had a hard FK to ontology_entities
-- (CASCADE on delete) — too restrictive for the new sources. We
-- relax it to a soft "source id" column without a foreign key, and
-- add a source_kind discriminator so the query layer can filter
-- by behavioral vs ontology vs both.
--
-- Run once in the Supabase SQL Editor.

-- 1. Drop the ontology FK so any UUID can sit in source_entity_id
ALTER TABLE knowledge_chunks
  DROP CONSTRAINT IF EXISTS knowledge_chunks_source_entity_id_fkey;

-- 2. Add source_kind discriminator. Default to 'ontology' so prior
--    rows continue to behave as expected.
ALTER TABLE knowledge_chunks
  ADD COLUMN IF NOT EXISTS source_kind TEXT NOT NULL DEFAULT 'ontology';

-- 3. Backfill existing rows. Anything with source_entity_id set
--    came from the ontology ingester.
UPDATE knowledge_chunks SET source_kind = 'ontology' WHERE source_kind IS NULL;

-- 4. Constraint on the set of kinds we support today
ALTER TABLE knowledge_chunks
  DROP CONSTRAINT IF EXISTS knowledge_chunks_source_kind_check;
ALTER TABLE knowledge_chunks
  ADD CONSTRAINT knowledge_chunks_source_kind_check
  CHECK (source_kind IN (
    'ontology',
    'atom',
    'conversation',
    'document',
    'visit',
    'insight'
  ));

-- 5. Index on (tenant, source_kind) so the behavioral-only or
--    ontology-only filters are cheap.
CREATE INDEX IF NOT EXISTS knowledge_chunks_kind_idx
  ON knowledge_chunks (tenant_phone, source_kind);

-- 6. Extend the match_knowledge RPC to accept an optional source_kind
--    filter. Existing callers with no filter still get all kinds.
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
    kc.chunk_index,
    1 - (kc.embedding <=> p_query_embedding) AS similarity,
    kc.metadata
  FROM knowledge_chunks kc
  WHERE kc.tenant_phone = p_tenant_phone
    AND kc.embedding IS NOT NULL
    AND 1 - (kc.embedding <=> p_query_embedding) >= p_min_similarity
    AND (p_source_kinds IS NULL OR kc.source_kind = ANY (p_source_kinds))
  ORDER BY kc.embedding <=> p_query_embedding
  LIMIT p_match_count;
$$;

-- 7. Tracking columns on each behavioral source so the refresh cron
--    knows what's already indexed (idempotent — pulls rows with
--    last_indexed_at IS NULL OR updated_at > last_indexed_at).
--
--    Guarded so this migration is order-resilient — if a source table
--    hasn't been created yet (you skipped a prior migration), we just
--    skip its column. The ingester no-ops gracefully when a source
--    table is missing, so re-running this migration after the prereq
--    is safe.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'knowledge_atoms') THEN
    ALTER TABLE knowledge_atoms ADD COLUMN IF NOT EXISTS last_indexed_at TIMESTAMPTZ;
  ELSE
    RAISE NOTICE 'knowledge_atoms not found — skipping last_indexed_at column. Run 2026-05-12-tenant-knowledge-atoms.sql first, then re-run this migration.';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'received_documents') THEN
    ALTER TABLE received_documents ADD COLUMN IF NOT EXISTS last_indexed_at TIMESTAMPTZ;
  ELSE
    RAISE NOTICE 'received_documents not found — skipping last_indexed_at column. Run 2026-05-13d-received-documents.sql first, then re-run this migration.';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'business_insights') THEN
    ALTER TABLE business_insights ADD COLUMN IF NOT EXISTS last_indexed_at TIMESTAMPTZ;
  ELSE
    RAISE NOTICE 'business_insights not found — skipping last_indexed_at column. Run 2026-05-13-business-insights.sql first, then re-run this migration.';
  END IF;
END
$$;

-- client_profiles.visits + conversation chunks don't have their own
-- "updated_at" — we use the chunk's stable signature for dedup
-- instead. No column needed.

SELECT 'behavioral RAG schema ready' AS status;

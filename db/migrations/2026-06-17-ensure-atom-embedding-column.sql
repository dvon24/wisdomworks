-- 2026-06-17 — Guarantee the embedding column EXISTS on tenant_knowledge_atoms.
--
-- ROOT CAUSE of the recurring "save failed (system memory error)" that survived
-- #48 (embedding best-effort), #54 (NULL-tags) and #55 (scoped load):
--
-- The embedding column + the FIRST upsert_knowledge_atom that references it were
-- introduced TOGETHER in 2026-06-05-atom-semantic-dedup.sql. Every later
-- migration (2026-06-05-atom-dedup-threshold-tune, 2026-06-09-atom-upsert-null-
-- tags-fix) only does CREATE OR REPLACE FUNCTION — it re-defines the function but
-- NEVER re-adds the column. plpgsql does NOT validate column references at
-- CREATE time (only at first execution), so the function installs cleanly even
-- when the column is absent, then throws at runtime:
--     column "embedding" of relation "tenant_knowledge_atoms" does not exist
-- → PostgREST returns 4xx → upsertAtomWithReason surfaces it (that's the
-- "missing embedding column" message the owner now sees, post-#54 error relay).
--
-- If 2026-06-05-atom-semantic-dedup.sql was skipped (or errored partway) while
-- the later fixes were applied — which is exactly what the live behavior shows —
-- the column is missing and EVERY atom save fails. The retry-without-embedding
-- in #54 doesn't help: the TS caller always sends the p_embedding KEY (value
-- null), so PostgREST still routes to the embedding-aware overload and still
-- hits the missing column.
--
-- This migration is the idempotent floor: ensure the extension, the column, and
-- the dedup index all exist. Safe to run regardless of prior state — every
-- statement is IF NOT EXISTS, so it's a no-op if 2026-06-05 was already applied.
--
-- DIAGNOSTIC (run first in the Supabase SQL editor to confirm the cause):
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'tenant_knowledge_atoms' AND column_name = 'embedding';
--   -- 0 rows  → column missing → THIS was the bug; apply below.
--   -- 1 row   → column present → the save error is something else; tell me the
--   --           exact Postgres message Iris relayed and we look elsewhere.

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE tenant_knowledge_atoms ADD COLUMN IF NOT EXISTS embedding vector(1536);

CREATE INDEX IF NOT EXISTS tenant_knowledge_atoms_embedding_hnsw_idx
  ON tenant_knowledge_atoms USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL AND status = 'active';

-- Confirm the column is now present (returns the column row).
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'tenant_knowledge_atoms' AND column_name = 'embedding';

SELECT 'tenant_knowledge_atoms.embedding ensured — atom saves can now persist' AS status;

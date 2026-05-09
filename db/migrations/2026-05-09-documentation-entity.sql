-- Story 1.13 — allow 'documentation' as an ontology entity_type.
--
-- The ontology now holds organizational documentation entities (mission,
-- tool inventory, operational patterns) so the discovered facts about the
-- business live next to the structural graph.
--
-- Run once in the Supabase SQL Editor.

DO $$
DECLARE
  conname TEXT;
BEGIN
  SELECT con.conname INTO conname
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'ontology_entities'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%entity_type%';

  IF conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE ontology_entities DROP CONSTRAINT %I', conname);
    RAISE NOTICE 'Dropped existing entity_type constraint: %', conname;
  END IF;
END $$;

ALTER TABLE ontology_entities
  ADD CONSTRAINT ontology_entities_type_check
  CHECK (entity_type IN (
    'employee', 'role', 'department', 'project', 'client',
    'capability', 'risk', 'decision', 'task', 'innovation',
    'documentation', 'integration'
  ));

SELECT 'documentation + integration entity types now allowed' AS status;

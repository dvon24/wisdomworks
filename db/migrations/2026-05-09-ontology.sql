-- Story 1.10 — Ontology tables.
--
-- The ontology is the structural model of the customer's business: who works
-- there, what departments exist, which clients matter, what capabilities the
-- org has. Agents use it to ground their answers in real organizational
-- structure instead of generic guesses.
--
-- Two tables:
--   ontology_entities      — typed nodes (employee, department, project, etc)
--   ontology_relationships — typed edges between entities
--
-- Both are tenant-scoped (keyed by tenant_phone for now to match the rest of
-- the schema; a future migration introduces a real tenant_id).
--
-- Run once in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS ontology_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_phone TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  name TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Soft-link to a higher-level grouping (e.g. an employee's department) for
  -- UI rendering. Real edges live in ontology_relationships.
  parent_id UUID REFERENCES ontology_entities(id) ON DELETE SET NULL,
  -- 'human' | 'agent_inferred' | 'axis_validated' — provenance for the
  -- review/cross-validation work in 1.10b.
  source TEXT NOT NULL DEFAULT 'agent_inferred',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ontology_entities_type_check CHECK (
    entity_type IN ('employee', 'role', 'department', 'project', 'client', 'capability', 'risk', 'decision', 'task', 'innovation')
  ),
  CONSTRAINT ontology_entities_source_check CHECK (
    source IN ('human', 'agent_inferred', 'axis_validated')
  ),
  -- Same logical entity can't appear twice in one tenant under the same type.
  UNIQUE (tenant_phone, entity_type, name)
);

CREATE INDEX IF NOT EXISTS ontology_entities_tenant_idx
  ON ontology_entities (tenant_phone, entity_type);

CREATE INDEX IF NOT EXISTS ontology_entities_parent_idx
  ON ontology_entities (parent_id);

CREATE TABLE IF NOT EXISTS ontology_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_phone TEXT NOT NULL,
  from_entity UUID NOT NULL REFERENCES ontology_entities(id) ON DELETE CASCADE,
  to_entity UUID NOT NULL REFERENCES ontology_entities(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  source TEXT NOT NULL DEFAULT 'agent_inferred',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ontology_rel_type_check CHECK (
    relationship_type IN ('reports_to', 'works_on', 'manages', 'collaborates_with', 'serves', 'depends_on', 'owns')
  ),
  CONSTRAINT ontology_rel_source_check CHECK (
    source IN ('human', 'agent_inferred', 'axis_validated')
  ),
  CONSTRAINT ontology_rel_no_self CHECK (from_entity <> to_entity),
  UNIQUE (tenant_phone, from_entity, to_entity, relationship_type)
);

CREATE INDEX IF NOT EXISTS ontology_relationships_tenant_idx
  ON ontology_relationships (tenant_phone, relationship_type);

CREATE INDEX IF NOT EXISTS ontology_relationships_from_idx
  ON ontology_relationships (from_entity);

CREATE INDEX IF NOT EXISTS ontology_relationships_to_idx
  ON ontology_relationships (to_entity);

-- Auto-bump updated_at on UPDATE
CREATE OR REPLACE FUNCTION ontology_entities_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ontology_entities_touch ON ontology_entities;
CREATE TRIGGER ontology_entities_touch
  BEFORE UPDATE ON ontology_entities
  FOR EACH ROW EXECUTE FUNCTION ontology_entities_touch_updated_at();

-- Atomic ontology write helper. Caller passes a JSON payload of entities and
-- relationships; the function inserts everything in a transaction so a partial
-- failure rolls back cleanly (FR-NFR36).
--
-- Usage from PostgREST:
--   POST /rest/v1/rpc/upsert_ontology
--   { "p_tenant_phone": "491703604562", "p_entities": [...], "p_relationships": [...] }
CREATE OR REPLACE FUNCTION upsert_ontology(
  p_tenant_phone TEXT,
  p_entities JSONB,
  p_relationships JSONB
) RETURNS TABLE(entities_written INTEGER, relationships_written INTEGER) AS $$
DECLARE
  ent JSONB;
  rel JSONB;
  ent_id_map JSONB := '{}'::jsonb;
  inserted_id UUID;
  e_count INTEGER := 0;
  r_count INTEGER := 0;
  from_id UUID;
  to_id UUID;
BEGIN
  -- 1) Upsert entities, building a name→id map so the relationships below can
  -- reference them by name.
  FOR ent IN SELECT * FROM jsonb_array_elements(p_entities) LOOP
    INSERT INTO ontology_entities (tenant_phone, entity_type, name, metadata, source)
    VALUES (
      p_tenant_phone,
      ent->>'entity_type',
      ent->>'name',
      COALESCE(ent->'metadata', '{}'::jsonb),
      COALESCE(ent->>'source', 'agent_inferred')
    )
    ON CONFLICT (tenant_phone, entity_type, name) DO UPDATE
      SET metadata = EXCLUDED.metadata, updated_at = now()
    RETURNING id INTO inserted_id;

    ent_id_map := ent_id_map || jsonb_build_object(
      ent->>'entity_type' || ':' || (ent->>'name'),
      inserted_id::text
    );
    e_count := e_count + 1;
  END LOOP;

  -- 2) Upsert relationships using the name map
  FOR rel IN SELECT * FROM jsonb_array_elements(p_relationships) LOOP
    from_id := (ent_id_map->>(rel->>'from_type' || ':' || (rel->>'from_name')))::uuid;
    to_id := (ent_id_map->>(rel->>'to_type' || ':' || (rel->>'to_name')))::uuid;

    IF from_id IS NULL OR to_id IS NULL OR from_id = to_id THEN
      CONTINUE;
    END IF;

    INSERT INTO ontology_relationships (tenant_phone, from_entity, to_entity, relationship_type, metadata, source)
    VALUES (
      p_tenant_phone,
      from_id,
      to_id,
      rel->>'relationship_type',
      COALESCE(rel->'metadata', '{}'::jsonb),
      COALESCE(rel->>'source', 'agent_inferred')
    )
    ON CONFLICT (tenant_phone, from_entity, to_entity, relationship_type) DO NOTHING;

    r_count := r_count + 1;
  END LOOP;

  RETURN QUERY SELECT e_count, r_count;
END;
$$ LANGUAGE plpgsql;

-- Verify
SELECT 'ontology tables ready' AS status;

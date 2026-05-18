-- Phase 1A — Conversation-to-knowledge atoms.
--
-- When the owner texts Iris about their business (a competitor, a goal,
-- a preference, a person, a constraint), facts get extracted asynchronously
-- and stored as discrete "atoms" the whole team can read. Today those facts
-- live only in whatsapp_contexts.conversation_history — opaque to other
-- agents. This makes Iris's chat compound across the team.
--
-- Each atom is small (1-2 sentences), classified by kind, scored by
-- confidence, traceable to source. Owner can confirm/correct atoms to
-- bump confidence to 1.0.
--
-- Run once in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS tenant_knowledge_atoms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_phone TEXT NOT NULL,
  -- kind taxonomy — keep narrow so prompt rendering is clean
  -- 'competitor' = something the owner has flagged as competition
  -- 'goal'       = what they're trying to achieve (e.g. "ship Au7o by Q3")
  -- 'preference' = how they like things done (tone, schedule, channel preference)
  -- 'constraint' = limits / no-gos ("don't email after 7pm", "I'm allergic to X")
  -- 'person'     = lightweight ref; richer entries go in known_people
  -- 'event'      = something that happened or is happening ("meeting Thursday with Y")
  -- 'fact'       = catch-all for other useful context
  kind TEXT NOT NULL DEFAULT 'fact',
  content TEXT NOT NULL,
  -- Source — where the atom came from. 'whatsapp:msg_<id>' / 'agent:<name>' / 'owner_confirmed'
  source TEXT NOT NULL,
  source_message_id TEXT,
  -- Optional related entity (e.g. for 'person' kind, the known_people.id)
  related_entity_id UUID,
  related_entity_kind TEXT,
  -- 0.0 - 1.0. 1.0 = owner explicitly told us; lower = auto-extracted
  confidence FLOAT NOT NULL DEFAULT 0.6,
  -- Owner can confirm/correct an atom; confirmed atoms never get auto-modified
  owner_confirmed BOOLEAN NOT NULL DEFAULT false,
  -- 'active' | 'archived' (kept for audit, removed from prompts) | 'rejected' (owner said no)
  status TEXT NOT NULL DEFAULT 'active',
  -- Searchable / topic tags for retrieval
  tags TEXT[] NOT NULL DEFAULT '{}'::text[],
  -- Free-form metadata (e.g. extracted entities, related agent_run id)
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_referenced_at TIMESTAMPTZ,

  CONSTRAINT tenant_knowledge_atoms_kind_check CHECK (
    kind IN ('competitor', 'goal', 'preference', 'constraint', 'person', 'event', 'fact')
  ),
  CONSTRAINT tenant_knowledge_atoms_status_check CHECK (
    status IN ('active', 'archived', 'rejected')
  ),
  CONSTRAINT tenant_knowledge_atoms_confidence_check CHECK (
    confidence >= 0.0 AND confidence <= 1.0
  )
);

CREATE INDEX IF NOT EXISTS tenant_knowledge_atoms_active_idx
  ON tenant_knowledge_atoms (tenant_phone, kind, confidence DESC, created_at DESC)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS tenant_knowledge_atoms_tags_idx
  ON tenant_knowledge_atoms USING gin (tags) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS tenant_knowledge_atoms_tenant_idx
  ON tenant_knowledge_atoms (tenant_phone, created_at DESC);


-- ─── normalize_atom_for_match ──────────────────────────────────────────────
-- Strip subject pronouns / verb prefixes so "Owner's goal is X", "Devon's
-- goal is X", "The owner has a goal of X" all reduce to "goal is X" and
-- collide on dedup. Trigram match on the result.
CREATE OR REPLACE FUNCTION normalize_atom_for_match(p_content TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(
    regexp_replace(
      regexp_replace(
        lower(trim(coalesce(p_content, ''))),
        -- Strip leading possessives + names: "owner's", "devon's", "the owner's", "i'm"
        '^(the\s+)?(owner|devon|user|i|we|client)(''s|s)?\s+',
        '',
        'g'
      ),
      -- Strip leading auxiliary verbs: "is", "has", "wants", "plans", "needs"
      '^(is|has|have|wants?|needs?|plans?|will|told|said|mentioned|noted|flagged)\s+',
      '',
      'g'
    ),
    -- Collapse remaining whitespace
    '\s+', ' ', 'g'
  );
$$;


-- ─── upsert_knowledge_atom ─────────────────────────────────────────────────
-- Idempotent insert/update. Confirmed atoms (owner_confirmed=true) never
-- get clobbered by auto-extracted ones. Dedup uses normalize_atom_for_match
-- so "Owner's goal X" and "Devon's goal X" collide.
CREATE OR REPLACE FUNCTION upsert_knowledge_atom(
  p_tenant_phone TEXT,
  p_kind TEXT,
  p_content TEXT,
  p_source TEXT,
  p_source_message_id TEXT DEFAULT NULL,
  p_confidence FLOAT DEFAULT 0.6,
  p_owner_confirmed BOOLEAN DEFAULT false,
  p_tags TEXT[] DEFAULT '{}'::text[],
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_id UUID;
  v_content_norm TEXT;
  v_existing_id UUID;
  v_existing_confirmed BOOLEAN;
BEGIN
  v_content_norm := normalize_atom_for_match(p_content);
  IF length(v_content_norm) < 5 THEN
    RAISE EXCEPTION 'atom content too short';
  END IF;

  -- Look for an existing similar atom — match on normalized content's
  -- first 50 chars (after stripping subject pronouns/verbs). Catches
  -- "Owner's goal is X" vs "Devon's goal is X" as duplicates.
  SELECT id, owner_confirmed INTO v_existing_id, v_existing_confirmed
  FROM tenant_knowledge_atoms
  WHERE tenant_phone = p_tenant_phone
    AND kind = p_kind
    AND status = 'active'
    AND normalize_atom_for_match(content) LIKE substring(v_content_norm FROM 1 FOR 50) || '%'
  ORDER BY confidence DESC, created_at DESC
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    -- Don't let auto-extracted atoms overwrite owner-confirmed ones
    IF v_existing_confirmed AND NOT p_owner_confirmed THEN
      RETURN v_existing_id;
    END IF;
    UPDATE tenant_knowledge_atoms
    SET
      content = CASE WHEN p_owner_confirmed THEN p_content ELSE content END,
      confidence = GREATEST(confidence, p_confidence),
      owner_confirmed = owner_confirmed OR p_owner_confirmed,
      tags = (
        SELECT array_agg(DISTINCT t) FROM unnest(tags || p_tags) AS t
      ),
      metadata = COALESCE(metadata, '{}'::jsonb) || COALESCE(p_metadata, '{}'::jsonb),
      updated_at = now()
    WHERE id = v_existing_id;
    RETURN v_existing_id;
  END IF;

  INSERT INTO tenant_knowledge_atoms (
    tenant_phone, kind, content, source, source_message_id,
    confidence, owner_confirmed, tags, metadata
  )
  VALUES (
    p_tenant_phone, p_kind, p_content, p_source, p_source_message_id,
    p_confidence, p_owner_confirmed, p_tags, p_metadata
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;


-- ─── recent_atoms_for_prompt ───────────────────────────────────────────────
-- Returns the most relevant atoms to include in an agent's tick prompt.
-- Cheap — caps to N rows, prioritizes by recency + confidence + relevance
-- to the agent's lane (via tag matching).
--
-- Visibility rules:
--   - constraint / goal / preference atoms = ALWAYS VISIBLE regardless of lane.
--     These are owner-level rules every agent must honor.
--   - 'general' tag or no tags = visible to all lanes.
--   - lane tag match = visible to that lane.
--   - kind='fact' tagged platform/roadmap/known_gap = platform-level, all lanes.
CREATE OR REPLACE FUNCTION recent_atoms_for_prompt(
  p_tenant_phone TEXT,
  p_lane TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 15
)
RETURNS TABLE (
  id UUID,
  kind TEXT,
  content TEXT,
  confidence FLOAT,
  owner_confirmed BOOLEAN,
  tags TEXT[],
  created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
  SELECT id, kind, content, confidence, owner_confirmed, tags, created_at
  FROM tenant_knowledge_atoms
  WHERE tenant_phone = p_tenant_phone
    AND status = 'active'
    AND (
      p_lane IS NULL
      -- Owner-level rules every agent must honor
      OR kind IN ('constraint', 'goal', 'preference')
      -- Untagged or generic
      OR cardinality(tags) = 0
      OR 'general' = ANY(tags)
      -- Lane-specific
      OR p_lane = ANY(tags)
      -- Platform-level facts (visible to everyone regardless of lane)
      OR (kind = 'fact' AND (
        'platform' = ANY(tags) OR 'roadmap' = ANY(tags) OR 'known_gap' = ANY(tags)
      ))
    )
  ORDER BY
    owner_confirmed DESC,
    confidence DESC,
    created_at DESC
  LIMIT p_limit;
$$;

SELECT 'tenant_knowledge_atoms + upsert + recent_atoms_for_prompt ready' AS status;

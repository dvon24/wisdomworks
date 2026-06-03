-- 2026-06-03 — Memory hardening: SAFE dedup improvements in upsert_knowledge_atom.
--
-- A 2026-06-03 live audit found EIGHT near-identical "keep cholesterol low /
-- limit saturated fats" atoms accumulated in one tenant's memory. Two dedup
-- gaps let them pile up:
--   1. Candidate match required kind = p_kind. The 8 were a MIX of 'preference'
--      and 'constraint' (Iris classified the same fact either way on different
--      days), so they never collided.
--   2. Content match used a first-50-char prefix LIKE; each save opened with a
--      different phrase, so prefixes differed and nothing matched.
--
-- REJECTED APPROACH — trigram similarity. The obvious fix for (2) is fuzzy
-- pg_trgm similarity(). An empirical probe against real phrasings KILLED this:
-- distinct facts that share STRUCTURE score as high as or HIGHER than true
-- duplicates --
--     "allergic to penicillin" vs "allergic to peanuts"      = 0.48
--     "no emails after 7pm"    vs "no calls after 9pm"        = 0.61
--     true cholesterol dup phrasings                          = 0.46-0.57
-- There is no threshold that dedups the cholesterol variants without risking a
-- merge of two life-threateningly-distinct allergy facts. Lexical similarity
-- conflates structural shape with semantic identity. Do NOT add trigram here.
-- Varied-phrasing dedup needs SEMANTIC matching (embeddings) -- a follow-up.
--
-- What this migration DOES ship (both safe, no false-merge risk):
--   A. preference/constraint are one dedup family, so the same fact saved under
--      either kind collides (the (1) gap, the cause of 5-of-8 vs 3-of-8 split).
--      Still requires the existing high-agreement 50-char prefix match, so it
--      only ever merges atoms that genuinely share an opening -- never two
--      distinct facts.
--   B. A deliberate owner scope (owner_confirmed + non-empty tags) now REPLACES
--      the matched atom's tag set instead of unioning. Unioning let a stale
--      'general' tag survive a re-scope and silently re-broadcast a now-scoped
--      fact -- the leak [[memory-must-be-agent-scoped]] closes.
--
-- Backward-compatible: CREATE OR REPLACE, no data migration.

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

  -- Match within the kind family on a high-agreement 50-char normalized prefix.
  SELECT id, owner_confirmed INTO v_existing_id, v_existing_confirmed
  FROM tenant_knowledge_atoms
  WHERE tenant_phone = p_tenant_phone
    AND status = 'active'
    AND (
      kind = p_kind
      -- Owners blur preference vs constraint — treat them as one dedup family.
      OR (kind IN ('preference', 'constraint') AND p_kind IN ('preference', 'constraint'))
    )
    AND normalize_atom_for_match(content) LIKE substring(v_content_norm FROM 1 FOR 50) || '%'
  ORDER BY confidence DESC, created_at DESC
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    -- Don't let auto-extracted atoms overwrite owner-confirmed ones.
    IF v_existing_confirmed AND NOT p_owner_confirmed THEN
      RETURN v_existing_id;
    END IF;
    UPDATE tenant_knowledge_atoms
    SET
      content = CASE WHEN p_owner_confirmed THEN p_content ELSE content END,
      confidence = GREATEST(confidence, p_confidence),
      owner_confirmed = owner_confirmed OR p_owner_confirmed,
      tags = CASE
        -- A deliberate owner scope is authoritative: REPLACE the tag set so a
        -- re-scope can NARROW a fact (drop a stale 'general' that would leak).
        WHEN p_owner_confirmed AND cardinality(p_tags) > 0 THEN p_tags
        -- Otherwise merge (auto-extraction enriching tags, etc.).
        ELSE (SELECT array_agg(DISTINCT t) FROM unnest(tags || p_tags) AS t)
      END,
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

SELECT 'upsert_knowledge_atom: preference/constraint dedup family + scope-replace tags (trigram REJECTED as unsafe)' AS status;

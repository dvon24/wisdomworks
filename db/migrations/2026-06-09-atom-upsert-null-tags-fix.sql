-- 2026-06-09 — Fix the recurring "memory save failed (system error)" on re-saves.
--
-- ROOT CAUSE (confirmed by reading the live function + table DDL):
-- upsert_knowledge_atom's dedup-collision UPDATE computes the merged tags as
--     tags = CASE
--       WHEN p_owner_confirmed AND cardinality(p_tags) > 0 THEN p_tags
--       ELSE (SELECT array_agg(DISTINCT t) FROM unnest(tags || p_tags) AS t)
--     END
-- When the ELSE branch runs and BOTH the existing atom's tags and p_tags are
-- empty (e.g. a remember_this whose scope failed to resolve to an agent name →
-- p_tags = '{}'), `unnest('{}')` yields zero rows and `array_agg(...)` returns
-- SQL NULL — which violates `tags TEXT[] NOT NULL` on tenant_knowledge_atoms.
-- The UPDATE throws → the RPC returns 4xx.
--
-- This is why PR #48 didn't fix it: #48 made the EMBEDDING best-effort (lexical
-- retry), but this failure is embedding-INDEPENDENT — it's in the shared UPDATE
-- path, so the lexical-only retry hits the identical error. It's also why the
-- failure was intermittent: it only fires on a dedup COLLISION (a re-save of an
-- already-known fact) where both tag arrays are empty — exactly Devon's repeated
-- "save my workout split" case.
--
-- FIX: COALESCE the merged-tags expression to an empty array. Nothing else in
-- the function changes (semantic-first 0.78 / lexical-fallback structure, scope
-- tags, embedding column all identical to 2026-06-05-atom-dedup-threshold-tune).

CREATE OR REPLACE FUNCTION upsert_knowledge_atom(
  p_tenant_phone TEXT,
  p_kind TEXT,
  p_content TEXT,
  p_source TEXT,
  p_source_message_id TEXT DEFAULT NULL,
  p_confidence FLOAT DEFAULT 0.6,
  p_owner_confirmed BOOLEAN DEFAULT false,
  p_tags TEXT[] DEFAULT '{}'::text[],
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_embedding vector(1536) DEFAULT NULL
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

  -- 1) SEMANTIC dedup first (0.78 cosine — validated on real phrasings).
  IF p_embedding IS NOT NULL THEN
    SELECT id, owner_confirmed INTO v_existing_id, v_existing_confirmed
    FROM tenant_knowledge_atoms
    WHERE tenant_phone = p_tenant_phone
      AND status = 'active'
      AND embedding IS NOT NULL
      AND (1 - (embedding <=> p_embedding)) >= 0.78
    ORDER BY embedding <=> p_embedding ASC
    LIMIT 1;
  END IF;

  -- 2) LEXICAL fallback: kind-family + 50-char normalized prefix.
  IF v_existing_id IS NULL THEN
    SELECT id, owner_confirmed INTO v_existing_id, v_existing_confirmed
    FROM tenant_knowledge_atoms
    WHERE tenant_phone = p_tenant_phone
      AND status = 'active'
      AND (
        kind = p_kind
        OR (kind IN ('preference', 'constraint') AND p_kind IN ('preference', 'constraint'))
      )
      AND normalize_atom_for_match(content) LIKE substring(v_content_norm FROM 1 FOR 50) || '%'
    ORDER BY confidence DESC, created_at DESC
    LIMIT 1;
  END IF;

  IF v_existing_id IS NOT NULL THEN
    IF v_existing_confirmed AND NOT p_owner_confirmed THEN
      RETURN v_existing_id;
    END IF;
    UPDATE tenant_knowledge_atoms
    SET
      content = CASE WHEN p_owner_confirmed THEN p_content ELSE content END,
      confidence = GREATEST(confidence, p_confidence),
      owner_confirmed = owner_confirmed OR p_owner_confirmed,
      -- COALESCE guards the NOT NULL: array_agg over an empty unnest returns
      -- NULL, which would violate tags TEXT[] NOT NULL on a both-empty merge.
      tags = CASE
        WHEN p_owner_confirmed AND cardinality(p_tags) > 0 THEN p_tags
        ELSE COALESCE((SELECT array_agg(DISTINCT t) FROM unnest(tags || p_tags) AS t), '{}'::text[])
      END,
      embedding = COALESCE(p_embedding, embedding),
      metadata = COALESCE(metadata, '{}'::jsonb) || COALESCE(p_metadata, '{}'::jsonb),
      updated_at = now()
    WHERE id = v_existing_id;
    RETURN v_existing_id;
  END IF;

  INSERT INTO tenant_knowledge_atoms (
    tenant_phone, kind, content, source, source_message_id,
    confidence, owner_confirmed, tags, metadata, embedding
  )
  VALUES (
    p_tenant_phone, p_kind, p_content, p_source, p_source_message_id,
    p_confidence, p_owner_confirmed, p_tags, p_metadata, p_embedding
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Defense-in-depth: remove the stale 9-arg overload (pre-embedding signature).
-- CREATE OR REPLACE never replaced it (different arity = a NEW overload), and no
-- prior migration DROPped it, so two overloads coexist. Today's caller always
-- sends the p_embedding key → routes unambiguously to the 10-arg version, so
-- this is latent — but any future caller that omits p_embedding would hit
-- PGRST203 "could not choose the best candidate function". Drop it now.
DROP FUNCTION IF EXISTS upsert_knowledge_atom(
  text, text, text, text, text, double precision, boolean, text[], jsonb
);

SELECT 'upsert_knowledge_atom: tags NOT NULL guarded (COALESCE) + stale 9-arg overload dropped' AS status;

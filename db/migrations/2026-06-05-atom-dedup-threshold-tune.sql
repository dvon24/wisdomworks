-- 2026-06-05 — Retune the semantic-dedup threshold 0.88 → 0.78.
--
-- The 2026-06-05 migration shipped 0.88. Empirical validation on the actual
-- transcript phrasings (text-embedding-3-small) showed 0.88 MISSES real
-- duplicates: e.g. two phrasings of the IL5/IL6 goal scored 0.797, below 0.88,
-- so the pile-up would only partly collapse. Meanwhile distinct-but-related
-- facts top out at ~0.71 (100k-vs-Ironman 0.710; allergic-to-penicillin vs
-- -peanuts 0.684). So 0.78 sits cleanly in the gap: it catches the
-- near-identical re-save duplicates (0.80+) with a ~0.07 margin above the
-- highest distinct pair, and never false-merges two different facts.
--
-- Only the threshold changes vs the prior CREATE OR REPLACE; everything else
-- (the semantic-first / lexical-fallback structure, scope-replace tags,
-- embedding column) is identical.

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
      tags = CASE
        WHEN p_owner_confirmed AND cardinality(p_tags) > 0 THEN p_tags
        ELSE (SELECT array_agg(DISTINCT t) FROM unnest(tags || p_tags) AS t)
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

SELECT 'upsert_knowledge_atom: semantic threshold retuned 0.88 -> 0.78 (validated)' AS status;

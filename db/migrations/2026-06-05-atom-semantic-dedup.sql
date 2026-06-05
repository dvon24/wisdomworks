-- 2026-06-05 — Robust memory dedup: SEMANTIC (embedding) matching for atoms.
--
-- A live 2026-06-05 transcript showed the SOP/behavioral-RAG layer flooding
-- with duplicates: the same IL5/IL6 goal saved ~4x, the product vision ~4x,
-- "get better every day" ~3x, Headspace meditation 3x (once scoped to Coach,
-- once shared to all — conflicting). The #23 lexical dedup only collapses the
-- preference/constraint family on a 50-char prefix; goals/facts with VARIED
-- phrasing slip through, and trigram was rejected (it can't tell "allergic to
-- penicillin" from "allergic to peanuts").
--
-- Embeddings solve exactly that: text-embedding-3-small cosine similarity puts
-- varied phrasings of one fact at ~0.90+ while distinct facts sit far below
-- (penicillin vs peanuts ~0.65). So a HIGH threshold (0.88) collapses the spam
-- without ever merging two genuinely different facts.
--
-- Design: the TS upsertAtom chokepoint embeds the content (embeddings.ts) and
-- passes it as p_embedding. upsert_knowledge_atom checks for a semantically-
-- identical active atom FIRST; on a hit it updates that atom (refreshes content
-- + embedding, merges per the scope rules) instead of inserting a duplicate.
-- Falls back to the existing #23 lexical match when no embedding is supplied
-- (direct RPC callers) or no semantic hit. Backward-compatible: p_embedding
-- defaults NULL.
--
-- NOTE: old atoms have NULL embedding until re-saved/backfilled, so they won't
-- be found by the semantic search yet — a separate backfill + a one-time dedup
-- of the existing pile-up are queued. Going forward, new saves dedup cleanly.

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE tenant_knowledge_atoms ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- Approximate-NN index for the per-tenant cosine search. Partial on active +
-- non-null embedding (the only rows the dedup search scans).
CREATE INDEX IF NOT EXISTS tenant_knowledge_atoms_embedding_hnsw_idx
  ON tenant_knowledge_atoms USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL AND status = 'active';

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

  -- 1) SEMANTIC dedup first (when an embedding is supplied). Collapses varied
  --    phrasings of the same fact/goal across kinds. 0.88 cosine = semantic
  --    identity; distinct facts sit well below, so no false merges.
  IF p_embedding IS NOT NULL THEN
    SELECT id, owner_confirmed INTO v_existing_id, v_existing_confirmed
    FROM tenant_knowledge_atoms
    WHERE tenant_phone = p_tenant_phone
      AND status = 'active'
      AND embedding IS NOT NULL
      AND (1 - (embedding <=> p_embedding)) >= 0.88
    ORDER BY embedding <=> p_embedding ASC
    LIMIT 1;
  END IF;

  -- 2) LEXICAL fallback (#23): kind-family + 50-char normalized prefix.
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

SELECT 'upsert_knowledge_atom: semantic (embedding) dedup added — varied phrasings collapse' AS status;

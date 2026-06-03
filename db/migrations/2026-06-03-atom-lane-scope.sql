-- 2026-06-03 — Memory scoping: tags ARE the scope (fix preference leak)
--
-- Bug Devon hit: he told Iris his diet preference (low cholesterol / limit
-- saturated fats) and it surfaced to EVERY agent, including Au7o/Alex (web +
-- SEO agents that have no business knowing his diet). Iris even agreed "that's
-- Coach's lane" and then saved it globally again — 4x — because the retrieval
-- function force-broadcast it.
--
-- Root cause: recent_atoms_for_prompt treated kind IN ('constraint','goal',
-- 'preference') as ALWAYS-VISIBLE regardless of tags. So a lane-tagged
-- preference still showed to every lane. The kind-blanket OVERRODE the tag
-- scoping that the rest of the function already does correctly.
--
-- Fix: remove the kind-blanket. Tags are now the single scope signal,
-- uniformly for every kind:
--   - p_lane IS NULL (orchestrator / owner brain) → sees everything.
--   - no tags OR 'general' tag       → visible to all lanes (owner-level).
--   - p_lane = ANY(tags)             → visible to that lane only.
--   - kind='fact' + platform/roadmap/known_gap → platform-level, all lanes.
--
-- Backward-compatible: existing atoms are overwhelmingly untagged or tagged
-- 'general' (the old tool told Iris to "always include general"), so they stay
-- universal. Only NEW, deliberately lane-scoped facts (remember_this scope=...)
-- become per-lane. CREATE OR REPLACE — no data migration, no lock risk.

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
      -- Orchestrator / owner brain (no lane) sees everything.
      p_lane IS NULL
      -- Untagged or generic → owner-level, every agent honors it.
      OR cardinality(tags) = 0
      OR 'general' = ANY(tags)
      -- Lane-specific → only the matching lane.
      OR p_lane = ANY(tags)
      -- Platform-level facts (visible to everyone regardless of lane).
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

SELECT 'recent_atoms_for_prompt: tags-are-scope (preference leak fixed)' AS status;

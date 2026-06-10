-- 2026-06-10 — Scoped atoms must actually REACH the scoped agent.
--
-- The 2026-06-03 pair of fixes left the memory-scoping contract incoherent:
--   SAVE  (remember_this): tags the atom with the agent's lowercased NAME
--         ("coach") — because real teams carry null/generic config.category
--         (Coach=null, Marcus='analytics'), names are the reliable key.
--   LOAD  (recent_atoms_for_prompt): matches p_lane = ANY(tags) — and every
--         caller passes config.category as p_lane, never the agent name.
--
-- Consequences (verified 2026-06-10):
--   1. Marcus (category='analytics'): an atom scoped to him is tagged
--      'marcus', his tick queries p_lane='analytics' → his own scoped facts
--      NEVER load. remember_this scoping is write-only for categoried agents.
--   2. Coach (category=NULL): his tick queries p_lane=NULL → the "owner
--      brain sees everything" arm fires → he sees EVERY agent's scoped
--      facts. The diet-leak the 2026-06-03 fix targeted is still open for
--      every null-category agent.
--   3. delegate_to_agent never called this function at all (fixed in code
--      alongside this migration).
--
-- FIX: add p_agent_name. Owner-brain (see-everything) mode now requires BOTH
-- p_lane AND p_agent_name to be NULL — Iris's callers pass neither, agents
-- always pass their name, so an agent can no longer fall into omniscient
-- mode via a missing category. Name-tagged atoms match on p_agent_name.
--
-- DROP first: CREATE OR REPLACE with a different arg list would create a
-- second overload next to the 3-arg one and PostgREST would refuse to pick
-- (PGRST203) — the exact hazard the 2026-06-09 atom-upsert migration cleaned
-- up for upsert_knowledge_atom. Old deployed code that still posts 3 named
-- args routes fine to the 4-arg function via the default.
-- APPLY BEFORE deploying the code that passes p_agent_name.

DROP FUNCTION IF EXISTS recent_atoms_for_prompt(text, text, integer);

CREATE FUNCTION recent_atoms_for_prompt(
  p_tenant_phone TEXT,
  p_lane TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 15,
  p_agent_name TEXT DEFAULT NULL
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
      -- Owner brain (Iris / owner-level surfaces): no lane AND no name.
      (p_lane IS NULL AND p_agent_name IS NULL)
      -- Untagged or generic → owner-level, every agent honors it.
      OR cardinality(tags) = 0
      OR 'general' = ANY(tags)
      -- Lane-scoped → the matching lane.
      OR (p_lane IS NOT NULL AND p_lane = ANY(tags))
      -- Name-scoped (what remember_this writes) → the matching agent.
      OR (p_agent_name IS NOT NULL AND lower(p_agent_name) = ANY(tags))
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

SELECT 'recent_atoms_for_prompt: name-scoped atoms now reach the named agent; null-category agents no longer omniscient' AS status;

-- Hierarchy in the canonical store.
--
-- Background: agent_configs is the system of record for agents, but until
-- now the parent-child relationship (subTeam structure) only existed in
-- the chat-side whatsapp_contexts.profile.team JSON. The deck renders from
-- profile.team, and there were N writers to it (add_agent_to_team,
-- saveUserContext callers, axis-discovery rerun paths, regenerate-org-doc)
-- vs one writer to agent_configs. Result: drift. Devon hit 6 Mira ghosts
-- because the cache drifted while the canonical store stayed clean.
--
-- This migration lets agent_configs express hierarchy on its own:
--   • parent_agent_id NULL  = top-level agent (Iris, Marcus, Sophia, …)
--   • parent_agent_id SET   = sub-agent under that parent
--
-- After this, the dashboard route can build the team[] tree by joining
-- agent_configs to itself by parent_agent_id, and profile.team becomes
-- a chat-side cache only, not the rendering source.

ALTER TABLE agent_configs
  ADD COLUMN IF NOT EXISTS parent_agent_id UUID NULL
    REFERENCES agent_configs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS agent_configs_parent_idx
  ON agent_configs (parent_agent_id)
  WHERE parent_agent_id IS NOT NULL;

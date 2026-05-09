-- Story 1.11 — agent_configs table.
--
-- Promotes agents from JSON-in-whatsapp_contexts.profile.team to first-class
-- rows. Each agent gets:
--   - explicit model_routing (which provider+model+fallback per task)
--   - output_channels (where they send work)
--   - governance_rules (what they're allowed to do)
--   - entity_id link to ontology_entities so they're grounded in the org graph
--   - status lifecycle (pending → provisioning → ready → running → ...)
--
-- Run once in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS agent_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_phone TEXT NOT NULL,
  agent_role TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  model_routing JSONB NOT NULL,
  output_channels JSONB NOT NULL DEFAULT '[]'::jsonb,
  governance_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Soft link — ontology entity this agent represents (FR164-166)
  entity_id UUID REFERENCES ontology_entities(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT agent_configs_status_check CHECK (
    status IN ('pending', 'provisioning', 'ready', 'running', 'paused', 'stopped', 'error')
  ),
  -- Same agent name can't appear twice for one tenant
  UNIQUE (tenant_phone, agent_name)
);

CREATE INDEX IF NOT EXISTS agent_configs_tenant_idx
  ON agent_configs (tenant_phone);

CREATE INDEX IF NOT EXISTS agent_configs_tenant_role_idx
  ON agent_configs (tenant_phone, agent_role);

CREATE INDEX IF NOT EXISTS agent_configs_model_routing_gin_idx
  ON agent_configs USING gin (model_routing);

CREATE INDEX IF NOT EXISTS agent_configs_entity_idx
  ON agent_configs (entity_id);

CREATE OR REPLACE FUNCTION agent_configs_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS agent_configs_touch ON agent_configs;
CREATE TRIGGER agent_configs_touch
  BEFORE UPDATE ON agent_configs
  FOR EACH ROW EXECUTE FUNCTION agent_configs_touch_updated_at();

-- Atomic upsert helper. Caller passes a JSON array of agent configs and the
-- tenant_phone; the function inserts/updates everything in a transaction so a
-- partial failure rolls back. Uses entity_type+entity_name to look up the
-- ontology link by-name (so the caller doesn't need to know UUIDs).
--
-- Usage:
--   POST /rest/v1/rpc/upsert_agent_configs
--   { "p_tenant_phone": "...", "p_agents": [
--     { "agent_role": "...", "agent_name": "...", "model_routing": {...},
--       "output_channels": [...], "governance_rules": [...],
--       "entity_lookup_name": "Marcus", "entity_lookup_type": "role" }
--   ]}
CREATE OR REPLACE FUNCTION upsert_agent_configs(
  p_tenant_phone TEXT,
  p_agents JSONB
) RETURNS TABLE(agents_written INTEGER) AS $$
DECLARE
  agent JSONB;
  ent_id UUID;
  written INTEGER := 0;
BEGIN
  FOR agent IN SELECT * FROM jsonb_array_elements(p_agents) LOOP
    -- Look up the linked ontology entity (optional)
    ent_id := NULL;
    IF agent ? 'entity_lookup_name' THEN
      SELECT id INTO ent_id
      FROM ontology_entities
      WHERE tenant_phone = p_tenant_phone
        AND entity_type = COALESCE(agent->>'entity_lookup_type', 'role')
        AND name = agent->>'entity_lookup_name'
      LIMIT 1;
    END IF;

    INSERT INTO agent_configs (
      tenant_phone, agent_role, agent_name,
      model_routing, output_channels, governance_rules,
      entity_id, status, config
    )
    VALUES (
      p_tenant_phone,
      agent->>'agent_role',
      agent->>'agent_name',
      COALESCE(agent->'model_routing', '{}'::jsonb),
      COALESCE(agent->'output_channels', '[]'::jsonb),
      COALESCE(agent->'governance_rules', '[]'::jsonb),
      ent_id,
      COALESCE(agent->>'status', 'pending'),
      COALESCE(agent->'config', '{}'::jsonb)
    )
    ON CONFLICT (tenant_phone, agent_name) DO UPDATE SET
      agent_role = EXCLUDED.agent_role,
      model_routing = EXCLUDED.model_routing,
      output_channels = EXCLUDED.output_channels,
      governance_rules = EXCLUDED.governance_rules,
      entity_id = COALESCE(EXCLUDED.entity_id, agent_configs.entity_id),
      config = EXCLUDED.config,
      updated_at = now();

    written := written + 1;
  END LOOP;

  RETURN QUERY SELECT written;
END;
$$ LANGUAGE plpgsql;

SELECT 'agent_configs ready' AS status;

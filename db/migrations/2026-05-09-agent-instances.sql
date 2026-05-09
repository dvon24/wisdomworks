-- Story 1.12 — agent_instances table + atomic provisioning function.
--
-- An agent_instance is a *running* version of an agent_config. Configs say
-- what an agent IS; instances say it's PROVISIONED, READY, RUNNING. Each
-- instance carries:
--   - the planned NATS subjects it'll subscribe to (computed from topology)
--   - the planned signal connections (which other agents it talks to)
--   - a status lifecycle (provisioning → ready → running → ...)
--
-- Real NATS pub/sub doesn't run yet — that's Story 2.x. This story stores the
-- WIRING so when the runtime comes online it has the routing table.
--
-- Run once in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS agent_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_phone TEXT NOT NULL,
  agent_config_id UUID NOT NULL REFERENCES agent_configs(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'provisioning',
  -- Subjects the instance subscribes to and publishes to. Convention:
  -- wisdomworks.<tenant_phone>.agent.<agent_name>.<event>
  nats_subjects JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Other agents this instance talks to: [{ to_agent_name, direction, subject }]
  signal_connections JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Snapshot of governance rules at provisioning time so a config change
  -- doesn't silently rewrite live policy
  governance_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  state_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_activity TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT agent_instances_status_check CHECK (
    status IN ('provisioning', 'ready', 'running', 'paused', 'stopped', 'error')
  ),
  -- One live instance per config — re-provisioning bumps the existing row.
  UNIQUE (agent_config_id)
);

CREATE INDEX IF NOT EXISTS agent_instances_tenant_idx
  ON agent_instances (tenant_phone);

CREATE INDEX IF NOT EXISTS agent_instances_status_idx
  ON agent_instances (tenant_phone, status);

CREATE INDEX IF NOT EXISTS agent_instances_subjects_gin_idx
  ON agent_instances USING gin (nats_subjects);

CREATE OR REPLACE FUNCTION agent_instances_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS agent_instances_touch ON agent_instances;
CREATE TRIGGER agent_instances_touch
  BEFORE UPDATE ON agent_instances
  FOR EACH ROW EXECUTE FUNCTION agent_instances_touch_updated_at();

-- Atomic provisioning helper. Takes a tenant + a JSON array of pre-computed
-- instance payloads, inserts/updates everything in one transaction.
--
-- Each item shape:
-- {
--   "agent_name": "Marcus",
--   "nats_subjects": ["wisdomworks.491....agent.Marcus.work_inbox", ...],
--   "signal_connections": [{ "to_agent_name": "Iris", "direction": "out", ... }],
--   "governance_snapshot": [...],
--   "metadata": { "topology": "hub_spoke", "tier": "Sonnet" }
-- }
--
-- Caller doesn't need to know agent_config_id — we look it up by name. If a
-- name doesn't resolve, that single row is skipped (caller sees the count
-- diff and can decide what to do).
CREATE OR REPLACE FUNCTION provision_agents(
  p_tenant_phone TEXT,
  p_instances JSONB
) RETURNS TABLE(provisioned INTEGER, skipped INTEGER) AS $$
DECLARE
  inst JSONB;
  cfg_id UUID;
  done INTEGER := 0;
  miss INTEGER := 0;
BEGIN
  FOR inst IN SELECT * FROM jsonb_array_elements(p_instances) LOOP
    SELECT id INTO cfg_id
    FROM agent_configs
    WHERE tenant_phone = p_tenant_phone
      AND agent_name = inst->>'agent_name'
    LIMIT 1;

    IF cfg_id IS NULL THEN
      miss := miss + 1;
      CONTINUE;
    END IF;

    INSERT INTO agent_instances (
      tenant_phone, agent_config_id,
      status, nats_subjects, signal_connections, governance_snapshot, metadata
    )
    VALUES (
      p_tenant_phone,
      cfg_id,
      'ready',
      COALESCE(inst->'nats_subjects', '[]'::jsonb),
      COALESCE(inst->'signal_connections', '[]'::jsonb),
      COALESCE(inst->'governance_snapshot', '[]'::jsonb),
      COALESCE(inst->'metadata', '{}'::jsonb)
    )
    ON CONFLICT (agent_config_id) DO UPDATE SET
      status = 'ready',
      nats_subjects = EXCLUDED.nats_subjects,
      signal_connections = EXCLUDED.signal_connections,
      governance_snapshot = EXCLUDED.governance_snapshot,
      metadata = EXCLUDED.metadata,
      updated_at = now();

    -- Mark the config as ready too so the lifecycles stay in sync
    UPDATE agent_configs
    SET status = 'ready', updated_at = now()
    WHERE id = cfg_id;

    done := done + 1;
  END LOOP;

  RETURN QUERY SELECT done, miss;
END;
$$ LANGUAGE plpgsql;

SELECT 'agent_instances ready' AS status;

-- Story 2.10 — Agent State Persistence & Recovery (full enterprise).
--
-- Periodic + pre-action snapshots of agent_instances.state_data so we can
-- recover from a crash, a bad action, or roll back to a known good state.
-- Snapshots are immutable history; recover flips the live row's state_data
-- but the trail persists for audit.
--
-- For NFR38/39 (zero data loss + daily backup with PITR), the cloud
-- backup answer is Supabase Pro's Point-in-Time Recovery — flip it on
-- in the project dashboard. This table provides app-layer fast recovery
-- (sub-second) for the common case; PITR covers the disaster scenario.
--
-- Run once in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS agent_state_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_phone TEXT NOT NULL,
  agent_instance_id UUID NOT NULL REFERENCES agent_instances(id) ON DELETE CASCADE,
  -- Snapshot of state_data at this point in time
  state_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Snapshot of operating_protocol so a recover restores the same rules
  operating_protocol JSONB,
  -- Snapshot of nats_subjects + signal_connections (the wiring at this point)
  wiring JSONB,
  -- Why was this snapshot taken?
  reason TEXT NOT NULL DEFAULT 'periodic',
  -- Optional reference back to the agent_run that triggered the snapshot
  triggering_run_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT agent_state_snapshots_reason_check CHECK (
    reason IN ('periodic', 'pre_action', 'shutdown', 'manual', 'recovery_test', 'pre_recover')
  )
);

CREATE INDEX IF NOT EXISTS agent_state_snapshots_instance_idx
  ON agent_state_snapshots (agent_instance_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_state_snapshots_tenant_idx
  ON agent_state_snapshots (tenant_phone, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_state_snapshots_reason_idx
  ON agent_state_snapshots (reason, created_at DESC);

-- ─── Recover RPC ─────────────────────────────────────────────────────────
-- Restores an agent_instance's state_data + operating_protocol + wiring
-- from the latest snapshot at-or-before the given timestamp. Takes a
-- 'pre_recover' snapshot of the current state first so you can undo the
-- recovery if it was a mistake.
--
-- Returns the recovered snapshot's id + how old the snapshot was.

CREATE OR REPLACE FUNCTION recover_agent_state(
  p_instance_id UUID,
  p_point_in_time TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE (
  recovered_snapshot_id UUID,
  recovered_at TIMESTAMPTZ,
  pre_recover_snapshot_id UUID,
  state_data JSONB
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_tenant TEXT;
  v_current_state JSONB;
  v_current_protocol JSONB;
  v_current_wiring JSONB;
  v_pre_id UUID;
  v_snap RECORD;
BEGIN
  -- Capture the live row's current state for a pre_recover snapshot
  SELECT
    ai.tenant_phone,
    ai.state_data,
    ai.metadata->'operating_protocol',
    jsonb_build_object('nats_subjects', ai.nats_subjects, 'signal_connections', ai.signal_connections)
  INTO v_tenant, v_current_state, v_current_protocol, v_current_wiring
  FROM agent_instances ai
  WHERE ai.id = p_instance_id;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'agent_instance % not found', p_instance_id;
  END IF;

  INSERT INTO agent_state_snapshots (
    tenant_phone, agent_instance_id, state_data, operating_protocol, wiring, reason
  )
  VALUES (v_tenant, p_instance_id, v_current_state, v_current_protocol, v_current_wiring, 'pre_recover')
  RETURNING id INTO v_pre_id;

  -- Find the snapshot to recover from
  SELECT * INTO v_snap
  FROM agent_state_snapshots
  WHERE agent_instance_id = p_instance_id
    AND created_at <= p_point_in_time
    AND reason <> 'pre_recover'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_snap IS NULL THEN
    RAISE EXCEPTION 'no snapshot found for instance % at-or-before %', p_instance_id, p_point_in_time;
  END IF;

  -- Apply the snapshot
  UPDATE agent_instances
  SET
    state_data = v_snap.state_data,
    nats_subjects = COALESCE((v_snap.wiring->>'nats_subjects')::jsonb, nats_subjects),
    signal_connections = COALESCE((v_snap.wiring->>'signal_connections')::jsonb, signal_connections),
    metadata = jsonb_set(
      COALESCE(metadata, '{}'::jsonb),
      '{operating_protocol}',
      COALESCE(v_snap.operating_protocol, metadata->'operating_protocol', 'null'::jsonb)
    ),
    updated_at = now()
  WHERE id = p_instance_id;

  RETURN QUERY SELECT v_snap.id, v_snap.created_at, v_pre_id, v_snap.state_data;
END;
$$;

SELECT 'agent_state_snapshots ready' AS status;

-- Story 2.1c (delegation logging) — extend agent_runs to capture
-- cross-lane delegations.
--
-- When an agent observes something that's out of its lane, the tick
-- prompt now asks for: which lane should own this, and why. We log
-- that as a structured field on the run so:
--   1. The activity feed can mark it with a delegation icon
--   2. A future delegation processor (Story 2.4 — signal layer) can
--      pick up rows where delegated_to_lane IS NOT NULL and dispatch
--      them to the right lane's agent
--
-- Run once in the Supabase SQL Editor.

ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS delegated_to_lane TEXT,
  ADD COLUMN IF NOT EXISTS delegation_reason TEXT,
  ADD COLUMN IF NOT EXISTS delegation_status TEXT;

-- Constrain delegated_to_lane to known categories (see shared/onboarding/agent-categories.ts)
DO $$
DECLARE conname TEXT;
BEGIN
  SELECT con.conname INTO conname
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'agent_runs'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%delegated_to_lane%';
  IF conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE agent_runs DROP CONSTRAINT %I', conname);
  END IF;
END $$;

ALTER TABLE agent_runs
  ADD CONSTRAINT agent_runs_delegated_lane_check
  CHECK (delegated_to_lane IS NULL OR delegated_to_lane IN (
    'orchestrator', 'operations', 'sales', 'marketing', 'support',
    'finance', 'analytics', 'creative', 'people', 'technical',
    'legal', 'specialist'
  ));

-- delegation_status lifecycle: pending → claimed → done | declined
DO $$
DECLARE conname TEXT;
BEGIN
  SELECT con.conname INTO conname
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'agent_runs'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%delegation_status%';
  IF conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE agent_runs DROP CONSTRAINT %I', conname);
  END IF;
END $$;

ALTER TABLE agent_runs
  ADD CONSTRAINT agent_runs_delegation_status_check
  CHECK (delegation_status IS NULL OR delegation_status IN (
    'pending', 'claimed', 'done', 'declined'
  ));

CREATE INDEX IF NOT EXISTS agent_runs_delegation_idx
  ON agent_runs (tenant_phone, delegated_to_lane, delegation_status)
  WHERE delegated_to_lane IS NOT NULL;

SELECT 'agent_runs delegation columns ready' AS status;

-- Story 2.1 — agent_runs table.
--
-- Each time the runtime ticks an agent (cron, manual trigger, signal-driven)
-- a row lands here. Captures: which agent, what kind of tick, what model
-- was used, how long it ran, what happened.
--
-- This is the "show me what my agents are doing" log — feeds the activity
-- timeline on the deck and (eventually) the audit_logs replacement.
--
-- Run once in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_phone TEXT NOT NULL,
  agent_instance_id UUID NOT NULL REFERENCES agent_instances(id) ON DELETE CASCADE,
  -- 'tick' (scheduled wake), 'signal' (peer-triggered), 'manual' (user-triggered)
  trigger TEXT NOT NULL DEFAULT 'tick',
  -- 'observe' / 'analyze' / 'plan' / 'build' / 'present' — the BMAD phase
  phase TEXT,
  model_used TEXT,
  input_summary TEXT,
  output_summary TEXT,
  outcome TEXT NOT NULL DEFAULT 'no_op',
  duration_ms INTEGER,
  tokens_in INTEGER,
  tokens_out INTEGER,
  error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT agent_runs_trigger_check CHECK (
    trigger IN ('tick', 'signal', 'manual', 'startup')
  ),
  CONSTRAINT agent_runs_outcome_check CHECK (
    outcome IN ('no_op', 'observed', 'acted', 'proposed', 'escalated', 'failed', 'blocked_by_governance')
  )
);

CREATE INDEX IF NOT EXISTS agent_runs_tenant_idx
  ON agent_runs (tenant_phone, started_at DESC);

CREATE INDEX IF NOT EXISTS agent_runs_instance_idx
  ON agent_runs (agent_instance_id, started_at DESC);

CREATE INDEX IF NOT EXISTS agent_runs_outcome_idx
  ON agent_runs (tenant_phone, outcome) WHERE outcome IN ('escalated', 'failed', 'blocked_by_governance');

SELECT 'agent_runs ready' AS status;

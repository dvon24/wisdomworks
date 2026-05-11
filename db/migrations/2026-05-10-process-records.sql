-- Story 2.14 — Process Capture & Experience Logging (full enterprise).
--
-- When an agent notices the user (or another agent) doing the same
-- multi-step thing more than once, capture it as a process_record.
-- The owner can then mark it 'approve_for_automation' → an agent
-- generates a workflow definition (Story 2.12) and executes it on
-- the next trigger.
--
-- Process records have a lifecycle:
--   observed → proposed → approved → automated → declined
--
-- Run once in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS process_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_phone TEXT NOT NULL,
  observed_by_instance_id UUID REFERENCES agent_instances(id) ON DELETE SET NULL,
  -- Stable name so dupes get merged
  name TEXT NOT NULL,
  description TEXT,
  -- Sequence of steps as observed: [{ tool, summary, sample_input?, sample_output? }]
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Trigger conditions: "every Monday morning", "when invoice received", etc
  trigger_description TEXT,
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  automation_status TEXT NOT NULL DEFAULT 'observed',
  -- When automated: the workflow definition that runs (Story 2.12 schema)
  workflow_definition JSONB,
  first_observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT process_records_status_check CHECK (
    automation_status IN ('observed', 'proposed', 'approved', 'automated', 'declined')
  ),
  UNIQUE (tenant_phone, name)
);

CREATE INDEX IF NOT EXISTS process_records_tenant_idx
  ON process_records (tenant_phone, automation_status, last_observed_at DESC);
CREATE INDEX IF NOT EXISTS process_records_count_idx
  ON process_records (tenant_phone, occurrence_count DESC);


-- ─── Process detection RPC ───────────────────────────────────────────────
-- Looks at the past N days of agent_runs for a tenant, groups recurring
-- {agent_role, outcome} sequences, and emits candidate process records.
-- Tightly scoped — looks for sequences of 2+ runs by the same agent
-- with similar output_summary that repeated 2+ times.

CREATE OR REPLACE FUNCTION detect_recurring_processes(
  p_tenant_phone TEXT,
  p_lookback_days INTEGER DEFAULT 14,
  p_min_occurrences INTEGER DEFAULT 2
)
RETURNS TABLE (
  signature TEXT,
  occurrences INTEGER,
  first_seen TIMESTAMPTZ,
  last_seen TIMESTAMPTZ,
  sample_summary TEXT,
  example_run_ids UUID[]
)
LANGUAGE sql
STABLE
AS $$
  WITH normalized AS (
    SELECT
      ar.id,
      ai.agent_config_id,
      ac.agent_role,
      ar.outcome,
      regexp_replace(
        regexp_replace(LOWER(COALESCE(ar.output_summary, '')), '[0-9]+', 'N', 'g'),
        '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+N', 'M-N', 'gi'
      ) AS norm_summary,
      ar.started_at
    FROM agent_runs ar
    JOIN agent_instances ai ON ai.id = ar.agent_instance_id
    JOIN agent_configs ac ON ac.id = ai.agent_config_id
    WHERE ar.tenant_phone = p_tenant_phone
      AND ar.started_at >= now() - (p_lookback_days || ' days')::interval
      -- Only ACTED runs - the agent actually did something worth
      -- automating. 'observed'/'proposed' produced too much noise
      -- ("polled inbox", "still blocked", agent status reports).
      AND ar.outcome = 'acted'
      AND COALESCE(LENGTH(ar.output_summary), 0) > 20
      -- Filter out noise summaries that describe NON-activity. These
      -- aren't workflows to automate; they're agents reporting quiet.
      AND LOWER(ar.output_summary) NOT SIMILAR TO
        '%(remains|remain|still blocked|no new|no activity|no progress|no change|continue to|continues to|completely silent|completely inactive|completely dormant|stable at)%'
  ),
  signatures AS (
    SELECT
      LEFT(agent_role || ':' || LEFT(norm_summary, 80), 200) AS signature,
      COUNT(*) AS occurrences,
      MIN(started_at) AS first_seen,
      MAX(started_at) AS last_seen,
      MIN(norm_summary) AS sample_summary,
      (ARRAY_AGG(id ORDER BY started_at))[1:5] AS example_run_ids
    FROM normalized
    GROUP BY 1
  )
  SELECT * FROM signatures
  WHERE occurrences >= p_min_occurrences
  ORDER BY occurrences DESC, last_seen DESC
  LIMIT 50;
$$;

SELECT 'process_records + detect_recurring_processes ready' AS status;

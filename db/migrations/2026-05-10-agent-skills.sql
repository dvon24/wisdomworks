-- Story 2.15 — Skill Formation & Cross-Agent Learning (full enterprise).
--
-- When an agent successfully completes work, we mine the run for reusable
-- techniques. Those techniques get attached to the agent's LANE (not just
-- the individual agent), so every other agent in the same lane benefits
-- on their next tick.
--
-- Two tables:
--   1. agent_skills — one row per (tenant, lane, technique_signature). Tracks
--      success/failure counts so we can rank, retire, and audit.
--   2. agent_skill_applications — append-only log linking each skill use to
--      the agent_run that applied it. Lets us build outcome curves and
--      understand which agent introduced/used what.
--
-- Three RPCs:
--   - top_skills_for_lane: rank-by-success-rate with min-sample gate
--   - record_skill_outcome: atomic counter bump + application log + auto-retire
--   - upsert_agent_skill: idempotent insert/update by (tenant, lane, signature)
--
-- Retirement policy: a skill is auto-retired when it has 5+ failures AND
-- failure rate > 0.7. The orchestrator/owner can retire manually via tool.
--
-- Run once in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS agent_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_phone TEXT NOT NULL,
  lane TEXT NOT NULL,
  -- Stable, dedup-friendly identifier for the technique
  technique_signature TEXT NOT NULL,
  -- Human-readable description (1-2 sentences) — what to do, when to do it
  description TEXT NOT NULL,
  -- Optional structured payload: example inputs/outputs, prompt fragments
  technique_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  neutral_count INTEGER NOT NULL DEFAULT 0,
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  discovered_by_instance_id UUID REFERENCES agent_instances(id) ON DELETE SET NULL,
  discovered_from_run_id UUID,
  retired_at TIMESTAMPTZ,
  retired_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (tenant_phone, lane, technique_signature)
);

CREATE INDEX IF NOT EXISTS agent_skills_lane_idx
  ON agent_skills (tenant_phone, lane, retired_at NULLS FIRST, success_count DESC);
CREATE INDEX IF NOT EXISTS agent_skills_active_idx
  ON agent_skills (tenant_phone, lane) WHERE retired_at IS NULL;

CREATE TABLE IF NOT EXISTS agent_skill_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id UUID NOT NULL REFERENCES agent_skills(id) ON DELETE CASCADE,
  agent_instance_id UUID NOT NULL REFERENCES agent_instances(id) ON DELETE CASCADE,
  agent_run_id UUID,
  outcome TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT agent_skill_applications_outcome_check CHECK (
    outcome IN ('success', 'failure', 'neutral')
  )
);

CREATE INDEX IF NOT EXISTS agent_skill_applications_skill_idx
  ON agent_skill_applications (skill_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_skill_applications_instance_idx
  ON agent_skill_applications (agent_instance_id, created_at DESC);


-- ─── upsert_agent_skill ────────────────────────────────────────────────────
-- Idempotent: insert if (tenant, lane, signature) is new, or update
-- description / payload / metadata on the existing row.

CREATE OR REPLACE FUNCTION upsert_agent_skill(
  p_tenant_phone TEXT,
  p_lane TEXT,
  p_technique_signature TEXT,
  p_description TEXT,
  p_technique_payload JSONB DEFAULT '{}'::jsonb,
  p_discovered_by_instance_id UUID DEFAULT NULL,
  p_discovered_from_run_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO agent_skills (
    tenant_phone, lane, technique_signature, description, technique_payload,
    discovered_by_instance_id, discovered_from_run_id, metadata
  )
  VALUES (
    p_tenant_phone, p_lane, p_technique_signature, p_description, p_technique_payload,
    p_discovered_by_instance_id, p_discovered_from_run_id, p_metadata
  )
  ON CONFLICT (tenant_phone, lane, technique_signature) DO UPDATE
  SET
    description = EXCLUDED.description,
    technique_payload = COALESCE(agent_skills.technique_payload, '{}'::jsonb) || EXCLUDED.technique_payload,
    metadata = COALESCE(agent_skills.metadata, '{}'::jsonb) || EXCLUDED.metadata,
    updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;


-- ─── top_skills_for_lane ───────────────────────────────────────────────────
-- Ranks active (non-retired) skills for a lane by success rate, with a
-- minimum sample size so a single lucky win doesn't dominate. Falls back
-- to recently-discovered skills (with no application history yet) so new
-- techniques get a chance to be applied.

CREATE OR REPLACE FUNCTION top_skills_for_lane(
  p_tenant_phone TEXT,
  p_lane TEXT,
  p_limit INTEGER DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  technique_signature TEXT,
  description TEXT,
  technique_payload JSONB,
  success_count INTEGER,
  failure_count INTEGER,
  total_uses INTEGER,
  success_rate FLOAT,
  last_success_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
  WITH ranked AS (
    SELECT
      s.id,
      s.technique_signature,
      s.description,
      s.technique_payload,
      s.success_count,
      s.failure_count,
      (s.success_count + s.failure_count + s.neutral_count) AS total_uses,
      CASE
        WHEN (s.success_count + s.failure_count) = 0 THEN 0.5
        ELSE s.success_count::float / (s.success_count + s.failure_count)
      END AS success_rate,
      s.last_success_at,
      s.created_at
    FROM agent_skills s
    WHERE s.tenant_phone = p_tenant_phone
      AND s.lane = p_lane
      AND s.retired_at IS NULL
  )
  SELECT id, technique_signature, description, technique_payload,
         success_count, failure_count, total_uses, success_rate, last_success_at
  FROM ranked
  ORDER BY
    -- Prefer techniques with proven track record, but give brand-new
    -- skills a window to prove themselves
    CASE WHEN total_uses = 0 THEN 0 ELSE 1 END DESC,
    success_rate DESC,
    success_count DESC,
    created_at DESC
  LIMIT p_limit;
$$;


-- ─── record_skill_outcome ──────────────────────────────────────────────────
-- Atomic: bumps the matching counter on agent_skills, inserts an application
-- log row, and auto-retires the skill if its failure rate has crossed the
-- threshold.

CREATE OR REPLACE FUNCTION record_skill_outcome(
  p_skill_id UUID,
  p_agent_instance_id UUID,
  p_agent_run_id UUID,
  p_outcome TEXT,
  p_notes TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_success INTEGER;
  v_failure INTEGER;
  v_total INTEGER;
  v_failure_rate FLOAT;
  v_should_retire BOOLEAN := FALSE;
BEGIN
  IF p_outcome NOT IN ('success', 'failure', 'neutral') THEN
    RAISE EXCEPTION 'invalid outcome %', p_outcome;
  END IF;

  INSERT INTO agent_skill_applications (skill_id, agent_instance_id, agent_run_id, outcome, notes)
  VALUES (p_skill_id, p_agent_instance_id, p_agent_run_id, p_outcome, p_notes);

  IF p_outcome = 'success' THEN
    UPDATE agent_skills
    SET success_count = success_count + 1,
        last_success_at = now(),
        updated_at = now()
    WHERE id = p_skill_id
    RETURNING success_count, failure_count INTO v_success, v_failure;
  ELSIF p_outcome = 'failure' THEN
    UPDATE agent_skills
    SET failure_count = failure_count + 1,
        last_failure_at = now(),
        updated_at = now()
    WHERE id = p_skill_id
    RETURNING success_count, failure_count INTO v_success, v_failure;
  ELSE
    UPDATE agent_skills
    SET neutral_count = neutral_count + 1,
        updated_at = now()
    WHERE id = p_skill_id
    RETURNING success_count, failure_count INTO v_success, v_failure;
  END IF;

  -- Auto-retirement check: 5+ failures AND failure rate > 0.7
  v_total := COALESCE(v_success, 0) + COALESCE(v_failure, 0);
  IF v_total > 0 THEN
    v_failure_rate := v_failure::float / v_total;
    IF v_failure >= 5 AND v_failure_rate > 0.7 THEN
      v_should_retire := TRUE;
    END IF;
  END IF;

  IF v_should_retire THEN
    UPDATE agent_skills
    SET retired_at = now(),
        retired_reason = format('auto-retired: %s failures of %s uses (%.0f%% failure rate)',
                                v_failure, v_total, v_failure_rate * 100)
    WHERE id = p_skill_id AND retired_at IS NULL;
  END IF;

  RETURN v_should_retire;
END;
$$;

SELECT 'agent_skills + agent_skill_applications + RPCs ready' AS status;

-- Story 2.14 — Lessons Learned registry.
--
-- Captures "what went wrong + how we fixed it" so agents can query the
-- registry BEFORE executing a similar task and avoid repeating known
-- pitfalls. Cross-referenced to process_records and agent_runs where
-- the lesson originated.
--
-- Lifecycle: open → applied → resolved.
--   - open:     active lesson, agents should consult it
--   - applied:  lesson has been used to alter a recent agent action
--   - resolved: lesson no longer reflects current reality (owner dismissed)
--
-- Run once in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS lessons_learned (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_phone TEXT NOT NULL,
  -- Short stable phrase used for dedup (e.g. "missed-followup-with-X")
  signature TEXT NOT NULL,
  -- Owner-facing label
  title TEXT NOT NULL,
  -- What happened that we want to avoid
  what_went_wrong TEXT NOT NULL,
  -- The fix / mitigation / rule going forward
  corrective_action TEXT NOT NULL,
  -- Keywords for the pre-flight matcher — populated by the caller from
  -- the source process or run. The pre-flight query checks
  -- contains-any-keyword against an incoming action description.
  topic_keywords TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  -- Source links (optional — could be null if the lesson is owner-typed)
  source_process_id UUID REFERENCES process_records(id) ON DELETE SET NULL,
  source_run_id UUID,
  -- How serious is repeating this — drives whether pre-flight surfaces it
  -- to the owner vs just injects into the agent's prompt
  severity TEXT NOT NULL DEFAULT 'medium',
  -- Lifecycle
  status TEXT NOT NULL DEFAULT 'open',
  -- Application stats — bumped on every consult / applied transition
  consult_count INTEGER NOT NULL DEFAULT 0,
  apply_count INTEGER NOT NULL DEFAULT 0,
  last_consulted_at TIMESTAMPTZ,
  last_applied_at TIMESTAMPTZ,
  -- Metadata for future expansion (e.g. embedding for semantic match)
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT lessons_learned_severity_check CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT lessons_learned_status_check CHECK (status IN ('open', 'applied', 'resolved'))
);

-- One lesson per tenant per signature
CREATE UNIQUE INDEX IF NOT EXISTS lessons_learned_unique_signature
  ON lessons_learned (tenant_phone, signature);

-- Lookup by tenant + status (pre-flight matcher only cares about open ones)
CREATE INDEX IF NOT EXISTS lessons_learned_open_idx
  ON lessons_learned (tenant_phone, severity DESC, last_consulted_at DESC NULLS LAST)
  WHERE status = 'open';

-- GIN on keywords so the pre-flight contains-any matcher is fast even
-- as the registry grows
CREATE INDEX IF NOT EXISTS lessons_learned_keywords_gin
  ON lessons_learned USING gin (topic_keywords);

-- Auto-touch updated_at
CREATE OR REPLACE FUNCTION lessons_learned_touch()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS lessons_learned_touch ON lessons_learned;
CREATE TRIGGER lessons_learned_touch BEFORE UPDATE ON lessons_learned
  FOR EACH ROW EXECUTE FUNCTION lessons_learned_touch();

SELECT 'lessons_learned ready' AS status;

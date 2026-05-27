-- Workflow consecutive-failure counter — supports auto-pause after N
-- consecutive failures so a workflow that fails daily (e.g. lost OAuth)
-- doesn't spam the owner with "✗ failed" messages every cron tick.
--
-- Shipped 2026-05-27. Triggered by Devon's morning transcript showing
-- coach-morning-workout-prompt failing daily with Graph 401 after
-- Microsoft Calendar auth lapsed — owner saw the same failure message
-- every morning instead of a single auto-pause notice with reconnect
-- instructions.

ALTER TABLE user_workflows
  ADD COLUMN IF NOT EXISTS consecutive_failures INTEGER NOT NULL DEFAULT 0,
  -- Audit columns for auto-pause events. Lets deck dashboards + owner
  -- queries show WHEN and WHY a workflow was paused without parsing
  -- last_run_error text.
  ADD COLUMN IF NOT EXISTS auto_paused_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS auto_paused_reason TEXT;

-- Index supports "find workflows ripe for auto-pause" queries without a
-- full scan. Status filter scopes to active workflows that have any
-- failure history.
CREATE INDEX IF NOT EXISTS user_workflows_failure_idx
  ON user_workflows (status, consecutive_failures)
  WHERE status = 'active' AND consecutive_failures > 0;

SELECT 'user_workflows.consecutive_failures ready' AS status;

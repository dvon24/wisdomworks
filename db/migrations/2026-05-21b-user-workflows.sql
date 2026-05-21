-- User-defined recurring workflows — the post-monetization-sprint platform
-- feature scoped in project_workflow_engine_mvp_scope.md. Stores the
-- workflows owners create from WhatsApp ("have Marcus pull P&L and send
-- Mira a PDF every Monday at 8am") so they persist across deploys + fire
-- automatically via the workflow-dispatcher cron.
--
-- Design choices (locked for MVP):
--   • steps[] is a JSONB array of { agent, tool, args }. Sequential
--     execution only; no conditionals, no parallel steps, no state-across-
--     runs. Owner-defined complexity stays small.
--   • cron_expr stores standard 5-field cron. NULL = on-demand only.
--   • status starts at 'pending_approval' — every new workflow gates for
--     owner approval before its first run (per approval-gate pattern).
--   • next_run_at is computed by the dispatcher from cron_expr after each
--     run; the partial index makes "find due workflows" cheap.

CREATE TABLE IF NOT EXISTS user_workflows (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_phone  TEXT NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT,
  cron_expr     TEXT,
  steps         JSONB NOT NULL DEFAULT '[]'::jsonb,
  status        TEXT NOT NULL DEFAULT 'pending_approval'
                  CHECK (status IN ('pending_approval', 'active', 'paused', 'removed')),
  last_run_at   TIMESTAMPTZ,
  last_run_outcome TEXT,                          -- 'success' / 'partial' / 'failed' / NULL
  last_run_error TEXT,                            -- short error message if last_run_outcome != 'success'
  next_run_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One workflow name per tenant, regardless of status. Re-creating a
  -- 'monday-pnl' workflow after deleting the old one means the old one
  -- needs to be in status='removed' first (or rename).
  UNIQUE (tenant_phone, name)
);

CREATE INDEX IF NOT EXISTS user_workflows_due_idx
  ON user_workflows (next_run_at)
  WHERE status = 'active' AND next_run_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS user_workflows_tenant_idx
  ON user_workflows (tenant_phone)
  WHERE status != 'removed';

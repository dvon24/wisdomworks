-- Auto-pause metadata for workflows — supplements 2026-05-27-workflow-
-- failure-counter.sql which added the consecutive_failures column.
--
-- When the dispatcher auto-pauses a workflow (consecutive_failures >=
-- threshold), it stamps auto_paused_at + auto_paused_reason so the
-- owner sees WHEN + WHY in the auto-pause notification AND so future
-- aggregation can group "lots of workflows paused because of expired
-- Google auth" into one prompt to reconnect.

ALTER TABLE user_workflows
  ADD COLUMN IF NOT EXISTS auto_paused_at TIMESTAMPTZ;

ALTER TABLE user_workflows
  ADD COLUMN IF NOT EXISTS auto_paused_reason TEXT;

SELECT 'user_workflows auto-pause metadata ready' AS status;

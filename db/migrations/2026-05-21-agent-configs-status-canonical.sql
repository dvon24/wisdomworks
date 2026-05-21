-- Canonicalize agent_configs.status — make the check constraint match
-- the values the code actually uses.
--
-- The original 2026-05-09-agent-configs.sql constraint allowed:
--   pending, provisioning, ready, running, paused, stopped, error
-- But the code has been writing 'active' (add_agent_to_team, dedup
-- restore path, backfill, provision_axis) and 'removed' (dedup soft-
-- delete, the 2026-05-18d migration's UPDATE) for weeks. Devon's
-- existing Sophia/Marcus/Alex/Riley rows show status='active' in audit
-- output, which means the constraint must have been dropped or
-- weakened in Supabase UI at some point — but it kicked back in for
-- the 6 ghost-Mira insert attempts on 2026-05-21 (error 23514).
--
-- Fix: drop the constraint, add it back with the FULL set of statuses
-- used in code. Existing rows pass; future inserts validate against
-- the same set the code writes.

ALTER TABLE agent_configs
  DROP CONSTRAINT IF EXISTS agent_configs_status_check;

ALTER TABLE agent_configs
  ADD CONSTRAINT agent_configs_status_check CHECK (
    status IN (
      'pending',        -- pre-runtime config, not yet provisioned
      'provisioning',   -- instance being created
      'ready',          -- provisioned, idle, not yet running
      'running',        -- actively executing
      'active',         -- general "in service" (most current writes use this)
      'paused',         -- owner-paused, intentional
      'stopped',        -- explicitly stopped
      'error',          -- runtime failure state
      'removed'         -- soft-deleted (dedup, owner removal); 30-day restore window
    )
  );

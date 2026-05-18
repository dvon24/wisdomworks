-- Fix for the "3 Mira's in the deck" bug surfaced 2026-05-18.
--
-- Root cause: add_agent_to_team (apps/web/app/api/webhooks/whatsapp/
-- agent-tools.ts) POSTs to /rest/v1/agent_configs with
-- `resolution=merge-duplicates` but agent_configs has NO unique
-- constraint on (tenant_phone, agent_name). PostgREST's merge-duplicates
-- only works when there's a constraint to conflict on — without one,
-- every POST creates a fresh row. Adding the same agent twice
-- silently creates two rows; Iris's prior turns produced 3 Mira
-- rows for Devon's tenant.
--
-- This migration:
--   1. DEDUPS existing rows — for each (tenant_phone, lower(agent_name))
--      group with >1 active rows, keep the OLDEST active row, mark
--      newer ones as status='removed' with a metadata note.
--   2. ADDS a partial unique index so future inserts collide cleanly.
--      The index is partial (WHERE status != 'removed') so a removed
--      agent's name can be re-used.
--   3. Uses lower(agent_name) for case-insensitive matching — the
--      owner shouldn't get duplicate agents named "Mira" + "mira".
--
-- IDEMPOTENT — safe to re-run. Dedup is a no-op once all groups
-- have ≤1 active row.

-- Step 1: Dedup. Keep the OLDEST (lowest created_at) active row per
-- (tenant_phone, lower(agent_name)) group. Older = the row that has
-- accumulated history (skills, runs, etc. reference it by id).
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY tenant_phone, lower(agent_name)
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM agent_configs
  WHERE status != 'removed'
)
UPDATE agent_configs ac
SET
  status = 'removed',
  config = COALESCE(ac.config, '{}'::jsonb) || jsonb_build_object(
    'removed_reason', 'duplicate_dedup',
    'removed_at', now()::text,
    'removed_by_migration', '2026-05-18d-agent-configs-uniqueness'
  ),
  updated_at = now()
FROM ranked
WHERE ac.id = ranked.id AND ranked.rn > 1;

-- Step 2: Partial unique index — case-insensitive name, active rows only.
CREATE UNIQUE INDEX IF NOT EXISTS agent_configs_tenant_name_active_uq
  ON agent_configs (tenant_phone, lower(agent_name))
  WHERE status != 'removed';

SELECT 'agent_configs deduped + unique index installed' AS status;

-- Drop the original full UNIQUE (tenant_phone, agent_name) constraint on
-- agent_configs. It's been redundant since migration 2026-05-18d added a
-- PARTIAL unique index (WHERE status != 'removed'), and worse than redundant:
-- it blocks re-inserting an agent whose old row was soft-removed.
--
-- 2026-05-20 backfill_team kept reporting "0 inserts, in sync" when the
-- audit clearly showed 0 active rows in agent_configs and 6 entries in
-- profile.team — the inserts were silently 409ing against this stale
-- constraint and the backfill code's `if (insertRes.ok)` skipped past
-- without reporting.
--
-- After this: the partial unique index from 2026-05-18d remains as the
-- only uniqueness guarantee, which permits soft-removed rows to coexist
-- with a fresh active row of the same name.

ALTER TABLE agent_configs
  DROP CONSTRAINT IF EXISTS agent_configs_tenant_phone_agent_name_key;

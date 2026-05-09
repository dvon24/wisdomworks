-- Story 1.14 — allow 'operating_protocol' as a tenant_configs.config_type.
--
-- Tenants can store a tightening override of the BASE_AGENT_PROTOCOL here.
-- Examples:
--   - autonomy_level: 'L1' (force every action through approval)
--   - additionalEscalationTriggers: ['contract_signing', 'over_$5000']
--
-- Run once in the Supabase SQL Editor.

DO $$
DECLARE
  conname TEXT;
BEGIN
  SELECT con.conname INTO conname
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'tenant_configs'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%config_type%';

  IF conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE tenant_configs DROP CONSTRAINT %I', conname);
    RAISE NOTICE 'Dropped existing config_type constraint: %', conname;
  END IF;
END $$;

ALTER TABLE tenant_configs
  ADD CONSTRAINT tenant_configs_type_check
  CHECK (config_type IN (
    'deployment_spec', 'governance_policy', 'integration_map', 'operating_protocol'
  ));

SELECT 'operating_protocol config_type now allowed' AS status;

-- Story 1.7 — tenant_configs table for AxisDeploymentSpec storage.
--
-- Holds per-tenant configuration documents keyed by config_type. Today the
-- only type is 'deployment_spec' (the AxisDeploymentSpec generated from
-- onboarding) but the schema is intentionally generic so future stories can
-- add more types (e.g. 'governance_policy', 'integration_map') without
-- new tables.
--
-- Run once in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS tenant_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Tenant identity. We key by phone_number for now to match
  -- whatsapp_contexts; a future migration can introduce a real tenant_id.
  tenant_phone TEXT NOT NULL,
  config_type TEXT NOT NULL,
  config JSONB NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT tenant_configs_type_check CHECK (
    config_type IN ('deployment_spec', 'governance_policy', 'integration_map')
  ),
  -- One active config per (tenant, type). Updates bump version and overwrite.
  UNIQUE (tenant_phone, config_type)
);

-- Lookup by tenant
CREATE INDEX IF NOT EXISTS tenant_configs_tenant_idx
  ON tenant_configs (tenant_phone, config_type);

-- Auto-bump updated_at on UPDATE
CREATE OR REPLACE FUNCTION tenant_configs_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  NEW.version := OLD.version + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tenant_configs_touch ON tenant_configs;
CREATE TRIGGER tenant_configs_touch
  BEFORE UPDATE ON tenant_configs
  FOR EACH ROW EXECUTE FUNCTION tenant_configs_touch_updated_at();

-- Verify
SELECT 'tenant_configs ready' AS status;

-- Story 6.12 — Compliance framework profiles per tenant.
--
-- Marks which compliance regimes apply to each tenant, plus the
-- activation gates and configuration each regime requires. This is the
-- META layer that wires earlier security primitives (6.5 redaction,
-- 6.4 hash-chained audit, 6.2 RLS, egress guard, dual-agent SoD) to
-- per-tenant requirements.
--
-- One row per tenant. Tenants that haven't completed onboarding may
-- have no row — treat absence as "no special compliance regime."
--
-- Schema notes:
--   frameworks: array of framework codes. Stable taxonomy below.
--   activation_gates: array of unmet prerequisites. Tenant cannot
--     activate (e.g. flip agent_instances to running) while non-empty
--     for any "blocker" framework.
--   egress_allowlist: domains an agent's outbound calls are restricted
--     to. NULL = no restriction (default). [] = deny-all. Per-tenant
--     fetch wrapper checks against this.
--   signed_agreements: tracks signed BAA / DPA / etc. {kind, signed_at,
--     reference_url}. Some frameworks require these before tenant
--     activation (HIPAA → BAA).
--   metadata: free-form per-tenant compliance config.
--
-- Stable framework taxonomy (extend as new regimes onboard):
--   'gdpr'        EU personal data
--   'ccpa'        California residents
--   'hipaa'       US healthcare PHI
--   'pci_dss'     Payment-card handling (we delegate to Stripe — flag
--                 only if a tenant claims they ALSO handle PAN directly)
--   'soc2_type1'  SOC 2 Type 1 (point-in-time)
--   'soc2_type2'  SOC 2 Type 2 (continuous, the audit one)
--   'iso_27001'   ISO 27001 ISMS
--   'sox'         US public-co financial controls
--   'fedramp_low' Federal — low impact
--   'fedramp_mod' Federal — moderate impact
--   'fedramp_high' Federal — high impact
--
-- Run once in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS tenant_compliance_profiles (
  tenant_phone TEXT PRIMARY KEY,
  frameworks TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  -- Activation gates that must clear before tenant can be fully active.
  -- Examples: 'baa_signature', 'dpa_signature', 'region_acknowledged',
  -- 'business_associate_designation'. Empty array = no blockers.
  activation_gates TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  -- NULL = no egress restriction (default). [] = deny-all outbound
  -- (useful for paranoid tenants). Domain-only entries (no path).
  egress_allowlist TEXT[],
  -- Signed agreements. Each entry: {"kind": "baa", "signed_at": "...",
  -- "reference_url": "...", "signed_by": "...", "version": "..."}
  signed_agreements JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Tenant-specific config (data residency region, retention overrides,
  -- per-framework toggles, etc.)
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Validate framework codes — reject anything not in the known set.
  -- New regimes need a migration to extend this constraint.
  CONSTRAINT tenant_compliance_profiles_frameworks_check
    CHECK (frameworks <@ ARRAY[
      'gdpr', 'ccpa', 'hipaa', 'pci_dss',
      'soc2_type1', 'soc2_type2', 'iso_27001',
      'sox', 'fedramp_low', 'fedramp_mod', 'fedramp_high'
    ]::TEXT[])
);

CREATE INDEX IF NOT EXISTS tenant_compliance_profiles_frameworks_gin
  ON tenant_compliance_profiles USING GIN (frameworks);

-- Story 6.2 — apply RLS so tenants only read their own profile.
ALTER TABLE tenant_compliance_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tenant_compliance_profiles;
CREATE POLICY tenant_isolation ON tenant_compliance_profiles
  FOR ALL TO authenticated, anon
  USING (tenant_phone = app_tenant_phone())
  WITH CHECK (tenant_phone = app_tenant_phone());

-- ─── Helper: is_tenant_activation_blocked ───────────────────────────────────
-- Returns TRUE if the tenant has any activation_gates set OR any required
-- signed_agreements missing. Callers (deploy-complete, agent-instance
-- status changes) consult this before flipping a tenant to active.

CREATE OR REPLACE FUNCTION is_tenant_activation_blocked(p_tenant_phone TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_gates TEXT[];
BEGIN
  SELECT activation_gates INTO v_gates
  FROM tenant_compliance_profiles
  WHERE tenant_phone = p_tenant_phone;
  -- No profile row = unrestricted = not blocked.
  IF v_gates IS NULL THEN RETURN FALSE; END IF;
  RETURN array_length(v_gates, 1) IS NOT NULL AND array_length(v_gates, 1) > 0;
END;
$$;

COMMENT ON TABLE tenant_compliance_profiles IS
  'Story 6.12 — per-tenant compliance regime config. One row per tenant. Drives activation gates, egress allowlist, redaction policy, retention policy. Absent row = no special regime.';

SELECT 'tenant_compliance_profiles ready' AS status;

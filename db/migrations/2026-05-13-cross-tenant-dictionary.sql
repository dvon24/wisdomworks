-- Story 2.15 — Cross-Tenant Skill Dictionary.
--
-- The Business Type Framework Dictionary. Skills proven across multiple
-- tenants of the same business type get anonymized and promoted here.
-- New deployments inherit the dictionary entries for their business type
-- on day one, so a new Salon agent ships with the "text reminders reduce
-- no-shows 40%" technique that Salon A discovered.
--
-- Environment boundaries:
--   - commercial:  contributes TO + reads FROM the dictionary
--   - government:  reads a frozen snapshot at deployment, never contributes
--   - air_gapped:  no dictionary integration at all (no read, no write)
--
-- Enforcement lives in the aggregator + loader code, not at the SQL
-- layer — the env_class flag rides on whatsapp_contexts.profile.
--
-- Run once in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS business_type_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Business type vertical this skill applies to (electrician, restaurant, etc)
  business_type TEXT NOT NULL,
  -- Lane that uses the technique
  lane TEXT NOT NULL,
  -- Stable signature for dedup — same as the per-tenant agent_skills
  technique_signature TEXT NOT NULL,
  -- Anonymized description — owner-facing, no customer/tenant identifiers
  description TEXT NOT NULL,
  -- Anonymized payload (strips names, dates, tenant_phones, etc)
  technique_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Aggregated evidence
  tenant_count INTEGER NOT NULL DEFAULT 0,
  total_uses INTEGER NOT NULL DEFAULT 0,
  total_successes INTEGER NOT NULL DEFAULT 0,
  total_failures INTEGER NOT NULL DEFAULT 0,
  -- Pooled success rate across all contributing tenants
  pooled_success_rate NUMERIC(4, 3) NOT NULL DEFAULT 0,
  -- Confidence floor — only skills above this get pushed to new tenants
  promoted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The "frozen snapshot at deployment" for government tenants — when a
  -- gov tenant deploys, we record their snapshot_version so future
  -- aggregation reruns don't change what they see. Commercial tenants
  -- always read the latest.
  snapshot_version INTEGER NOT NULL DEFAULT 1,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT business_type_skills_unique UNIQUE (business_type, lane, technique_signature)
);

CREATE INDEX IF NOT EXISTS business_type_skills_lookup_idx
  ON business_type_skills (business_type, lane, pooled_success_rate DESC);

-- Provenance — which tenant skill contributed to which dictionary entry.
-- Stored anonymized — we hash tenant_phone via the application layer so
-- the dictionary entry can't be reversed to a specific tenant.
CREATE TABLE IF NOT EXISTS business_type_skill_contributors (
  dictionary_skill_id UUID NOT NULL REFERENCES business_type_skills(id) ON DELETE CASCADE,
  -- HMAC of tenant_phone — not reversible
  tenant_hash TEXT NOT NULL,
  contributed_success_count INTEGER NOT NULL DEFAULT 0,
  contributed_failure_count INTEGER NOT NULL DEFAULT 0,
  first_contributed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_contributed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (dictionary_skill_id, tenant_hash)
);

-- Auto-touch updated_at on business_type_skills
CREATE OR REPLACE FUNCTION business_type_skills_touch()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS business_type_skills_touch ON business_type_skills;
CREATE TRIGGER business_type_skills_touch BEFORE UPDATE ON business_type_skills
  FOR EACH ROW EXECUTE FUNCTION business_type_skills_touch();

SELECT 'business_type_skills + contributors ready' AS status;

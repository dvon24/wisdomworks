-- Package 2 of the unified-trust-model build (see
-- project_unified_trust_model.md): positive-reinforcement extraction.
--
-- When the owner praises a specific agent by name ("Marcus, great
-- job", "Iris is killing it", "perfect, Riley"), we want to:
--   1. Attach the rule to THAT specific agent (separately from the
--      `scope` field which controls who READS the rule)
--   2. Roll up per-agent "affirmation" counts that feed the
--      promotion-candidate scoring (Package 3)
--
-- New column on tenant_disposition_rules:
--   attributed_to_agent TEXT — case-insensitive agent name when the
--     owner specifically referred to that agent. NULL when the praise
--     is generic (e.g., "great work" addressed to no one in particular).
--
-- Index supports the per-agent affirmation count used by the SOP
-- renderer + the promotion cron.
--
-- IDEMPOTENT — safe to re-run.

ALTER TABLE tenant_disposition_rules
  ADD COLUMN IF NOT EXISTS attributed_to_agent TEXT;

CREATE INDEX IF NOT EXISTS tenant_disposition_rules_agent_idx
  ON tenant_disposition_rules (tenant_phone, attributed_to_agent)
  WHERE attributed_to_agent IS NOT NULL AND status = 'active';

SELECT 'tenant_disposition_rules.attributed_to_agent ready' AS status;

-- Owner-disposition profile — auto-built per-tenant operating manual.
--
-- Devon's framing: "this should be one of the first things the agent
-- populates to encourage learning the client." Symmetric to the
-- feedback_*.md memories in ~/.claude/ — agents should never re-learn
-- the same correction twice.
--
-- Distinct from:
--   - knowledge_atoms (mines DOMAIN facts about the business)
--   - lessons_learned (specific "don't repeat this mistake" registry,
--     pre-flight gated against destructive tools)
-- This table mines META-FACTS about HOW TO WORK WITH THIS OWNER.
--
-- The extractor runs after every owner→Iris message turn, looks for
-- disposition signals (corrections / approvals / preferences / triggers
-- / communication style) and upserts rules here. Active rules get
-- rendered in every agent's system prompt next tick.
--
-- Run once in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS tenant_disposition_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_phone TEXT NOT NULL,

  -- Five kinds of signal:
  --   correction           — "you got X wrong", "that's not how I do it"
  --   approval             — "perfect", "yes exactly", "good call"
  --   preference           — "always do Y", "I prefer Z when..."
  --   frustration_trigger  — "stop doing X", "don't ever Y"
  --   communication_style  — tone, length, formality, format
  kind TEXT NOT NULL,

  -- Canonical rule text — the "always X" / "never Y" sentence agents read
  rule_text TEXT NOT NULL,

  -- Why this rule exists — evidence tying it to a specific owner statement
  why TEXT,

  -- The owner's exact words that produced this rule (short quote)
  evidence TEXT,

  -- Scope hint — does this apply everywhere or to a specific lane?
  -- 'everywhere' | 'lane:scheduler' | 'lane:finance' | 'tool:send_email' | etc
  scope TEXT NOT NULL DEFAULT 'everywhere',

  confidence NUMERIC(3, 2) NOT NULL DEFAULT 0.7,

  -- Lifecycle:
  --   active     — rule is being applied
  --   superseded — a newer contradicting rule replaced it
  --   dismissed  — owner explicitly said "forget that"
  status TEXT NOT NULL DEFAULT 'active',

  -- If superseded, point at the rule that replaced it
  superseded_by UUID REFERENCES tenant_disposition_rules(id) ON DELETE SET NULL,

  -- Source message id (the owner message that produced this rule)
  source_message_id TEXT,

  -- Application tracking — bumped each time the rule was injected into
  -- a system prompt (signals which rules are actually load-bearing)
  applied_count INTEGER NOT NULL DEFAULT 0,
  last_applied_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT disposition_kind_check
    CHECK (kind IN ('correction', 'approval', 'preference', 'frustration_trigger', 'communication_style')),
  CONSTRAINT disposition_status_check
    CHECK (status IN ('active', 'superseded', 'dismissed'))
);

-- Cheap lookup of active rules per tenant (renderer reads top N by
-- applied_count + recency, so this index covers it)
CREATE INDEX IF NOT EXISTS disposition_rules_active_idx
  ON tenant_disposition_rules (tenant_phone, kind, applied_count DESC, created_at DESC)
  WHERE status = 'active';

-- For the deck Settings page that shows the full profile
CREATE INDEX IF NOT EXISTS disposition_rules_tenant_idx
  ON tenant_disposition_rules (tenant_phone, created_at DESC);

-- Auto-touch updated_at
CREATE OR REPLACE FUNCTION disposition_rules_touch()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS disposition_rules_touch ON tenant_disposition_rules;
CREATE TRIGGER disposition_rules_touch BEFORE UPDATE ON tenant_disposition_rules
  FOR EACH ROW EXECUTE FUNCTION disposition_rules_touch();

SELECT 'tenant_disposition_rules ready' AS status;

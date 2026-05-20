-- Sender rules — deterministic short-circuit for the email classifier.
--
-- The classifier was hitting 238 low-confidence (<0.7) classifications
-- in 7 days because recurring senders like Change.org petitions, AT&T
-- account notices, and Vodafone billing don't have a strong business-
-- vs-personal signal in the email itself. Each one wakes the LLM with
-- ambiguous context and the LLM hedges.
--
-- Owner-defined sender rules fix this by deciding the classification
-- up-front, deterministically, before the LLM ever runs:
--   • block:    classify as business/spam; suppress notifications.
--   • personal: classify as personal/informational; privacy boundary
--               holds (no draft, no extraction, body redacted).
--   • allow:    classify as business/informational; surface normally
--               but no auto-draft.
--
-- The matcher is exact-email-first, then domain-fallback ("change.org"
-- catches anything @change.org). Most specific match wins.

CREATE TABLE IF NOT EXISTS sender_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_phone TEXT NOT NULL,
  sender_pattern TEXT NOT NULL,                     -- lowercased; either full email or bare domain
  action TEXT NOT NULL CHECK (action IN ('block', 'personal', 'allow')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT,
  UNIQUE (tenant_phone, sender_pattern)
);

CREATE INDEX IF NOT EXISTS idx_sender_rules_tenant ON sender_rules (tenant_phone);

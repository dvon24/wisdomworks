-- Story 2.9 Phase 2 — privacy controls on sent-email indexing.
--
-- The behavioral RAG indexes the owner's sent emails (with PII
-- redaction) so semantic recall covers "what did I tell Ron about
-- the timeline." Some owners want fine-grained control:
--   - "Don't index anything I send to my doctor."
--   - "Skip any email to my lawyer's domain."
--   - "Pause sent-email indexing entirely while I'm in a sensitive
--      negotiation."
--
-- This table holds those prefs. Defaults: indexing ENABLED, deny
-- lists EMPTY. Iris can update via WhatsApp tools; deck Settings
-- page can offer a UI later.
--
-- IDEMPOTENT — safe to re-run.

CREATE TABLE IF NOT EXISTS tenant_email_indexing_prefs (
  tenant_phone TEXT PRIMARY KEY,
  -- Master switch — if false, ingestSentEmails skips this tenant entirely.
  sent_emails_enabled BOOLEAN NOT NULL DEFAULT true,
  -- Exact recipient addresses to never index (lowercased).
  -- Example: ['doctor@kp.org', 'attorney@bigfirm.com']
  deny_addresses TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  -- Recipient domains to never index (lowercased, no leading dot).
  -- Matches when ANY recipient's host falls under this domain.
  -- Example: ['kp.org', 'bigfirm.com'] catches mail to any address @ those.
  deny_domains TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  -- Free-form note for the owner's reference (why this rule exists).
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auto-touch updated_at
CREATE OR REPLACE FUNCTION tenant_email_indexing_prefs_touch()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS tenant_email_indexing_prefs_touch ON tenant_email_indexing_prefs;
CREATE TRIGGER tenant_email_indexing_prefs_touch BEFORE UPDATE ON tenant_email_indexing_prefs
  FOR EACH ROW EXECUTE FUNCTION tenant_email_indexing_prefs_touch();

SELECT 'tenant_email_indexing_prefs ready' AS status;

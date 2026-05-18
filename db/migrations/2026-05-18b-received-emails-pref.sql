-- Story 2.9 Phase 2 — privacy control for RECEIVED-email indexing.
--
-- Extends tenant_email_indexing_prefs with a separate master switch
-- for received-email indexing (defaults to TRUE, same as sent).
-- Owners can have one direction on, the other off — useful if their
-- inbound mail has more sensitive content than their outbound (or
-- vice versa).
--
-- The deny_addresses / deny_domains lists already cover BOTH
-- directions — a deny on "kp.org" excludes mail TO any kp.org
-- address (sent path) AND mail FROM any kp.org address (received
-- path). No new deny columns needed.
--
-- IDEMPOTENT — safe to re-run.

ALTER TABLE tenant_email_indexing_prefs
  ADD COLUMN IF NOT EXISTS received_emails_enabled BOOLEAN NOT NULL DEFAULT true;

SELECT 'tenant_email_indexing_prefs.received_emails_enabled added' AS status;

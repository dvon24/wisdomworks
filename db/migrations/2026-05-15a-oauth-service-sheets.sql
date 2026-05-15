-- Add 'sheets' to the oauth_connections.service CHECK constraint.
--
-- Mira (Financial Advisor) needs Google Sheets read+write per Devon's
-- request 2026-05-15. The Google OAuth flow now also requests the
-- spreadsheets scope; the per-service-row callback wants to write a
-- service='sheets' row so the deck's tool gating shows the sheets tools.
--
-- Run once in the Supabase SQL Editor.

ALTER TABLE oauth_connections
  DROP CONSTRAINT IF EXISTS oauth_connections_service_check;

ALTER TABLE oauth_connections
  ADD CONSTRAINT oauth_connections_service_check
  CHECK (service IN (
    'email',
    'calendar',
    'drive',
    'sheets',
    'search_console',
    'analytics',
    'instagram',
    'payments',
    'booking',
    'accounting'
  ));

SELECT 'oauth_connections.service CHECK now allows sheets' AS status;

-- Loosen the oauth_connections.service CHECK constraint so the
-- per-service-row pattern (one connection row per Google-scope-granted
-- service) can write 'drive', 'search_console', and 'analytics' rows.
--
-- Previously the constraint only allowed the original handful of
-- services. New Google scopes added 2026-05-14 (webmasters.readonly,
-- analytics.readonly, drive.readonly per Story 2.16 Phase 4) need
-- their own service rows so the deck's per-service tool gating
-- surfaces the matching tools.
--
-- Includes the existing services so no rows are invalidated:
--   email, calendar, instagram, payments, booking, accounting
-- Adds:
--   drive, search_console, analytics
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
    'search_console',
    'analytics',
    'instagram',
    'payments',
    'booking',
    'accounting'
  ));

SELECT 'oauth_connections.service CHECK constraint relaxed' AS status;

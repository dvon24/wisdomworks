-- Soften financial-advisor + operations-manager capability requirements,
-- and introduce a broader "spreadsheet" capability slug.
--
-- Real-customer insight from Devon 2026-05-22: most small businesses track
-- finances in Excel/Google Sheets, not QuickBooks. Marking accounting as
-- REQUIRED meant Mira looked perma-blocked for owners without QBO — even
-- though they actually had a spreadsheet-based finance workflow that
-- worked fine.
--
-- Better model: required = absolute minimum (email — Mira needs to be
-- able to send the owner reports). Optional = paths to richer data
-- (accounting via QBO, spreadsheet via Google Sheets OR Excel/OneDrive,
-- payments via Stripe, bank-feed via Plaid). Templates that use a given
-- capability flag as "blocked" only when ALL paths are missing.
--
-- The "spreadsheet" capability is new and satisfied by either Google
-- Sheets OR Microsoft OneDrive Drive (which exposes Excel). The
-- capability-audit.ts resolver handles the OR logic.

UPDATE agent_role_catalog SET
  required_capabilities = '["email"]'::jsonb,
  optional_capabilities = '["accounting", "spreadsheet", "payments", "drive"]'::jsonb
WHERE role_slug = 'financial-advisor';

UPDATE agent_role_catalog SET
  required_capabilities = '["email"]'::jsonb,
  optional_capabilities = '["accounting", "spreadsheet", "drive", "calendar"]'::jsonb
WHERE role_slug = 'operations-manager';

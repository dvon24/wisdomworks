-- Story 6.8 — HMAC signatures on sensitive rows.
--
-- Defense-in-depth on top of Story 6.4 (audit chain): every sensitive row
-- carries an HMAC computed over its canonical contents, signed with a
-- separate HMAC_ROW_SECRET env var. Tampering with a row's contents
-- (without ALSO updating the HMAC, which requires the secret) is
-- detectable on read.
--
-- Tables in scope:
--   oauth_connections           — leak risk: third-party API access tokens
--   project_connections         — leak risk: Au7o / external project keys
--   tenant_compliance_profiles  — leak risk: backdated BAA signatures
--
-- HMAC is computed APPLICATION-SIDE (TypeScript helper at
-- packages/shared/src/security/row-hmac.ts). DB just stores the hex string.
-- Two reasons app-side won over DB-side triggers:
--   1. Secret lives in Vercel env var, consistent with TOKEN_ENCRYPTION_KEY
--      (one rotation surface, not two)
--   2. No Supabase Vault dependency
--
-- Phase A (this migration): add the column + verify RPC. New writes
-- include the HMAC; existing rows get NULL hmac and are treated as
-- "legacy, not verifiable." The verify RPC reports which rows are
-- unsigned vs verified vs tampered so the operator can backfill.
--
-- Phase B (deferred): one-time backfill of legacy rows + flip
-- verification to strict (NULL hmac becomes an error, not legacy).
--
-- Run once in the Supabase SQL Editor.

ALTER TABLE oauth_connections
  ADD COLUMN IF NOT EXISTS hmac TEXT;

ALTER TABLE project_connections
  ADD COLUMN IF NOT EXISTS hmac TEXT;

ALTER TABLE tenant_compliance_profiles
  ADD COLUMN IF NOT EXISTS hmac TEXT;

-- ─── verify_row_hmac_status ────────────────────────────────────────────────
-- Read-only inventory of HMAC coverage. Returns one row per scoped table
-- with counts: total, signed, unsigned. The TS-side verifier walks each
-- signed row and recomputes; this RPC just shows the inventory.
--
-- Once the backfill ships, this RPC's "unsigned" count should be 0 for
-- all rows older than the backfill cutoff.

CREATE OR REPLACE FUNCTION row_hmac_inventory()
RETURNS TABLE (table_name TEXT, total BIGINT, signed BIGINT, unsigned BIGINT)
LANGUAGE plpgsql STABLE
SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
    SELECT 'oauth_connections'::TEXT,
      COUNT(*),
      COUNT(hmac),
      COUNT(*) - COUNT(hmac)
    FROM oauth_connections
    UNION ALL
    SELECT 'project_connections'::TEXT,
      COUNT(*),
      COUNT(hmac),
      COUNT(*) - COUNT(hmac)
    FROM project_connections
    UNION ALL
    SELECT 'tenant_compliance_profiles'::TEXT,
      COUNT(*),
      COUNT(hmac),
      COUNT(*) - COUNT(hmac)
    FROM tenant_compliance_profiles;
END;
$$;

GRANT EXECUTE ON FUNCTION row_hmac_inventory() TO authenticated, anon, service_role;

COMMENT ON FUNCTION row_hmac_inventory() IS
  'Story 6.8 — counts signed/unsigned rows per HMAC-tracked table. Operator runs this after backfill to confirm 0 unsigned rows remain.';

SELECT 'row HMAC columns + inventory RPC ready' AS status;

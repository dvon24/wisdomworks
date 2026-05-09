-- Allow yahoo + imap as oauth_connections.provider values.
--
-- The original CHECK constraint only allowed the OAuth-flow providers
-- (google, microsoft, meta, apple). When the Connections tab tries to
-- save a Yahoo IMAP connection it gets Postgres error 23514
-- (check_constraint_violation).
--
-- Run this once in the Supabase SQL Editor to widen the constraint.

DO $$
DECLARE
  conname text;
BEGIN
  -- Find any existing CHECK constraint on the provider column and drop it
  SELECT con.conname INTO conname
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'oauth_connections'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%provider%';

  IF conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE oauth_connections DROP CONSTRAINT %I', conname);
    RAISE NOTICE 'Dropped existing constraint: %', conname;
  END IF;
END $$;

ALTER TABLE oauth_connections
  ADD CONSTRAINT oauth_connections_provider_check
  CHECK (provider IN ('google', 'microsoft', 'meta', 'apple', 'yahoo', 'imap'));

-- Verify
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'oauth_connections'::regclass
  AND contype = 'c';

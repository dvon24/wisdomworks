-- Credential security hardening.
--
-- Adds:
--   1. credential_access_log — append-only record of every credential
--      decryption (which agent/tool/cron read which connection's token,
--      and when). Powers forensics if a credential is ever suspected
--      compromised.
--   2. last_rotated_at column on project_connections and oauth_connections
--      so Marcus can surface "this token is 90+ days old, rotate it" as
--      an approval card.
--
-- Run once in the Supabase SQL Editor.

-- ─── Audit log ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS credential_access_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_phone TEXT NOT NULL,
  -- What kind of connection was accessed
  connection_type TEXT NOT NULL,
  -- The connection id (FK shape varies by type — soft reference, no FK)
  connection_id UUID NOT NULL,
  -- Who/what triggered the decrypt
  caller TEXT NOT NULL,
  -- e.g. 'cron:project-sync', 'tool:list_recent_commits', 'tool:approve_followup'
  caller_context TEXT,
  -- Optional reference to the agent that initiated
  agent_instance_id UUID,
  agent_run_id UUID,
  -- Was the decryption attempt successful?
  ok BOOLEAN NOT NULL DEFAULT true,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT credential_access_log_type_check CHECK (
    connection_type IN ('oauth_connection', 'project_connection')
  )
);

CREATE INDEX IF NOT EXISTS credential_access_log_tenant_idx
  ON credential_access_log (tenant_phone, created_at DESC);
CREATE INDEX IF NOT EXISTS credential_access_log_connection_idx
  ON credential_access_log (connection_id, created_at DESC);


-- ─── Rotation tracking ─────────────────────────────────────────────────────
ALTER TABLE project_connections
  ADD COLUMN IF NOT EXISTS last_rotated_at TIMESTAMPTZ;

ALTER TABLE oauth_connections
  ADD COLUMN IF NOT EXISTS last_rotated_at TIMESTAMPTZ;

-- Backfill: existing rows get their created_at as the de facto rotation
-- date so they don't immediately show as "0 days old" once Marcus starts
-- looking.
UPDATE project_connections SET last_rotated_at = created_at WHERE last_rotated_at IS NULL;
UPDATE oauth_connections SET last_rotated_at = COALESCE(updated_at, now()) WHERE last_rotated_at IS NULL;


-- ─── connections_due_for_rotation ──────────────────────────────────────────
-- Returns active connections older than the threshold so Marcus can
-- surface them as approval cards.
CREATE OR REPLACE FUNCTION connections_due_for_rotation(
  p_tenant_phone TEXT,
  p_max_age_days INTEGER DEFAULT 90
)
RETURNS TABLE (
  connection_type TEXT,
  connection_id UUID,
  display_name TEXT,
  last_rotated_at TIMESTAMPTZ,
  days_since_rotation INTEGER
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    'project_connection'::text AS connection_type,
    pc.id AS connection_id,
    pc.project_name AS display_name,
    pc.last_rotated_at,
    EXTRACT(DAY FROM (now() - pc.last_rotated_at))::integer AS days_since_rotation
  FROM project_connections pc
  WHERE pc.tenant_phone = p_tenant_phone
    AND pc.status = 'active'
    AND pc.last_rotated_at < now() - (p_max_age_days || ' days')::interval
  UNION ALL
  SELECT
    'oauth_connection'::text AS connection_type,
    oc.id AS connection_id,
    (oc.provider || '/' || oc.service) AS display_name,
    oc.last_rotated_at,
    EXTRACT(DAY FROM (now() - oc.last_rotated_at))::integer AS days_since_rotation
  FROM oauth_connections oc
  WHERE oc.phone_number = p_tenant_phone
    AND oc.status = 'active'
    AND oc.last_rotated_at < now() - (p_max_age_days || ' days')::interval
  ORDER BY days_since_rotation DESC;
$$;

SELECT 'credential_access_log + last_rotated_at + connections_due_for_rotation ready' AS status;

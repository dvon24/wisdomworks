-- Known people registry.
--
-- Iris confused Devon's attorney (Ron) with Alex (the Au7o Director
-- agent) because there's no entity disambiguation — agents have no
-- structured concept of who is who in the owner's network.
--
-- This table fixes that. Owner can say "Ron Beaman is my attorney" and
-- Iris stores it. Future prompts inject the list so agents always know
-- which name refers to a real person vs another teammate.
--
-- Also auto-populated via email-learn cron when signatures parse out
-- (source='auto:email_signature').
--
-- Run once in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS known_people (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_phone TEXT NOT NULL,
  -- Canonical name (lowercase for matching; display_name keeps casing)
  name_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  -- Role / relationship to owner: 'attorney', 'accountant', 'client', 'spouse', etc.
  role TEXT,
  -- 1-2 sentence context the owner provided
  notes TEXT,
  -- Associated email address(es) for cross-reference with email_contacts
  email TEXT,
  -- Where this entry came from: 'owner_defined' (explicit) or 'auto:email_signature'
  source TEXT NOT NULL DEFAULT 'owner_defined',
  -- Confidence 0-1 — manual definitions = 1.0, auto-mined = lower
  confidence FLOAT NOT NULL DEFAULT 1.0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT known_people_source_check CHECK (
    source IN ('owner_defined', 'auto:email_signature', 'auto:agent_extraction')
  ),
  UNIQUE (tenant_phone, name_key)
);

CREATE INDEX IF NOT EXISTS known_people_tenant_idx
  ON known_people (tenant_phone, role, display_name);
CREATE INDEX IF NOT EXISTS known_people_email_idx
  ON known_people (tenant_phone, email) WHERE email IS NOT NULL;


-- ─── upsert_known_person ───────────────────────────────────────────────────
-- Idempotent upsert keyed by (tenant, name_key). Owner-defined entries
-- (confidence 1.0) never get overwritten by auto-mined ones.

CREATE OR REPLACE FUNCTION upsert_known_person(
  p_tenant_phone TEXT,
  p_display_name TEXT,
  p_role TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_source TEXT DEFAULT 'owner_defined',
  p_confidence FLOAT DEFAULT 1.0
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_id UUID;
  v_name_key TEXT;
BEGIN
  v_name_key := lower(trim(p_display_name));
  IF v_name_key IS NULL OR v_name_key = '' THEN
    RAISE EXCEPTION 'display_name required';
  END IF;

  INSERT INTO known_people (
    tenant_phone, name_key, display_name, role, notes, email, source, confidence
  )
  VALUES (
    p_tenant_phone, v_name_key, p_display_name, p_role, p_notes, lower(p_email), p_source, p_confidence
  )
  ON CONFLICT (tenant_phone, name_key) DO UPDATE
  SET
    -- Don't let auto-mined entries clobber owner-defined ones
    display_name = CASE WHEN known_people.source = 'owner_defined' AND p_source != 'owner_defined'
                        THEN known_people.display_name ELSE EXCLUDED.display_name END,
    role = CASE WHEN known_people.source = 'owner_defined' AND p_source != 'owner_defined'
                THEN known_people.role ELSE COALESCE(EXCLUDED.role, known_people.role) END,
    notes = CASE WHEN known_people.source = 'owner_defined' AND p_source != 'owner_defined'
                 THEN known_people.notes ELSE COALESCE(EXCLUDED.notes, known_people.notes) END,
    email = COALESCE(EXCLUDED.email, known_people.email),
    confidence = GREATEST(known_people.confidence, EXCLUDED.confidence),
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

SELECT 'known_people + upsert_known_person ready' AS status;

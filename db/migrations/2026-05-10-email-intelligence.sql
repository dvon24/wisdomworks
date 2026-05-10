-- Email intelligence — voice profile, contact frequency, trusted senders.
--
-- Three things the personal assistant needs to be useful:
--   1. How the owner writes (voice profile mined from sent folder)
--   2. Who the owner frequently emails (sent recipients)
--   3. Who the owner actually engages with (read inbox = trusted senders;
--      a sender you regularly read is not spam, even if subject looks
--      promotional)
--
-- Powers:
--   - draft_email tool injects voice profile so drafts sound like the user
--   - email-sift classifier injects trusted senders so known contacts get
--     business-confidence boost and stranger senders get spam-suspicion lift
--   - Daily email-learn cron refreshes both from Sent + Read folders
--
-- Run once in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS email_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_phone TEXT NOT NULL,
  -- Lowercase canonical email address
  address TEXT NOT NULL,
  -- Best-effort display name from envelope
  display_name TEXT,
  -- How many emails the owner has SENT to this address
  sent_count INTEGER NOT NULL DEFAULT 0,
  -- How many emails the owner has RECEIVED from this address
  received_count INTEGER NOT NULL DEFAULT 0,
  -- How many of the received emails the owner has actually READ
  -- (seen=true on IMAP). High signal for "this is a real person you talk to".
  read_count INTEGER NOT NULL DEFAULT 0,
  last_sent_at TIMESTAMPTZ,
  last_received_at TIMESTAMPTZ,
  -- Owner-marked: 'trusted' | 'blocked' | NULL (auto)
  trust_label TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (tenant_phone, address),
  CONSTRAINT email_contacts_trust_check CHECK (
    trust_label IS NULL OR trust_label IN ('trusted', 'blocked')
  )
);

CREATE INDEX IF NOT EXISTS email_contacts_tenant_idx
  ON email_contacts (tenant_phone, sent_count DESC, read_count DESC);
CREATE INDEX IF NOT EXISTS email_contacts_address_idx
  ON email_contacts (tenant_phone, address);


CREATE TABLE IF NOT EXISTS email_voice_profiles (
  tenant_phone TEXT PRIMARY KEY,
  -- Structured traits: { greeting_style, signoff_style, formality, sentence_length, tone_descriptors[], common_phrases[] }
  traits JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- 2-3 redacted excerpts of actual sent emails, used as few-shot examples
  -- in the draft prompt. Stored only with PII the user already wrote.
  examples JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Optional sign-off block detected from sent footers
  signature TEXT,
  -- How many sent emails were used to build this profile
  sample_size INTEGER NOT NULL DEFAULT 0,
  last_built_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);


-- ─── upsert_email_contact ─────────────────────────────────────────────────
-- Atomic counter increment + upsert. Pass deltas; nulls are no-ops.
-- Preserves user-set trust_label (only updates if you pass a non-null value).

CREATE OR REPLACE FUNCTION upsert_email_contact(
  p_tenant_phone TEXT,
  p_address TEXT,
  p_display_name TEXT DEFAULT NULL,
  p_sent_delta INTEGER DEFAULT 0,
  p_received_delta INTEGER DEFAULT 0,
  p_read_delta INTEGER DEFAULT 0,
  p_last_sent_at TIMESTAMPTZ DEFAULT NULL,
  p_last_received_at TIMESTAMPTZ DEFAULT NULL,
  p_trust_label TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_id UUID;
  v_addr TEXT;
BEGIN
  v_addr := lower(trim(p_address));
  IF v_addr IS NULL OR v_addr = '' THEN
    RAISE EXCEPTION 'address required';
  END IF;

  INSERT INTO email_contacts (
    tenant_phone, address, display_name,
    sent_count, received_count, read_count,
    last_sent_at, last_received_at, trust_label
  )
  VALUES (
    p_tenant_phone, v_addr, p_display_name,
    GREATEST(p_sent_delta, 0), GREATEST(p_received_delta, 0), GREATEST(p_read_delta, 0),
    p_last_sent_at, p_last_received_at, p_trust_label
  )
  ON CONFLICT (tenant_phone, address) DO UPDATE
  SET
    display_name = COALESCE(EXCLUDED.display_name, email_contacts.display_name),
    sent_count = email_contacts.sent_count + GREATEST(p_sent_delta, 0),
    received_count = email_contacts.received_count + GREATEST(p_received_delta, 0),
    read_count = email_contacts.read_count + GREATEST(p_read_delta, 0),
    last_sent_at = GREATEST(email_contacts.last_sent_at, p_last_sent_at),
    last_received_at = GREATEST(email_contacts.last_received_at, p_last_received_at),
    trust_label = COALESCE(p_trust_label, email_contacts.trust_label),
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;


-- ─── top_email_contacts ───────────────────────────────────────────────────
-- Returns the top N contacts by combined engagement signal.
-- Engagement = sent_count * 2 (active) + read_count (passive trust) + 0.5 * received_count.
-- Excludes blocked addresses.

CREATE OR REPLACE FUNCTION top_email_contacts(
  p_tenant_phone TEXT,
  p_limit INTEGER DEFAULT 25
)
RETURNS TABLE (
  address TEXT,
  display_name TEXT,
  sent_count INTEGER,
  received_count INTEGER,
  read_count INTEGER,
  trust_label TEXT,
  engagement_score FLOAT,
  last_interaction_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    address,
    display_name,
    sent_count,
    received_count,
    read_count,
    trust_label,
    (sent_count * 2.0 + read_count + received_count * 0.5) AS engagement_score,
    GREATEST(COALESCE(last_sent_at, '1970-01-01'::timestamptz),
             COALESCE(last_received_at, '1970-01-01'::timestamptz)) AS last_interaction_at
  FROM email_contacts
  WHERE tenant_phone = p_tenant_phone
    AND (trust_label IS NULL OR trust_label != 'blocked')
  ORDER BY engagement_score DESC, last_sent_at DESC NULLS LAST
  LIMIT p_limit;
$$;

SELECT 'email_contacts + email_voice_profiles + RPCs ready' AS status;

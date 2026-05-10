-- Email follow-up reminders.
--
-- The personal assistant scans recent sent emails, finds ones that haven't
-- gotten a reply in N+ days, drafts a polite follow-up using the owner's
-- voice profile, and pushes it to WhatsApp pre-drafted. Owner replies
-- 'send' / 'skip' / 'edit' — no manual drafting required.
--
-- Lifecycle: pending -> sent | declined | expired (auto after 14 days)
--
-- Run once in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS email_followup_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_phone TEXT NOT NULL,
  -- The recipient who hasn't replied
  recipient_address TEXT NOT NULL,
  recipient_name TEXT,
  -- Original email metadata
  original_message_id TEXT,
  original_subject TEXT NOT NULL,
  original_sent_at TIMESTAMPTZ NOT NULL,
  original_snippet TEXT,
  days_since_sent INTEGER NOT NULL DEFAULT 0,
  -- Drafted follow-up (assistant-generated, owner-reviewable)
  draft_subject TEXT,
  draft_body TEXT NOT NULL,
  -- Lifecycle
  status TEXT NOT NULL DEFAULT 'pending',
  proposed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ,
  sent_message_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT email_followup_status_check CHECK (
    status IN ('pending', 'sent', 'declined', 'expired')
  )
);

-- Partial unique on PENDING — allows multiple historical proposals per
-- thread (one pending, prior decided ones in history) but prevents
-- spamming the same prompt every day the cron runs.
CREATE UNIQUE INDEX IF NOT EXISTS email_followup_proposals_pending_unique
  ON email_followup_proposals (tenant_phone, recipient_address, original_subject)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS email_followup_proposals_tenant_idx
  ON email_followup_proposals (tenant_phone, status, proposed_at DESC);


-- ─── expire_stale_followups ───────────────────────────────────────────────
-- Pending proposals older than 14 days get auto-expired so the slot frees up
-- for the next round of detection. Called by the daily cron at the top of
-- each run.
CREATE OR REPLACE FUNCTION expire_stale_followups(p_max_age_days INTEGER DEFAULT 14)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE email_followup_proposals
  SET status = 'expired', decided_at = now()
  WHERE status = 'pending'
    AND proposed_at < now() - (p_max_age_days || ' days')::interval;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

SELECT 'email_followup_proposals + expire_stale_followups ready' AS status;

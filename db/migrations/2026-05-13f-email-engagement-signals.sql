-- Story 2.16 Phase 2c — Email engagement signal.
--
-- Devon's rule (project_email_engagement_signal.md): the emails the owner
-- opens are the ones the classifier should weight higher. The ones they
-- ignore (spam-shaped) should auto-deprioritize over time. PASSIVE
-- learning — no new approval cards, no notifications, just bias the
-- classifier with the signal.
--
-- Capture: a 6-hour cron re-checks the read state of emails classified
-- in the last 14 days (Gmail label / Outlook isRead / IMAP \Seen flag).
-- Updates currently_unread + checked_at on each tick.
--
-- Aggregate: sender-level open rate over 30/90 days feeds the classifier
-- system prompt so the next batch of emails has engagement context.
--
-- Run once in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS email_engagement_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_phone TEXT NOT NULL,
  provider TEXT NOT NULL,
  -- Provider's message id (Gmail msg id / Outlook id / IMAP uid)
  email_id TEXT NOT NULL,
  sender TEXT NOT NULL,
  subject TEXT,
  email_received_at TIMESTAMPTZ,
  -- Engagement state
  was_unread_at_classification BOOLEAN NOT NULL DEFAULT true,
  currently_unread BOOLEAN NOT NULL DEFAULT true,
  -- When the unread → read transition was first observed by the cron
  first_opened_at TIMESTAMPTZ,
  -- Cron heartbeat — when did we last poll the read state
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Lifecycle: 'tracking' = actively polled, 'archived' = past the 14-day window
  status TEXT NOT NULL DEFAULT 'tracking',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT engagement_signals_status_check CHECK (status IN ('tracking', 'archived'))
);

-- Unique per (tenant, email_id) so re-runs upsert cleanly
CREATE UNIQUE INDEX IF NOT EXISTS email_engagement_signals_unique
  ON email_engagement_signals (tenant_phone, email_id);

-- Aggregation index — sender-level engagement rate over a window
CREATE INDEX IF NOT EXISTS email_engagement_sender_idx
  ON email_engagement_signals (tenant_phone, sender, email_received_at DESC);

-- Polling window index — cron pulls 'tracking' rows where checked_at is stale
CREATE INDEX IF NOT EXISTS email_engagement_polling_idx
  ON email_engagement_signals (tenant_phone, status, checked_at)
  WHERE status = 'tracking';

SELECT 'email_engagement_signals ready' AS status;

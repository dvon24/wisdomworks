-- Unified notification queue.
--
-- Every proactive WhatsApp push - escalations, email-attention digests,
-- follow-up prompts, briefing items - lands here instead of being sent
-- as a separate text. Iris's digest synthesizer drains the queue and
-- bundles everything into ONE structured message:
--
--   Important
--   - thing 1
--   - thing 2
--
--   Worth a glance
--   - thing 3
--
--   FYI
--   - thing 4
--
-- Critical-severity items still push immediately (security/payment
-- failures shouldn't wait for the next digest cycle).
--
-- Run once in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS notification_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_phone TEXT NOT NULL,
  -- 'escalation' | 'email_attention' | 'followup_prompt' | 'briefing_item' | 'process_detected' | 'agent_observation'
  kind TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  title TEXT NOT NULL,
  body TEXT,
  source_agent TEXT,
  -- Optional reference back to the originating record (followup id, run id, etc.)
  source_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Lifecycle: pending -> delivered | expired | dismissed
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ,
  delivered_in_message_id TEXT,

  CONSTRAINT notification_queue_severity_check CHECK (
    severity IN ('low', 'medium', 'high', 'critical')
  ),
  CONSTRAINT notification_queue_status_check CHECK (
    status IN ('pending', 'delivered', 'expired', 'dismissed')
  )
);

CREATE INDEX IF NOT EXISTS notification_queue_pending_idx
  ON notification_queue (tenant_phone, severity, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS notification_queue_history_idx
  ON notification_queue (tenant_phone, status, created_at DESC);


-- ─── expire_stale_notifications ───────────────────────────────────────────
-- Pending notifications older than 48 hours are auto-expired so the queue
-- doesn't accumulate forever. Called by the digest cron at the top of each
-- run. (48h is generous - if you've been silent that long, the morning
-- briefing already covered it.)
CREATE OR REPLACE FUNCTION expire_stale_notifications(p_max_age_hours INTEGER DEFAULT 48)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE notification_queue
  SET status = 'expired'
  WHERE status = 'pending'
    AND created_at < now() - (p_max_age_hours || ' hours')::interval;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

SELECT 'notification_queue + expire_stale_notifications ready' AS status;

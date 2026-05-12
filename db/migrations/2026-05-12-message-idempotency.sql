-- Webhook idempotency: Meta WhatsApp + Telegram retry their webhook
-- delivery if our handler is slow returning 200. iris-brain replies that
-- include tool calls (research, doc-gen, deep browsing) can take 30-60s,
-- well past Meta's ~20s timeout. Result: the same inbound message gets
-- processed N times, firing tools N times, sending N replies.
--
-- This table acts as a "claim" record. The webhook does:
--   INSERT INTO processed_messages (message_id, ...) ON CONFLICT DO NOTHING
--   RETURNING id
-- If RETURNING is empty, another invocation already claimed this message —
-- bail with 200 immediately, no reprocessing.
--
-- Run once in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS processed_messages (
  message_id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  tenant_phone TEXT,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT processed_messages_channel_check
    CHECK (channel IN ('whatsapp', 'telegram', 'sms', 'imessage', 'discord'))
);

-- Cleanup: rows older than 7 days can be safely deleted (Meta won't retry
-- that long). Run periodically or via a scheduled function.
CREATE INDEX IF NOT EXISTS processed_messages_cleanup_idx
  ON processed_messages (processed_at) WHERE processed_at < now() - INTERVAL '7 days';

SELECT 'processed_messages ready' AS status;

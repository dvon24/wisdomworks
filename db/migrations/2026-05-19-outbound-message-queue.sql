-- Unified outbound-message queue.
--
-- Architectural decision from conversation 2026-05-19 (party-mode follow-up):
-- we had two parallel writers to the owner's WhatsApp channel (Iris's
-- chat-brain + proactive crons), with no coordinator. Result: digest
-- messages interrupted active chats (2026-05-18 transcript: Devon asked
-- "is there still an error?" and got a Riley/commits digest as the
-- apparent answer).
--
-- The unified outbox routes ALL owner-bound messages through a single
-- queue. A drainer cron consumes it with priority rules:
--   - 'chat_reply' / 'urgent' → send immediately (Iris's responses
--     reach the owner first, no holding)
--   - 'digest' → hold if owner activity within 60s, batch + merge
--     multiple pending digests for the same tenant
--
-- Pattern mirrors Google A2A / OpenAI Swarm handoffs — single
-- coordinator deciding what reaches the user, not parallel writers
-- racing the WhatsApp Graph API.
--
-- IDEMPOTENT — safe to re-run.

CREATE TABLE IF NOT EXISTS outbound_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_phone TEXT NOT NULL,
  -- Priority drives drainer routing. 'chat_reply' is recorded for
  -- telemetry but typically NOT routed through here — chat brain
  -- still sends synchronously (latency matters). 'digest' is the
  -- common case for cron-pushed messages. 'urgent' bypasses holds.
  priority TEXT NOT NULL DEFAULT 'digest',
  -- The body the owner will see (text, or caption for media).
  body TEXT NOT NULL,
  -- Source agent / cron — same taxonomy as OwnerMessageSource in
  -- _lib/owner-message.ts. Used for merge formatting + audit.
  source TEXT NOT NULL,
  -- Optional media payload — { type: 'video'|'image', url: '...' }
  media JSONB,
  -- Lifecycle: pending → sent | deferred | failed | merged.
  -- 'deferred' means we held it past one drainer tick; the drainer
  -- will re-try it (status reset to pending) once deferred_until passes.
  -- 'merged' means another row absorbed this one; kept for audit.
  status TEXT NOT NULL DEFAULT 'pending',
  -- When status='deferred', when does the drainer re-evaluate?
  deferred_until TIMESTAMPTZ,
  -- For 'merged' rows: the row that absorbed this one.
  merged_into UUID,
  -- WhatsApp message id after successful send.
  whatsapp_message_id TEXT,
  -- Last error if any.
  last_error TEXT,
  -- Free-form metadata (e.g. dedup_signature, notification_ids merged).
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,

  CONSTRAINT outbound_messages_priority_check CHECK (
    priority IN ('chat_reply', 'urgent', 'digest')
  ),
  CONSTRAINT outbound_messages_status_check CHECK (
    status IN ('pending', 'sent', 'deferred', 'failed', 'merged')
  )
);

-- Drainer's hot read path: find pending+due rows per tenant.
CREATE INDEX IF NOT EXISTS outbound_messages_drain_idx
  ON outbound_messages (tenant_phone, priority, status, created_at)
  WHERE status IN ('pending', 'deferred');

-- For deferred rows: efficient "is this ready yet" check.
CREATE INDEX IF NOT EXISTS outbound_messages_deferred_idx
  ON outbound_messages (deferred_until)
  WHERE status = 'deferred';

-- ─── last_assistant_message_at on whatsapp_contexts ────────────────────
--
-- Drainer needs to know "did Iris just reply" so it can hold digests
-- for ~60s after a chat exchange. last_owner_message_at already exists
-- (or is implied by last_seen); this adds the symmetric assistant-side
-- timestamp updated every time sendOwnerMessage actually delivers.

ALTER TABLE whatsapp_contexts
  ADD COLUMN IF NOT EXISTS last_assistant_message_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS whatsapp_contexts_last_assistant_idx
  ON whatsapp_contexts (last_assistant_message_at DESC NULLS LAST);

SELECT 'outbound_messages + last_assistant_message_at ready' AS status;

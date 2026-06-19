-- 2026-06-19 — Owner-message debounce buffer ("shotgun messages").
--
-- Devon 2026-06-17: "when I send two messages back to back I don't want two
-- replies — combine them, consider the second before answering the first."
-- Today each WhatsApp message is its own webhook → its own brain run → its own
-- reply, and an earlier reply can't see a later message. This buffer lets the
-- webhook COLLECT rapid-fire messages and run the brain ONCE on the combined
-- text.
--
-- Mechanism (see _lib/owner-message-debounce.ts): each message inserts a
-- 'pending' row; the webhook's after() waits a short window then atomically
-- flips this tenant's pending rows to 'processing' (RETURNING them). Postgres
-- row locking makes that claim exclusive, so exactly one flush wins a burst and
-- the rest no-op. Internal infra table — service-key only.

CREATE TABLE IF NOT EXISTS pending_owner_messages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_phone text NOT NULL,
  message_id   text,
  text         text NOT NULL,
  status       text NOT NULL DEFAULT 'pending',   -- pending | processing | done
  received_at  timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- The claim query filters tenant_phone + status and orders by received_at.
CREATE INDEX IF NOT EXISTS pending_owner_messages_tenant_status_idx
  ON pending_owner_messages (tenant_phone, status, received_at);

-- Service-role-only infra table (the service key bypasses RLS; enabling it with
-- no policy denies anon/authenticated, matching the other internal tables).
ALTER TABLE pending_owner_messages ENABLE ROW LEVEL SECURITY;

SELECT 'pending_owner_messages ready — owner-message debounce buffer' AS status;

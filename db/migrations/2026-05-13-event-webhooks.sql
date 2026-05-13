-- Event webhooks — outbound event firehose for Zapier, Make, IFTTT,
-- n8n, custom endpoints. Tenant configures URLs + which event types to
-- fire, we POST JSON when those events happen.
--
-- This is the breadth multiplier: instead of building 3,000 first-
-- party integrations, owners pipe our events into the automation
-- platform they already use.
--
-- Run once in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS event_webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_phone TEXT NOT NULL,
  -- Where to POST events (any HTTPS URL — Zapier hook, Make scenario,
  -- n8n trigger, custom API endpoint, etc.)
  url TEXT NOT NULL,
  -- Owner-friendly label so they know which automation this is
  label TEXT,
  -- Event types this webhook subscribes to. Empty = subscribe to all.
  -- Known types: 'booking_created', 'client_created', 'client_visit_logged',
  -- 'insight_emitted', 'lead_captured', 'team_gap_proposed',
  -- 'review_received', 'photo_uploaded'
  event_types TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  -- HMAC secret for signature verification — receiver checks
  -- X-WisdomWorks-Signature header matches HMAC-SHA256(secret, body)
  signing_secret TEXT NOT NULL,
  -- Lifecycle
  status TEXT NOT NULL DEFAULT 'active',
  last_fired_at TIMESTAMPTZ,
  last_status_code INTEGER,
  last_error TEXT,
  fire_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,

  CONSTRAINT event_webhooks_status_check CHECK (status IN ('active', 'paused', 'revoked'))
);

CREATE INDEX IF NOT EXISTS event_webhooks_tenant_idx
  ON event_webhooks (tenant_phone, status) WHERE status = 'active';

-- Delivery log for debugging — owner can see which events fired and
-- whether the receiver returned 2xx
CREATE TABLE IF NOT EXISTS event_webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id UUID NOT NULL REFERENCES event_webhooks(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  response_status INTEGER,
  response_body TEXT,
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_ms INTEGER
);

CREATE INDEX IF NOT EXISTS event_webhook_deliveries_webhook_idx
  ON event_webhook_deliveries (webhook_id, delivered_at DESC);

SELECT 'event_webhooks + event_webhook_deliveries ready' AS status;

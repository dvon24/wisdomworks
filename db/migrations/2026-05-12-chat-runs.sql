-- Item #3 (monetization sprint): per-action cost transparency.
--
-- Iris (the owner's chat brain) is the biggest single token source, but every
-- reply only logged to console — invisible to the dashboard and to the
-- owner. This table captures one row per chat reply (WhatsApp + deck) so
-- monthly usage actually adds up to the real bill.
--
-- Separate from agent_runs because chat replies aren't tied to a specific
-- agent_instance — they're the owner-facing brain that fans out to tools.
--
-- Run once in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS chat_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_phone TEXT NOT NULL,
  surface TEXT NOT NULL DEFAULT 'whatsapp',
  model_used TEXT,
  iterations INTEGER DEFAULT 1,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  cached_tokens_in INTEGER NOT NULL DEFAULT 0,
  cost_usd NUMERIC(10, 6) NOT NULL DEFAULT 0,
  tools_used TEXT[] DEFAULT ARRAY[]::TEXT[],
  duration_ms INTEGER,
  user_message_preview TEXT,
  assistant_reply_preview TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chat_runs_surface_check CHECK (surface IN ('whatsapp', 'deck', 'telegram', 'sms', 'imessage'))
);

CREATE INDEX IF NOT EXISTS chat_runs_tenant_idx
  ON chat_runs (tenant_phone, started_at DESC);

-- ─────────────────────────────────────────────────────────────────────────
-- Overage events — when usage crosses the included monthly budget, we emit
-- one row here per "credit-bucket" worth of overage so we can later replay
-- them as Stripe usage_records on a metered subscription item.
--
-- Until the Stripe metered Price ID exists in the dashboard, the
-- billing/cron will write these rows but won't push to Stripe; the data is
-- already correct and replayable.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS overage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_phone TEXT NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  -- Which category drove the overage: 'ai', 'whatsapp', 'voice', 'storage'
  category TEXT NOT NULL DEFAULT 'ai',
  -- The amount over the included budget that this event represents (USD).
  amount_usd NUMERIC(10, 6) NOT NULL,
  -- Track whether it's been pushed to Stripe yet.
  reported_to_stripe BOOLEAN NOT NULL DEFAULT FALSE,
  stripe_usage_record_id TEXT,
  reported_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS overage_events_tenant_idx
  ON overage_events (tenant_phone, period_start DESC);

CREATE INDEX IF NOT EXISTS overage_events_unreported_idx
  ON overage_events (reported_to_stripe, created_at) WHERE reported_to_stripe = FALSE;

SELECT 'chat_runs + overage_events ready' AS status;

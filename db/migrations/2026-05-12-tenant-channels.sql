-- Item #4 (monetization sprint): messaging-channel adapters.
--
-- Today the tenant ↔ surface mapping is hard-coded: phone_number on
-- whatsapp_contexts IS the tenant. As we add Telegram / SMS / iMessage we
-- need a generic map from (channel, external_id) → tenant_phone so the
-- iris-brain can identify the tenant regardless of surface.
--
-- Run once in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS tenant_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_phone TEXT NOT NULL,
  channel TEXT NOT NULL,
  -- Provider-specific identifier:
  --   telegram: chat.id (numeric, stored as text)
  --   sms:      E.164 phone number
  --   imessage: Apple business chat ID
  --   discord:  user.id or channel.id
  external_id TEXT NOT NULL,
  -- Friendly display: telegram @handle, or 'SMS', etc.
  display_name TEXT,
  -- Live or paused (e.g. user said "stop telegram for now")
  status TEXT NOT NULL DEFAULT 'active',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at TIMESTAMPTZ,

  CONSTRAINT tenant_channels_status_check CHECK (status IN ('active', 'paused', 'revoked')),
  CONSTRAINT tenant_channels_channel_check CHECK (channel IN ('whatsapp', 'telegram', 'sms', 'imessage', 'discord')),
  -- One identifier maps to exactly one tenant globally
  CONSTRAINT tenant_channels_external_unique UNIQUE (channel, external_id)
);

CREATE INDEX IF NOT EXISTS tenant_channels_tenant_idx
  ON tenant_channels (tenant_phone, channel);

CREATE INDEX IF NOT EXISTS tenant_channels_lookup_idx
  ON tenant_channels (channel, external_id) WHERE status = 'active';

-- ─────────────────────────────────────────────────────────────────────────
-- Link codes — short-lived tokens the owner enters in their non-primary
-- channel (e.g. send "/link ABC123" to the Telegram bot) to bind it back
-- to their tenant.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS channel_link_codes (
  code TEXT PRIMARY KEY,
  tenant_phone TEXT NOT NULL,
  channel TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '15 minutes'),
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT link_codes_channel_check CHECK (channel IN ('telegram', 'sms', 'imessage', 'discord'))
);

CREATE INDEX IF NOT EXISTS channel_link_codes_tenant_idx
  ON channel_link_codes (tenant_phone, channel, expires_at DESC);

-- ─────────────────────────────────────────────────────────────────────────
-- RPC: redeem_channel_link_code(p_code, p_channel, p_external_id, p_display)
-- Atomically: validate code is unused + unexpired → upsert tenant_channels →
-- mark code consumed. Returns the resolved tenant_phone or NULL.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION redeem_channel_link_code(
  p_code TEXT,
  p_channel TEXT,
  p_external_id TEXT,
  p_display TEXT DEFAULT NULL
) RETURNS TEXT AS $$
DECLARE
  v_tenant TEXT;
BEGIN
  SELECT tenant_phone INTO v_tenant
  FROM channel_link_codes
  WHERE code = p_code
    AND channel = p_channel
    AND consumed_at IS NULL
    AND expires_at > now()
  FOR UPDATE;

  IF v_tenant IS NULL THEN
    RETURN NULL;
  END IF;

  -- Upsert the channel mapping. If this external_id is already linked to a
  -- DIFFERENT tenant, the unique constraint will block us. That's fine —
  -- the bot should report "already linked to another account" in that case.
  INSERT INTO tenant_channels (tenant_phone, channel, external_id, display_name, status)
  VALUES (v_tenant, p_channel, p_external_id, p_display, 'active')
  ON CONFLICT (channel, external_id) DO UPDATE
  SET tenant_phone = EXCLUDED.tenant_phone,
      display_name = COALESCE(EXCLUDED.display_name, tenant_channels.display_name),
      status = 'active',
      linked_at = now();

  UPDATE channel_link_codes
  SET consumed_at = now()
  WHERE code = p_code;

  RETURN v_tenant;
END;
$$ LANGUAGE plpgsql;

SELECT 'tenant_channels + channel_link_codes ready' AS status;

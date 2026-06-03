-- 2026-06-03 — SMB customer-facing framework, Step 1: customer_conversations.
--
-- The web widget already proved the customer lane (widget_conversations +
-- widget/book real Square bookings as a non-owner actor). This table is the
-- MESSAGING-channel equivalent: a customer texts the business's dedicated
-- number and is recognized as a customer of tenant X (NOT the owner). Keyed by
-- (tenant_phone, customer_phone, channel) instead of (api_key_id, visitor_id).
--
-- Channel-agnostic by design: 'sms' for the mid-June pilot (Twilio, no Meta
-- review), 'whatsapp' once per-tenant Meta numbers clear review.
--
-- The dangerous failure mode is a customer reaching the OWNER brain
-- (generateIrisReply / context-store.ts isOwner). This table never carries
-- owner identity; the routing split + a hard-capped customer tool array are
-- what enforce the boundary at runtime.

CREATE TABLE IF NOT EXISTS customer_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The business/tenant this customer belongs to (the inbound *To* number maps
  -- here). Same column name as every other tenant-scoped table → RLS helper.
  tenant_phone TEXT NOT NULL,
  -- The customer's number (the inbound *From*). E.164.
  customer_phone TEXT NOT NULL,
  -- Messaging channel this thread lives on.
  channel TEXT NOT NULL DEFAULT 'sms',
  -- Optional customer-provided info captured during conversation.
  customer_name TEXT,
  customer_email TEXT,
  -- Links to a client_profile (source:'inferred' auto-created on first contact)
  -- so customer history threads into the owner's existing CRM.
  client_profile_id UUID REFERENCES client_profiles(id) ON DELETE SET NULL,
  -- Full message thread (same shape as widget_conversations.messages).
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Lifecycle.
  status TEXT NOT NULL DEFAULT 'open',
  message_count INTEGER NOT NULL DEFAULT 0,
  -- Per-(tenant,customer)/day message sub-cap. msg_count_day is the date the
  -- counter refers to; the executor resets the count when the date rolls over.
  msg_count_today INTEGER NOT NULL DEFAULT 0,
  msg_count_day DATE,
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT customer_conv_channel_check CHECK (channel IN ('sms', 'whatsapp')),
  CONSTRAINT customer_conv_status_check CHECK (status IN ('open', 'closed', 'blocked'))
);

-- Fast lookup of the active thread for an inbound (tenant, customer) pair.
CREATE INDEX IF NOT EXISTS idx_customer_conv_lookup
  ON customer_conversations (tenant_phone, customer_phone, status, last_message_at DESC);

-- At most one OPEN thread per (tenant, customer, channel) — repeat texts append
-- to the same conversation instead of forking history.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_customer_conv_open
  ON customer_conversations (tenant_phone, customer_phone, channel)
  WHERE status = 'open';

-- Tenant isolation: one business's customers are never visible to another.
-- Inlined (NOT _enable_tenant_rls): that helper is DROPped at the end of
-- 2026-05-14d-rls-tenant-isolation.sql, so it isn't callable from later
-- migrations. app_tenant_phone() IS permanent (CREATE OR REPLACE, never
-- dropped), so we reproduce exactly what the helper did. The app uses the
-- service-role key (bypasses RLS); this enforces isolation on any anon/JWT path.
ALTER TABLE customer_conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customer_conversations_tenant_isolation ON customer_conversations;
CREATE POLICY customer_conversations_tenant_isolation ON customer_conversations
  FOR ALL TO authenticated, anon
  USING (tenant_phone = app_tenant_phone())
  WITH CHECK (tenant_phone = app_tenant_phone());

SELECT 'customer_conversations ready (SMB customer framework step 1)' AS status;

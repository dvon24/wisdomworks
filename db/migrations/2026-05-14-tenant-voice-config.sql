-- Story 2b.4 / 2b.5 / 2b.6 — Tenant voice configuration.
--
-- One row per tenant that has opted into voice. Created when the owner
-- provisions a number; deleted when they release it. Tenants without
-- a row have no voice agent (no recurring cost).
--
-- Vapi handles the call infrastructure (TTS / ASR / LLM routing /
-- interruption detection). Our backend exposes the agent tools the
-- voice assistant calls during a conversation: book_appointment,
-- check_availability, escalate_to_owner, etc.
--
-- Run once in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS tenant_voice_config (
  tenant_phone TEXT PRIMARY KEY,
  -- Vapi side
  vapi_assistant_id TEXT NOT NULL,
  vapi_phone_number_id TEXT,
  -- The actual Twilio-provisioned phone number (E.164)
  phone_number TEXT NOT NULL,
  -- Customizable greeting (Story 2b.6 — voice personality)
  greeting TEXT NOT NULL DEFAULT 'Hi, thanks for calling. How can I help?',
  -- ElevenLabs voice id (or a Vapi-supported voice provider id)
  voice_id TEXT,
  voice_provider TEXT DEFAULT '11labs',
  -- Personality / tone hints injected into the assistant system prompt
  tone TEXT,
  -- Escalation rules — when to forward / take a message
  escalation_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Business hours (calls outside hours can voicemail / text-back)
  business_hours JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Lifecycle
  status TEXT NOT NULL DEFAULT 'active',
  -- Cost transparency — recurring monthly $$ tracked here for the
  -- owner-facing dashboard (Twilio number rental + Vapi base fee).
  monthly_baseline_usd NUMERIC(6, 2) NOT NULL DEFAULT 1.15,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT tenant_voice_status_check CHECK (status IN ('active', 'paused', 'released'))
);

CREATE INDEX IF NOT EXISTS tenant_voice_phone_idx
  ON tenant_voice_config (phone_number)
  WHERE status = 'active';

-- Per-call records — written when Vapi sends end-of-call webhook.
-- Used for the daily summary, owner-facing call history, billing
-- (per-minute cost stamped here so we can show real costs per call).
CREATE TABLE IF NOT EXISTS voice_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_phone TEXT NOT NULL,
  vapi_call_id TEXT NOT NULL,
  caller_number TEXT,
  caller_known_person_id UUID,
  duration_seconds INTEGER,
  -- 'completed' | 'no_answer' | 'voicemail' | 'failed' | 'in_progress'
  outcome TEXT NOT NULL DEFAULT 'in_progress',
  transcript TEXT,
  summary TEXT,
  -- Stitched outcome: did the call accomplish a booking, leave a message,
  -- escalate to owner, etc?
  resolution TEXT,
  -- Per-call cost in USD (sum of carrier + LLM + TTS minutes on this call)
  cost_usd NUMERIC(6, 4),
  -- If a tool was called during the call (book_appointment etc), the
  -- agent_runs row is referenced here for provenance
  related_run_ids UUID[] DEFAULT ARRAY[]::UUID[],
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,

  CONSTRAINT voice_calls_outcome_check
    CHECK (outcome IN ('in_progress', 'completed', 'no_answer', 'voicemail', 'failed', 'escalated'))
);

CREATE UNIQUE INDEX IF NOT EXISTS voice_calls_vapi_unique
  ON voice_calls (vapi_call_id);

CREATE INDEX IF NOT EXISTS voice_calls_tenant_idx
  ON voice_calls (tenant_phone, started_at DESC);

CREATE INDEX IF NOT EXISTS voice_calls_caller_idx
  ON voice_calls (caller_number, started_at DESC);

-- Auto-touch updated_at on tenant_voice_config
CREATE OR REPLACE FUNCTION tenant_voice_touch()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS tenant_voice_touch ON tenant_voice_config;
CREATE TRIGGER tenant_voice_touch BEFORE UPDATE ON tenant_voice_config
  FOR EACH ROW EXECUTE FUNCTION tenant_voice_touch();

SELECT 'tenant_voice_config + voice_calls ready' AS status;

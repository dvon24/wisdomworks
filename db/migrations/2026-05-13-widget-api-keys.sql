-- Story 2b.8 — Embeddable widgets + REST API.
--
-- Tenants embed a chat widget / booking widget on their existing site
-- (Wix, WordPress, Squarespace, custom). Each tenant has one or more
-- API keys that authenticate widget + REST API requests. Keys are
-- stored hashed; the plain value is shown ONCE at creation and never
-- retrievable after.
--
-- Run once in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS widget_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_phone TEXT NOT NULL,
  -- SHA-256 of the plain API key. Plain value is never stored.
  key_hash TEXT NOT NULL UNIQUE,
  -- First 8 chars of the plain key, stored unhashed for owner display
  -- ("wk_abc12345..." in the deck so they can recognize their keys)
  key_prefix TEXT NOT NULL,
  -- Owner-provided label ("my wix site", "test")
  label TEXT,
  -- Allowed scopes: 'chat' | 'booking' | 'profile_read' (extensible)
  scopes TEXT[] NOT NULL DEFAULT ARRAY['chat']::TEXT[],
  -- Origin whitelist — if non-empty, requests from origins not in the list
  -- are rejected. Empty array = allow any origin (less safe; deck warns).
  allowed_origins TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  -- Lifecycle
  status TEXT NOT NULL DEFAULT 'active',
  last_used_at TIMESTAMPTZ,
  use_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT widget_api_keys_status_check CHECK (status IN ('active', 'revoked'))
);

CREATE INDEX IF NOT EXISTS widget_api_keys_tenant_idx
  ON widget_api_keys (tenant_phone, status) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS widget_api_keys_hash_lookup
  ON widget_api_keys (key_hash) WHERE status = 'active';

-- ─────────────────────────────────────────────────────────────────────────
-- Widget conversations — anonymous visitor sessions on the customer's
-- website. Each conversation is tied to an api_key and (optionally) a
-- visitor_id from a localStorage cookie on the customer's site.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS widget_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_phone TEXT NOT NULL,
  api_key_id UUID NOT NULL REFERENCES widget_api_keys(id) ON DELETE CASCADE,
  -- Stable visitor identifier from the embedded widget (UUID generated
  -- client-side and persisted to localStorage). Same visitor across
  -- multiple page loads gets the same conversation history.
  visitor_id TEXT NOT NULL,
  -- Optional visitor-provided info captured during conversation
  visitor_name TEXT,
  visitor_email TEXT,
  visitor_phone TEXT,
  -- Origin URL where the widget loaded
  origin TEXT,
  -- Full message thread
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- If this visitor's session led to creating a client_profile, link it
  client_profile_id UUID REFERENCES client_profiles(id) ON DELETE SET NULL,
  -- Lifecycle
  status TEXT NOT NULL DEFAULT 'open',
  message_count INTEGER NOT NULL DEFAULT 0,
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT widget_conversations_status_check CHECK (status IN ('open', 'closed', 'archived'))
);

CREATE INDEX IF NOT EXISTS widget_conversations_tenant_idx
  ON widget_conversations (tenant_phone, last_message_at DESC);

CREATE INDEX IF NOT EXISTS widget_conversations_visitor_idx
  ON widget_conversations (api_key_id, visitor_id, last_message_at DESC);

SELECT 'widget_api_keys + widget_conversations ready' AS status;

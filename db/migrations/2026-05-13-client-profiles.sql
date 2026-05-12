-- Story 2b.1 — Client Profiles & Visual Intelligence (Phase 1).
--
-- Tenant-scoped customer records: every business owner accumulates a list
-- of their clients with visit history, preferences, notes, satisfaction
-- signals. Agents update these as the owner talks about clients via
-- WhatsApp.
--
-- Separate from `known_people` (owner's personal network: attorney,
-- accountant, partners) — that table is about who the OWNER knows.
-- This table is about who the owner's BUSINESS serves.
--
-- Phase 2 (separate migration later) will add image-ingestion +
-- vision-analysis flow into client_photos.
--
-- Run once in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS client_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_phone TEXT NOT NULL,
  display_name TEXT NOT NULL,
  -- Optional contact info — phone is most reliable for caller-ID matching
  phone TEXT,
  email TEXT,
  -- Free-text preferences captured from owner ("#2 fade, medium on top",
  -- "balayage, toner 9V, allergic to PPD")
  preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Owner-or-agent notes the owner has confirmed
  notes TEXT,
  -- Aggregate stats
  visit_count INTEGER NOT NULL DEFAULT 0,
  first_visit_at TIMESTAMPTZ,
  last_visit_at TIMESTAMPTZ,
  -- Satisfaction inference (from feedback signals) — 'positive', 'neutral',
  -- 'negative', or null when unknown
  satisfaction_signal TEXT,
  -- Which vertical template was active when this profile was first created
  -- (for downstream business-type-aware reporting)
  vertical_label TEXT,
  -- Source: 'owner_defined' (owner told us), 'inferred' (agent extracted
  -- from chat without explicit confirmation), 'imported' (later)
  source TEXT NOT NULL DEFAULT 'inferred',
  -- Free-form tags (allergies, VIP, regular, lapsed, etc.)
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT client_profiles_source_check CHECK (source IN ('owner_defined', 'inferred', 'imported')),
  CONSTRAINT client_profiles_sat_check CHECK (satisfaction_signal IS NULL OR satisfaction_signal IN ('positive', 'neutral', 'negative'))
);

-- Dedup hint: same tenant + same name + (same phone OR null phone) merges
CREATE UNIQUE INDEX IF NOT EXISTS client_profiles_dedup_idx
  ON client_profiles (tenant_phone, lower(display_name), COALESCE(phone, ''));

CREATE INDEX IF NOT EXISTS client_profiles_tenant_idx
  ON client_profiles (tenant_phone, last_visit_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS client_profiles_phone_idx
  ON client_profiles (tenant_phone, phone) WHERE phone IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- Client visits — one row per interaction (job, appointment, message,
-- service rendered, whatever the vertical means by "visit"). Lightweight
-- log; the profile aggregates these.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS client_visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_profile_id UUID NOT NULL REFERENCES client_profiles(id) ON DELETE CASCADE,
  tenant_phone TEXT NOT NULL,
  -- Short owner-or-agent summary of what happened
  summary TEXT NOT NULL,
  -- Optional channel where the visit happened: 'in_person', 'phone',
  -- 'whatsapp', 'video', 'email', 'remote'
  channel TEXT,
  -- Owner-reported or inferred satisfaction
  satisfaction TEXT,
  -- Owner notes attached to this specific visit (separate from profile
  -- notes which are sticky)
  notes TEXT,
  -- Owner-reported revenue (optional — drives revenue analytics later)
  revenue_usd NUMERIC(10, 2),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT client_visits_sat_check CHECK (satisfaction IS NULL OR satisfaction IN ('positive', 'neutral', 'negative'))
);

CREATE INDEX IF NOT EXISTS client_visits_profile_idx
  ON client_visits (client_profile_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS client_visits_tenant_idx
  ON client_visits (tenant_phone, occurred_at DESC);

-- ─────────────────────────────────────────────────────────────────────────
-- Client photos — Phase 2 will populate this when image-ingestion ships.
-- Schema-only for now so we don't need a second migration later.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS client_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_profile_id UUID REFERENCES client_profiles(id) ON DELETE CASCADE,
  tenant_phone TEXT NOT NULL,
  -- Supabase Storage path; null until image is uploaded
  storage_path TEXT,
  -- Public/signed URL for display
  display_url TEXT,
  -- Free-text analysis output from vision model
  analysis_text TEXT,
  -- Structured tags extracted ('burned_outlet', 'gfci', 'romex', 'before',
  -- 'after', 'wiring')
  analysis_tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  -- Structured extracted entities (problem → diagnosis → solution → tools)
  extracted_entities JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Channel the photo arrived on
  source_channel TEXT,
  -- Inbound message ID for idempotency / dedup
  source_message_id TEXT,
  -- Caption the owner sent with the photo
  caption TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  analyzed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_photos_profile_idx
  ON client_photos (client_profile_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS client_photos_tenant_idx
  ON client_photos (tenant_phone, captured_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS client_photos_source_message_idx
  ON client_photos (source_message_id) WHERE source_message_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- RPC: upsert_client_profile(p_tenant_phone, p_display_name, p_phone, …)
-- Match by (tenant_phone, lower(display_name), phone) — merge instead of
-- inserting a duplicate. Bumps updated_at on existing rows.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION upsert_client_profile(
  p_tenant_phone TEXT,
  p_display_name TEXT,
  p_phone TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_preferences JSONB DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_vertical_label TEXT DEFAULT NULL,
  p_source TEXT DEFAULT 'inferred',
  p_tags TEXT[] DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  SELECT id INTO v_id
  FROM client_profiles
  WHERE tenant_phone = p_tenant_phone
    AND lower(display_name) = lower(p_display_name)
    AND COALESCE(phone, '') = COALESCE(p_phone, '');

  IF v_id IS NOT NULL THEN
    UPDATE client_profiles
    SET preferences = COALESCE(p_preferences, preferences) || COALESCE(client_profiles.preferences, '{}'::jsonb),
        notes = COALESCE(p_notes, notes),
        phone = COALESCE(phone, p_phone),
        email = COALESCE(email, p_email),
        vertical_label = COALESCE(vertical_label, p_vertical_label),
        -- Promote source if owner now confirmed an inferred profile
        source = CASE
          WHEN p_source = 'owner_defined' AND source <> 'owner_defined' THEN 'owner_defined'
          ELSE source
        END,
        tags = CASE
          WHEN p_tags IS NULL THEN tags
          ELSE (
            SELECT array_agg(DISTINCT t)
            FROM unnest(tags || p_tags) AS t
          )
        END,
        updated_at = now()
    WHERE id = v_id;
  ELSE
    INSERT INTO client_profiles (
      tenant_phone, display_name, phone, email, preferences, notes,
      vertical_label, source, tags
    )
    VALUES (
      p_tenant_phone,
      p_display_name,
      p_phone,
      p_email,
      COALESCE(p_preferences, '{}'::jsonb),
      p_notes,
      p_vertical_label,
      p_source,
      COALESCE(p_tags, ARRAY[]::TEXT[])
    )
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────────────────
-- RPC: record_client_visit — insert visit + bump aggregate stats on the
-- profile in one call. Returns the visit_id.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION record_client_visit(
  p_tenant_phone TEXT,
  p_client_profile_id UUID,
  p_summary TEXT,
  p_channel TEXT DEFAULT NULL,
  p_satisfaction TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_revenue_usd NUMERIC DEFAULT NULL,
  p_occurred_at TIMESTAMPTZ DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_visit_id UUID;
  v_when TIMESTAMPTZ;
BEGIN
  v_when := COALESCE(p_occurred_at, now());

  INSERT INTO client_visits (
    client_profile_id, tenant_phone, summary, channel, satisfaction, notes, revenue_usd, occurred_at
  )
  VALUES (
    p_client_profile_id, p_tenant_phone, p_summary, p_channel, p_satisfaction, p_notes, p_revenue_usd, v_when
  )
  RETURNING id INTO v_visit_id;

  UPDATE client_profiles
  SET visit_count = visit_count + 1,
      first_visit_at = COALESCE(first_visit_at, v_when),
      last_visit_at = GREATEST(COALESCE(last_visit_at, '-infinity'::timestamptz), v_when),
      satisfaction_signal = COALESCE(p_satisfaction, satisfaction_signal),
      updated_at = now()
  WHERE id = p_client_profile_id AND tenant_phone = p_tenant_phone;

  RETURN v_visit_id;
END;
$$ LANGUAGE plpgsql;

SELECT 'client_profiles + client_visits + client_photos ready' AS status;

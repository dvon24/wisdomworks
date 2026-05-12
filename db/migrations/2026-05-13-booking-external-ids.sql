-- Square Phase 2 — external IDs so we can dedup appointments across syncs
-- and map Square's customer_id → local client_profile_id.
--
-- Without these, each sync would re-insert the same visits and customer
-- updates would create duplicate profiles.
--
-- Run once in the Supabase SQL Editor.

ALTER TABLE client_profiles
  ADD COLUMN IF NOT EXISTS external_provider TEXT,
  ADD COLUMN IF NOT EXISTS external_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS client_profiles_external_id_idx
  ON client_profiles (tenant_phone, external_provider, external_id)
  WHERE external_id IS NOT NULL;

ALTER TABLE client_visits
  ADD COLUMN IF NOT EXISTS external_provider TEXT,
  ADD COLUMN IF NOT EXISTS external_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS client_visits_external_id_idx
  ON client_visits (tenant_phone, external_provider, external_id)
  WHERE external_id IS NOT NULL;

-- Extend upsert_client_profile to accept external IDs and use them as
-- the canonical match when present (more reliable than name+phone).
CREATE OR REPLACE FUNCTION upsert_client_profile(
  p_tenant_phone TEXT,
  p_display_name TEXT,
  p_phone TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_preferences JSONB DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_vertical_label TEXT DEFAULT NULL,
  p_source TEXT DEFAULT 'inferred',
  p_tags TEXT[] DEFAULT NULL,
  p_external_provider TEXT DEFAULT NULL,
  p_external_id TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  -- Prefer external-id match when both are supplied
  IF p_external_provider IS NOT NULL AND p_external_id IS NOT NULL THEN
    SELECT id INTO v_id
    FROM client_profiles
    WHERE tenant_phone = p_tenant_phone
      AND external_provider = p_external_provider
      AND external_id = p_external_id;
  END IF;

  -- Fall back to the name+phone match
  IF v_id IS NULL THEN
    SELECT id INTO v_id
    FROM client_profiles
    WHERE tenant_phone = p_tenant_phone
      AND lower(display_name) = lower(p_display_name)
      AND COALESCE(phone, '') = COALESCE(p_phone, '');
  END IF;

  IF v_id IS NOT NULL THEN
    UPDATE client_profiles
    SET preferences = COALESCE(p_preferences, preferences) || COALESCE(client_profiles.preferences, '{}'::jsonb),
        notes = COALESCE(p_notes, notes),
        phone = COALESCE(phone, p_phone),
        email = COALESCE(email, p_email),
        vertical_label = COALESCE(vertical_label, p_vertical_label),
        external_provider = COALESCE(external_provider, p_external_provider),
        external_id = COALESCE(external_id, p_external_id),
        source = CASE
          WHEN p_source = 'owner_defined' AND source <> 'owner_defined' THEN 'owner_defined'
          ELSE source
        END,
        tags = CASE
          WHEN p_tags IS NULL THEN tags
          ELSE (SELECT array_agg(DISTINCT t) FROM unnest(tags || p_tags) AS t)
        END,
        updated_at = now()
    WHERE id = v_id;
  ELSE
    INSERT INTO client_profiles (
      tenant_phone, display_name, phone, email, preferences, notes,
      vertical_label, source, tags, external_provider, external_id
    )
    VALUES (
      p_tenant_phone, p_display_name, p_phone, p_email,
      COALESCE(p_preferences, '{}'::jsonb), p_notes, p_vertical_label,
      p_source, COALESCE(p_tags, ARRAY[]::TEXT[]),
      p_external_provider, p_external_id
    )
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- Extend record_client_visit to accept external IDs for dedup. Skips
-- the visit insert if (tenant, external_provider, external_id) already
-- exists — idempotent re-sync.
CREATE OR REPLACE FUNCTION record_client_visit(
  p_tenant_phone TEXT,
  p_client_profile_id UUID,
  p_summary TEXT,
  p_channel TEXT DEFAULT NULL,
  p_satisfaction TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_revenue_usd NUMERIC DEFAULT NULL,
  p_occurred_at TIMESTAMPTZ DEFAULT NULL,
  p_external_provider TEXT DEFAULT NULL,
  p_external_id TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_visit_id UUID;
  v_when TIMESTAMPTZ;
  v_existing UUID;
BEGIN
  v_when := COALESCE(p_occurred_at, now());

  -- Dedup against an existing external_id on this tenant
  IF p_external_provider IS NOT NULL AND p_external_id IS NOT NULL THEN
    SELECT id INTO v_existing
    FROM client_visits
    WHERE tenant_phone = p_tenant_phone
      AND external_provider = p_external_provider
      AND external_id = p_external_id;
    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
  END IF;

  INSERT INTO client_visits (
    client_profile_id, tenant_phone, summary, channel, satisfaction,
    notes, revenue_usd, occurred_at, external_provider, external_id
  )
  VALUES (
    p_client_profile_id, p_tenant_phone, p_summary, p_channel, p_satisfaction,
    p_notes, p_revenue_usd, v_when, p_external_provider, p_external_id
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

SELECT 'client_profiles + client_visits external_id columns ready' AS status;

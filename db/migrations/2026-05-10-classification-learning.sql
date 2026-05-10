-- Story 2.13 — Classification Learning + QA Monitoring (full enterprise).
--
-- Two layers:
--   1. CORRECTIONS: when the user reclassifies an email (privacy or
--      action) the correction lands here. Future classifier prompts
--      pull recent corrections as few-shot examples so accuracy
--      compounds with use.
--   2. CLASSIFICATION SAMPLES: every classification gets logged with
--      enough metadata that a QA agent can periodically scan for
--      systemic drift (FR6 — pattern + edge-case detection).
--
-- Run once in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS email_classification_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_phone TEXT NOT NULL,
  -- Original (system) classification
  original_privacy_class TEXT NOT NULL,
  original_classification TEXT,
  original_confidence FLOAT,
  -- Corrected (user) classification
  corrected_privacy_class TEXT NOT NULL,
  corrected_classification TEXT,
  -- Snapshot context for few-shot example construction
  email_from TEXT,
  email_subject TEXT,
  email_preview TEXT,
  user_reason TEXT,
  -- Source of the correction: 'whatsapp', 'deck', 'cron_qa'
  source TEXT NOT NULL DEFAULT 'whatsapp',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ecc_orig_priv_check CHECK (original_privacy_class IN ('business', 'personal', 'uncertain')),
  CONSTRAINT ecc_corr_priv_check CHECK (corrected_privacy_class IN ('business', 'personal', 'uncertain')),
  CONSTRAINT ecc_source_check CHECK (source IN ('whatsapp', 'deck', 'cron_qa', 'manual'))
);

CREATE INDEX IF NOT EXISTS ecc_tenant_idx
  ON email_classification_corrections (tenant_phone, created_at DESC);
CREATE INDEX IF NOT EXISTS ecc_drift_idx
  ON email_classification_corrections (tenant_phone, original_privacy_class, corrected_privacy_class);


-- ─── Classification samples — every classification logged for QA ─────────
-- Cheap append-only log so the QA agent can scan for trends without
-- re-pulling the actual emails. PII-safe — only metadata, no body.

CREATE TABLE IF NOT EXISTS email_classification_samples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_phone TEXT NOT NULL,
  email_id TEXT NOT NULL,
  privacy_class TEXT NOT NULL,
  privacy_confidence FLOAT,
  classification TEXT,
  email_from TEXT,
  email_subject TEXT,
  has_draft BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ecs_priv_check CHECK (privacy_class IN ('business', 'personal', 'uncertain'))
);

CREATE INDEX IF NOT EXISTS ecs_tenant_idx
  ON email_classification_samples (tenant_phone, created_at DESC);
CREATE INDEX IF NOT EXISTS ecs_low_confidence_idx
  ON email_classification_samples (tenant_phone, privacy_confidence)
  WHERE privacy_confidence < 0.7;

SELECT 'classification learning + QA tables ready' AS status;

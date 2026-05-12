-- Story 2b.2 — Business Intelligence & Actionable Insights (Phase 1).
--
-- Detectors mine client_profiles + client_visits (later: scheduling +
-- revenue + reviews) and produce typed, actionable insights with
-- specific recommendations. Each insight is one row here, surfaced via
-- notification_queue → digest cron → WhatsApp + email.
--
-- Phase 1 ships ONE detector (lapsed_clients). Future phases add:
-- gap_analysis (vacancy slots), seasonality, revenue_optimization,
-- client_milestones, etc. The kind+detector pattern is open-ended.
--
-- Run once in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS business_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_phone TEXT NOT NULL,
  -- Detector key: 'lapsed_clients', 'gap_analysis', 'seasonality',
  -- 'revenue_optimization', 'client_milestone', etc. Used for dedup.
  detector TEXT NOT NULL,
  -- Severity drives surfacing — same axis as notification_queue
  severity TEXT NOT NULL DEFAULT 'medium',
  -- Short headline ("3 clients haven't booked in 60+ days")
  title TEXT NOT NULL,
  -- Detail string: what was detected, why it matters
  why TEXT,
  -- Recommended action — concrete, executable, not vague
  recommended_action TEXT,
  -- Expected impact ("re-engage 2-3 clients = ~$120-180 revenue")
  expected_impact TEXT,
  -- 0..1 confidence score; <0.6 is suggestion-only, >=0.7 surfaces
  confidence NUMERIC(3, 2) NOT NULL DEFAULT 0.7,
  -- Structured payload: lists of client_profile_ids, visit_ids, draft
  -- text the owner can approve, etc.
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Lifecycle status
  status TEXT NOT NULL DEFAULT 'proposed',
  -- Cross-link to notification_queue so we can mark insights stale when
  -- their notifications expire or get dismissed
  surfaced_in_notification_id UUID,
  -- Bookkeeping
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '14 days'),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT business_insights_severity_check CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  CONSTRAINT business_insights_status_check CHECK (status IN ('proposed', 'approved', 'dismissed', 'executed', 'expired'))
);

CREATE INDEX IF NOT EXISTS business_insights_tenant_idx
  ON business_insights (tenant_phone, status, detected_at DESC);

CREATE INDEX IF NOT EXISTS business_insights_open_idx
  ON business_insights (tenant_phone, detector) WHERE status = 'proposed';

-- Dedup: a given detector should not emit the same insight twice while
-- the previous one is still open. Detector implementations supply a
-- stable signature in metadata.signature; we enforce uniqueness on it
-- only while proposed/approved.
CREATE UNIQUE INDEX IF NOT EXISTS business_insights_signature_idx
  ON business_insights (tenant_phone, detector, (metadata->>'signature'))
  WHERE status IN ('proposed', 'approved') AND (metadata->>'signature') IS NOT NULL;

SELECT 'business_insights ready' AS status;

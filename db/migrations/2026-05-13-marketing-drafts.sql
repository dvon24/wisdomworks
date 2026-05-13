-- Marketing drafts — L3 proactive content pipeline.
--
-- The marketing-loop cron (or marketing agent on its tick) generates
-- draft reel/post concepts, stores them here, surfaces them in the
-- daily digest, and the owner approves/dismisses via WhatsApp the same
-- way they approve insights.
--
-- Each draft moves through:
--   proposed → approved (video gets generated + published)
--          → dismissed
--          → published (executed successfully)
--          → failed (publish step errored)
--
-- Run once in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS marketing_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_phone TEXT NOT NULL,
  -- Detector / source — which loop produced this draft
  -- 'cadence' (regular schedule), 'event_driven' (e.g. new booking),
  -- 'owner_requested' (owner asked Iris to draft for later)
  source TEXT NOT NULL DEFAULT 'cadence',
  -- Channel for the eventual publish
  channel TEXT NOT NULL DEFAULT 'instagram_reel',
  -- The proposed content
  topic TEXT NOT NULL,
  caption TEXT NOT NULL,
  prompt TEXT,             -- video gen prompt
  hashtags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  -- Reference to a saved style if one was used
  style_id UUID REFERENCES marketing_styles(id) ON DELETE SET NULL,
  -- Estimated cost shown to owner
  estimated_cost_usd NUMERIC(6, 2) NOT NULL DEFAULT 0,
  -- Once approved + generated, the rendered video URL lands here
  video_url TEXT,
  -- Once published, the platform post id lands here
  published_post_id TEXT,
  -- Lifecycle
  status TEXT NOT NULL DEFAULT 'proposed',
  proposed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  failure_reason TEXT,
  -- Auto-expires if the owner doesn't act within ~7 days
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days'),
  -- Trigger metadata: what observation produced this draft
  trigger_atom_ids UUID[] DEFAULT ARRAY[]::UUID[],
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT marketing_drafts_status_check CHECK (status IN ('proposed', 'approved', 'dismissed', 'published', 'failed', 'expired')),
  CONSTRAINT marketing_drafts_channel_check CHECK (channel IN ('instagram_reel', 'instagram_post', 'facebook_post', 'tiktok'))
);

CREATE INDEX IF NOT EXISTS marketing_drafts_tenant_idx
  ON marketing_drafts (tenant_phone, status, proposed_at DESC);

CREATE INDEX IF NOT EXISTS marketing_drafts_open_idx
  ON marketing_drafts (tenant_phone) WHERE status = 'proposed';

-- Tenant autonomy preferences — controls L4 (auto-publish within guardrails)
-- Stored as one row per tenant; created on first interaction.
CREATE TABLE IF NOT EXISTS marketing_autonomy_prefs (
  tenant_phone TEXT PRIMARY KEY,
  -- L1 (manual) / L2 (draft+approve, default) / L3 (propose proactively) /
  -- L4 (auto-publish within guardrails)
  autonomy_level TEXT NOT NULL DEFAULT 'L2',
  -- Max posts auto-published per day at L4
  max_auto_publish_per_day INTEGER NOT NULL DEFAULT 0,
  -- Min confidence threshold (0..1) for auto-publish at L4
  min_confidence_for_auto NUMERIC(3, 2) NOT NULL DEFAULT 0.85,
  -- Words/phrases that block auto-publish (always require owner approval)
  blocked_words TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  -- Channels owner has approved for autonomous publishing
  auto_publish_channels TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  -- Cadence: when does the L3 detector wake up
  draft_cadence_days INTEGER NOT NULL DEFAULT 7,  -- weekly default
  last_draft_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT marketing_autonomy_level_check CHECK (autonomy_level IN ('L1', 'L2', 'L3', 'L4'))
);

SELECT 'marketing_drafts + marketing_autonomy_prefs ready' AS status;

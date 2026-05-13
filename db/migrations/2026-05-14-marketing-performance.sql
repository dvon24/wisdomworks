-- Marketing performance — observability + autonomy safety net.
--
-- After a draft publishes (whether L2/L3 owner-approved or L4
-- auto-published), the marketing-perf cron snapshots IG engagement
-- every 12h for 7 days. If L4 auto-publishes underperform vs the
-- tenant's baseline, the autonomy guard auto-pauses L4 → L3 and
-- notifies the owner.
--
-- Run once in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS marketing_post_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_phone TEXT NOT NULL,
  draft_id UUID REFERENCES marketing_drafts(id) ON DELETE SET NULL,
  -- Whose post is this — IG, FB Page
  channel TEXT NOT NULL,
  -- The platform-native id we got back from publish
  platform_post_id TEXT NOT NULL,
  -- Was this auto-published (L4) or owner-approved (L2/L3)?
  auto_published BOOLEAN NOT NULL DEFAULT false,
  -- Latest snapshot
  like_count INTEGER NOT NULL DEFAULT 0,
  comments_count INTEGER NOT NULL DEFAULT 0,
  reach INTEGER,
  impressions INTEGER,
  saves INTEGER,
  -- Aggregate score we compute for "did this perform well" comparisons
  performance_score NUMERIC(6, 2),
  published_at TIMESTAMPTZ NOT NULL,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT marketing_metrics_channel_check CHECK (channel IN ('instagram_reel', 'instagram_post', 'facebook_post', 'tiktok'))
);

CREATE UNIQUE INDEX IF NOT EXISTS marketing_post_metrics_unique
  ON marketing_post_metrics (tenant_phone, platform_post_id);

CREATE INDEX IF NOT EXISTS marketing_post_metrics_tenant_idx
  ON marketing_post_metrics (tenant_phone, published_at DESC);

CREATE INDEX IF NOT EXISTS marketing_post_metrics_auto_idx
  ON marketing_post_metrics (tenant_phone, auto_published, published_at DESC)
  WHERE auto_published = true;

-- Add a marketing-autonomy cooldown tracking field on the prefs table.
-- When the autonomy guard auto-drops L4 → L3, we record the cooldown
-- window so we don't immediately bounce back.
ALTER TABLE marketing_autonomy_prefs
  ADD COLUMN IF NOT EXISTS l4_cooldown_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS l4_cooldown_reason TEXT;

SELECT 'marketing_post_metrics ready' AS status;

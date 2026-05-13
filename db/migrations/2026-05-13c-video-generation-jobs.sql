-- Video generation jobs — async pipeline for Replicate predictions.
--
-- WhatsApp webhook is capped at 60s but Replicate video gen takes
-- 30-180s. We start the prediction synchronously, store the job
-- here, and the video-job-poller cron polls Replicate every 2 min
-- and sends the preview when ready.
--
-- Lifecycle: pending → succeeded / failed / timed_out → delivered
--
-- Run once in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS video_generation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_phone TEXT NOT NULL,
  -- Replicate prediction id — the key for polling
  prediction_id TEXT NOT NULL,
  model_ref TEXT NOT NULL,
  quality TEXT NOT NULL DEFAULT 'fast',
  -- The full prompt (after style prepending)
  prompt TEXT NOT NULL,
  -- Owner-facing label / caption text we'll send with the preview
  caption TEXT,
  -- Style used (for analytics + recordStyleUsed when delivered)
  style_id UUID,
  style_name TEXT,
  estimated_cost_usd NUMERIC(6, 2) NOT NULL DEFAULT 0,
  -- Optional link to a marketing_draft this was generated from. When
  -- set, the poller updates the draft's video_url on success.
  draft_id UUID,
  -- When true AND draft_id is set, the poller will auto-publish the
  -- video to Instagram (and FB if linked) after generation completes,
  -- without waiting for owner approval. Used by L4 autonomy.
  auto_publish BOOLEAN NOT NULL DEFAULT false,
  -- Lifecycle
  status TEXT NOT NULL DEFAULT 'pending',
  video_url TEXT,
  error TEXT,
  -- Timing
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  -- Auto-fail if stuck pending > 20 min (model hung / Replicate issue)
  timeout_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '20 minutes'),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT video_jobs_status_check CHECK (status IN ('pending', 'succeeded', 'failed', 'timed_out', 'delivered'))
);

-- Lookup pending jobs fast (poller hits this every cron tick)
CREATE INDEX IF NOT EXISTS video_jobs_pending_idx
  ON video_generation_jobs (started_at DESC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS video_jobs_tenant_idx
  ON video_generation_jobs (tenant_phone, started_at DESC);

-- Dedup on prediction_id so re-inserts don't double-queue
CREATE UNIQUE INDEX IF NOT EXISTS video_jobs_prediction_unique
  ON video_generation_jobs (prediction_id);

SELECT 'video_generation_jobs ready' AS status;

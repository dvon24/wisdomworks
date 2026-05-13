-- Marketing style profiles — named templates owners use across reel
-- generations so brand voice stays consistent.
--
-- Owner: "Save this as my Au7o style: cinematic, neon, fast cuts."
-- Future: "Generate a reel about X using Au7o style" → the style
-- description gets prepended to the Replicate prompt.
--
-- Phase 2 will extend this with WhatsApp video upload + auto-analysis
-- (frame extraction → vision → style description).
--
-- Run once in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS marketing_styles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_phone TEXT NOT NULL,
  -- Owner-friendly name they'll reference: "Au7o energetic", "salon dreamy"
  name TEXT NOT NULL,
  -- Style descriptor that gets prepended to generation prompts
  style_prompt TEXT NOT NULL,
  -- Optional reference media URLs (video and/or image) the owner uploaded
  reference_video_url TEXT,
  reference_image_url TEXT,
  -- Where the style came from:
  --   'owner_defined' (Devon typed out a description)
  --   'auto_analyzed' (Phase 2: extracted from a reference video)
  --   'imported'      (Phase 3: pulled from connected platform)
  source TEXT NOT NULL DEFAULT 'owner_defined',
  -- Default generation tier when using this style
  default_quality TEXT DEFAULT 'fast',
  -- Free-form metadata
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Aggregate stats — bumped on each generation that uses this style
  use_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT marketing_styles_source_check CHECK (source IN ('owner_defined', 'auto_analyzed', 'imported')),
  CONSTRAINT marketing_styles_quality_check CHECK (default_quality IN ('fast', 'standard', 'premium'))
);

-- Unique per tenant — owners can rename if they need
CREATE UNIQUE INDEX IF NOT EXISTS marketing_styles_unique_name
  ON marketing_styles (tenant_phone, lower(name));

CREATE INDEX IF NOT EXISTS marketing_styles_tenant_idx
  ON marketing_styles (tenant_phone, last_used_at DESC NULLS LAST);

SELECT 'marketing_styles ready' AS status;

-- axis_critiques — every violation Axis catches, kept for aggregation.
--
-- Shipped 2026-05-26 alongside the Axis runtime critic (commit 63a1cb0).
-- The critic catches one violation, revises once, ships. That's
-- per-turn defense. This table is what closes the LEARNING loop:
-- repeated violations of the same rule on the same tenant are evidence
-- of a system-prompt / disposition gap, not a one-off slip. Aggregation
-- queries surface those patterns to the owner ("Iris has buried
-- questions 8x this week — want me to tighten the prompt?") OR to
-- auto-promotion logic that lifts a recurring violation into a new
-- disposition rule.
--
-- Designed lean: append-only, no updates. Indexes for the two access
-- patterns (per-tenant recent, per-rule across time).

CREATE TABLE IF NOT EXISTS axis_critiques (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_phone          TEXT NOT NULL,
  -- Which surface produced the draft Axis audited. Matches CriticSurface
  -- enum in axis-critic.ts. Constraints intentionally loose so new
  -- surfaces don't require a migration.
  surface               TEXT NOT NULL,
  rule                  TEXT NOT NULL,                         -- e.g. 'answered_owner_question'
  severity              TEXT NOT NULL CHECK (severity IN ('high', 'medium', 'low')),
  evidence              TEXT,                                  -- the offending quote from the draft
  fix                   TEXT,                                  -- critic's suggested fix
  -- Previews so a human reviewing patterns can see context without
  -- joining back to conversation history. Truncated to keep rows lean.
  source_message_preview TEXT,                                 -- owner's last message (<=400)
  draft_preview          TEXT,                                 -- the draft that violated (<=400)
  -- Whether the critic forced a revision pass. HIGH severity always
  -- triggers revision; medium/low don't. Useful for measuring whether
  -- revisions are actually fixing things.
  revision_attempted    BOOLEAN NOT NULL DEFAULT FALSE,
  -- Optional metadata: model used, tokens, surface-specific extras.
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-tenant recent — for the "what did Axis catch this week" view
-- and for the aggregation cron when it ships.
CREATE INDEX IF NOT EXISTS axis_critiques_tenant_recent_idx
  ON axis_critiques (tenant_phone, created_at DESC);

-- Per-rule across time — for "which rule fires most often platform-
-- wide" analysis. Useful when tuning rule sheets or adding new rules.
CREATE INDEX IF NOT EXISTS axis_critiques_rule_idx
  ON axis_critiques (rule, severity, created_at DESC);

-- Per-surface — for proving per-surface rule sheets are calibrated
-- correctly. If `marketing-draft` is firing 10x more violations than
-- `iris-chat`, the rule sheet is probably too strict.
CREATE INDEX IF NOT EXISTS axis_critiques_surface_idx
  ON axis_critiques (surface, created_at DESC);

SELECT 'axis_critiques ready' AS status;

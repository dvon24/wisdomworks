-- Phase 2 — Research requests (web search + competitive intelligence).
--
-- Any agent can call request_research(topic, why) to ask for outside-the-system
-- research on a topic. Iris is the designated executor — she picks up
-- pending requests on her tick, runs the search via Anthropic's web_search
-- tool, synthesizes a brief, and drops it into the approval queue.
--
-- Bounded budget: 5 searches/day per tenant (tracked via metadata, enforced
-- in code). Owner-initiated requests bypass the cap.
--
-- Run once in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS research_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_phone TEXT NOT NULL,
  -- The agent that requested the research (NULL if owner-initiated via tool)
  requesting_agent_instance_id UUID REFERENCES agent_instances(id) ON DELETE SET NULL,
  requesting_agent_name TEXT,
  -- What to research (e.g. 'getviktor.com competitive analysis', 'best practices for solo entrepreneur scheduling')
  topic TEXT NOT NULL,
  -- Why — gives the executor and the owner context
  reason TEXT,
  -- 'competitor_analysis' | 'market_research' | 'best_practices' | 'fact_check' | 'general'
  kind TEXT NOT NULL DEFAULT 'general',
  -- Lifecycle: pending -> in_progress -> completed | failed | declined
  status TEXT NOT NULL DEFAULT 'pending',
  -- Synthesized output, written when status='completed'
  result_summary TEXT,
  result_brief JSONB,
  -- Where the brief surfaced (notification_queue id, if applicable)
  surfaced_in_notification_id UUID,
  -- Cost tracking
  searches_used INTEGER NOT NULL DEFAULT 0,
  tokens_used INTEGER NOT NULL DEFAULT 0,
  -- Owner-initiated bypasses the daily search cap
  owner_initiated BOOLEAN NOT NULL DEFAULT false,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT research_requests_status_check CHECK (
    status IN ('pending', 'in_progress', 'completed', 'failed', 'declined')
  ),
  CONSTRAINT research_requests_kind_check CHECK (
    kind IN ('competitor_analysis', 'market_research', 'best_practices', 'fact_check', 'general')
  )
);

CREATE INDEX IF NOT EXISTS research_requests_pending_idx
  ON research_requests (tenant_phone, status, created_at)
  WHERE status IN ('pending', 'in_progress');

CREATE INDEX IF NOT EXISTS research_requests_tenant_idx
  ON research_requests (tenant_phone, created_at DESC);


-- ─── searches_today RPC ────────────────────────────────────────────────────
-- Counts agent-initiated searches today (excludes owner_initiated which
-- bypasses the cap). Used by request_research to enforce the daily limit.
CREATE OR REPLACE FUNCTION searches_today(p_tenant_phone TEXT)
RETURNS INTEGER
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(searches_used), 0)::integer
  FROM research_requests
  WHERE tenant_phone = p_tenant_phone
    AND created_at >= date_trunc('day', now())
    AND owner_initiated = false;
$$;

SELECT 'research_requests + searches_today ready' AS status;

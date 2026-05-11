-- Multi-project orchestration — Au7o proof of concept.
--
-- A tenant can have multiple PROJECTS (their own business + side projects,
-- or in the future, customers will arrive with existing sites). Each
-- project gets connected to a specific agent via project_connections.
-- The assigned agent investigates the project on its ticks and (eventually)
-- proposes/executes changes.
--
-- Provider-aware from day one: vercel-github is the deepest tier, but the
-- same table will hold wix/wordpress/webflow/shopify/advisory connections
-- when those adapters land. Different providers = different capabilities
-- but the same shape.
--
-- project_snapshots is the periodic dump of project state (deployments,
-- recent commits, issues, README). The cron refreshes hourly. Snapshots
-- are immutable history — the latest is what gets injected into the
-- agent's tick prompt; older ones support audit + change detection.
--
-- Run once in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS project_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_phone TEXT NOT NULL,
  -- The agent assigned to manage this project (e.g. Alex for Au7o)
  agent_config_id UUID REFERENCES agent_configs(id) ON DELETE SET NULL,
  -- Human-readable project name (e.g. "Au7o", "Acme client site")
  project_name TEXT NOT NULL,
  -- Provider tier:
  --   'vercel-github' = Tier 1 (full management — deploys, commits, issues, code)
  --   'wix' / 'wordpress' / 'webflow' / 'shopify' = Tier 2 (content management)
  --   'advisory' = Tier 3 (analytics + recommendations only)
  provider TEXT NOT NULL,
  -- Capability tier (1 = full management, 2 = content, 3 = advisory)
  capability_tier INTEGER NOT NULL DEFAULT 1,
  -- Credentials are encrypted at write (token, project ids, repo owner/name, etc.).
  -- Shape varies by provider — see adapter code in project-sync.ts.
  credentials JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Public-facing metadata (deploy URL, repo URL, etc.) — safe to surface in UI.
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'active',
  last_synced_at TIMESTAMPTZ,
  last_sync_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT project_connections_provider_check CHECK (
    provider IN ('vercel-github', 'wix', 'wordpress', 'webflow', 'shopify', 'advisory')
  ),
  CONSTRAINT project_connections_tier_check CHECK (
    capability_tier BETWEEN 1 AND 3
  ),
  CONSTRAINT project_connections_status_check CHECK (
    status IN ('active', 'paused', 'error', 'disconnected')
  ),
  -- One agent per (tenant, project_name) — re-connecting the same project
  -- to the same agent just updates the row.
  UNIQUE (tenant_phone, project_name)
);

CREATE INDEX IF NOT EXISTS project_connections_tenant_idx
  ON project_connections (tenant_phone, status);
CREATE INDEX IF NOT EXISTS project_connections_agent_idx
  ON project_connections (agent_config_id) WHERE status = 'active';


CREATE TABLE IF NOT EXISTS project_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_connection_id UUID NOT NULL REFERENCES project_connections(id) ON DELETE CASCADE,
  tenant_phone TEXT NOT NULL,
  -- The "shape" depends on provider. For vercel-github:
  --   { deployments: [...], commits: [...], issues: [...], pull_requests: [...],
  --     readme: "...", deploy_url: "...", build_status: "...", recent_errors: [...] }
  snapshot_data JSONB NOT NULL,
  -- Brief 1-3 sentence summary the agent can read quickly (cheap to render in prompt)
  summary TEXT,
  -- What changed vs the previous snapshot (helps the agent notice change)
  diff_summary TEXT,
  taken_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_snapshots_connection_idx
  ON project_snapshots (project_connection_id, taken_at DESC);
CREATE INDEX IF NOT EXISTS project_snapshots_tenant_idx
  ON project_snapshots (tenant_phone, taken_at DESC);


-- ─── latest_project_snapshot ───────────────────────────────────────────────
-- Get the most recent snapshot for a given project_connection. Used by the
-- agent runtime to inject the project state into the tick prompt.

CREATE OR REPLACE FUNCTION latest_project_snapshot(p_connection_id UUID)
RETURNS TABLE (
  id UUID,
  snapshot_data JSONB,
  summary TEXT,
  diff_summary TEXT,
  taken_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
  SELECT id, snapshot_data, summary, diff_summary, taken_at
  FROM project_snapshots
  WHERE project_connection_id = p_connection_id
  ORDER BY taken_at DESC
  LIMIT 1;
$$;


-- ─── connections_for_agent ─────────────────────────────────────────────────
-- All active project connections assigned to a specific agent. The tick
-- runtime calls this when building the agent's context — usually 0 or 1,
-- but an agent could in theory manage multiple projects.

CREATE OR REPLACE FUNCTION connections_for_agent(p_agent_config_id UUID)
RETURNS TABLE (
  id UUID,
  project_name TEXT,
  provider TEXT,
  capability_tier INTEGER,
  metadata JSONB,
  latest_summary TEXT,
  latest_diff TEXT,
  latest_taken_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    pc.id,
    pc.project_name,
    pc.provider,
    pc.capability_tier,
    pc.metadata,
    (SELECT summary FROM project_snapshots WHERE project_connection_id = pc.id ORDER BY taken_at DESC LIMIT 1) AS latest_summary,
    (SELECT diff_summary FROM project_snapshots WHERE project_connection_id = pc.id ORDER BY taken_at DESC LIMIT 1) AS latest_diff,
    (SELECT taken_at FROM project_snapshots WHERE project_connection_id = pc.id ORDER BY taken_at DESC LIMIT 1) AS latest_taken_at
  FROM project_connections pc
  WHERE pc.agent_config_id = p_agent_config_id
    AND pc.status = 'active';
$$;

SELECT 'project_connections + project_snapshots + RPCs ready' AS status;

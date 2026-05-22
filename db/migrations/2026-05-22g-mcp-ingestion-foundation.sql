-- MCP ingestion foundation — catalog of known MCP servers + per-tenant
-- enablement records. Tonight's ship is the DATA LAYER only: owners can
-- browse the catalog, enable a server, and the capability audit reflects
-- it. Actual tool DISCOVERY and EXECUTION via the MCP client is the
-- next-session piece.
--
-- Two tables:
--   • mcp_server_catalog (global) — the dictionary of MCP servers the
--     platform knows about. Each entry declares which canonical
--     capabilities the server provides (so the audit can resolve them)
--     and what auth config the server needs.
--   • tenant_mcp_servers (per-tenant) — which servers a given tenant has
--     enabled + their per-tenant credentials. Status tracks runtime state.
--
-- Why two tables: every tenant should pick from the SAME well-known set
-- of servers (security, support, vetting). The catalog is admin-curated.
-- Adding new MCP servers later is a SQL migration, not a per-tenant
-- write — same architecture as agent_role_catalog.

CREATE TABLE IF NOT EXISTS mcp_server_catalog (
  server_slug      TEXT PRIMARY KEY,                    -- 'github', 'vercel', 'linear', etc.
  display_name     TEXT NOT NULL,                       -- 'GitHub'
  description      TEXT NOT NULL,                       -- one-liner shown in chat
  category         TEXT NOT NULL,                       -- 'engineering' | 'finance' | 'health' | 'productivity' | etc.
  transport        TEXT NOT NULL CHECK (transport IN ('http', 'stdio', 'sse')),
                                                       -- serverless only supports http/sse; stdio recorded for future
  default_url      TEXT,                                -- HTTPS endpoint for HTTP/SSE transport
  auth_kind        TEXT NOT NULL CHECK (auth_kind IN ('none', 'oauth', 'api-token', 'personal-access-token')),
  auth_setup_hint  TEXT,                                -- how the owner gets the token (e.g. "GitHub → Settings → Developer settings → PATs")
  capability_slugs JSONB NOT NULL DEFAULT '[]'::jsonb,  -- which canonical capabilities this server satisfies
  example_tools    JSONB NOT NULL DEFAULT '[]'::jsonb,  -- representative tool names (informational only)
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tenant_mcp_servers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_phone     TEXT NOT NULL,
  server_slug      TEXT NOT NULL REFERENCES mcp_server_catalog(server_slug) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'enabled'
                     CHECK (status IN ('enabled', 'disabled', 'error', 'revoked')),
  -- Auth config (encrypted at rest by Supabase; not exposed to clients).
  -- For api-token / PAT: { token: '...' }
  -- For oauth: { access_token, refresh_token, expires_at }
  auth_config      JSONB,
  last_error       TEXT,
  enabled_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_phone, server_slug)
);

CREATE INDEX IF NOT EXISTS tenant_mcp_servers_tenant_idx
  ON tenant_mcp_servers (tenant_phone)
  WHERE status = 'enabled';

CREATE INDEX IF NOT EXISTS tenant_mcp_servers_slug_idx
  ON tenant_mcp_servers (server_slug, status);

-- ─── Seed the catalog with 8 well-known MCP servers ────────────────────────
-- Each entry targets one or more canonical capabilities from agent_role_catalog.
-- All HTTP transport (serverless-compatible). Self-hosted MCP servers can be
-- added later via additional rows.
--
-- NOTE: default_url values reference COMMUNITY SERVER endpoints. In production
-- each tenant would either point at a self-hosted instance or a managed
-- relay. URLs are placeholders that point at the canonical project sites
-- for now — actual MCP endpoints get wired in the next-session execution work.

INSERT INTO mcp_server_catalog (server_slug, display_name, description, category, transport, default_url, auth_kind, auth_setup_hint, capability_slugs, example_tools) VALUES

('github',
  'GitHub',
  'Repository access, commits, pull requests, issues, deploys. Powers version-control + code-review workflows for web-developer, ux-designer, and project-manager roles.',
  'engineering',
  'http',
  'https://api.github.com/mcp',
  'personal-access-token',
  'GitHub → Settings → Developer settings → Personal access tokens. Scopes needed: repo, read:org, read:project.',
  '["version-control"]'::jsonb,
  '["list_repos", "get_pr", "list_commits", "get_issue", "create_issue_comment"]'::jsonb),

('vercel',
  'Vercel',
  'Deployment monitoring, build status, deployment logs. Critical for web-developer agents shipping production code.',
  'engineering',
  'http',
  'https://api.vercel.com/mcp',
  'api-token',
  'Vercel → Account Settings → Tokens. Create a token scoped to your team/project.',
  '["deployments"]'::jsonb,
  '["list_deployments", "get_deployment_status", "get_build_logs"]'::jsonb),

('linear',
  'Linear',
  'Issue tracking, project management, sprint cycles. Powers project-mgmt for project-manager + freelancer-pm roles.',
  'engineering',
  'http',
  'https://api.linear.app/mcp',
  'api-token',
  'Linear → Settings → API → Personal API keys.',
  '["project-mgmt"]'::jsonb,
  '["list_issues", "create_issue", "list_projects", "update_issue_status"]'::jsonb),

('sentry',
  'Sentry',
  'Error tracking, stack traces, deploy regressions. Powers error-triage for web-developer agents.',
  'engineering',
  'http',
  'https://sentry.io/api/mcp',
  'api-token',
  'Sentry → User Settings → API → Auth Tokens. Scopes: project:read, event:read.',
  '["error-tracking"]'::jsonb,
  '["list_recent_errors", "get_error_detail", "list_projects"]'::jsonb),

('stripe',
  'Stripe',
  'Payment processing, customer records, subscription state. Augments first-party Stripe OAuth with broader MCP capabilities.',
  'finance',
  'http',
  'https://api.stripe.com/mcp',
  'api-token',
  'Stripe Dashboard → Developers → API keys → Restricted key (read-only recommended).',
  '["payments"]'::jsonb,
  '["list_recent_charges", "get_customer", "list_subscriptions"]'::jsonb),

('apple-health',
  'Apple Health',
  'Fitness tracker, workouts, sleep, heart rate. Powers fitness-tracker for personal-trainer, sleep-coach, fitness-logger roles.',
  'health',
  'http',
  'https://health.apple.com/mcp',
  'oauth',
  'iCloud → Privacy → Health Data Sharing → enable MCP connector. (Coming with Apple''s MCP rollout.)',
  '["fitness-tracker"]'::jsonb,
  '["get_recent_workouts", "get_sleep_data", "get_daily_activity"]'::jsonb),

('notion',
  'Notion',
  'Documents, databases, project pages. Useful for writer, editor, consultant roles that work out of Notion.',
  'productivity',
  'http',
  'https://api.notion.com/mcp',
  'api-token',
  'Notion → Settings & Members → Connections → Develop or manage integrations → create new integration.',
  '["drive"]'::jsonb,
  '["search_pages", "get_page", "create_page", "update_page"]'::jsonb),

('claude-code',
  'Claude Code',
  'AI pair-programming, code review, codebase analysis. Powers web-developer agents that need to suggest or review code changes.',
  'engineering',
  'http',
  'https://api.anthropic.com/v1/mcp/claude-code',
  'api-token',
  'Anthropic Console → API Keys. Use a workspace-scoped key.',
  '["claude-code"]'::jsonb,
  '["review_diff", "suggest_change", "search_codebase"]'::jsonb);

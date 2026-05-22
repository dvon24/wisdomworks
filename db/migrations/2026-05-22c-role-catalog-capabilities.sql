-- Service capability requirements per canonical role.
--
-- Devon's framing: "if a user wants an agent they don't want to have to
-- guess whether it can do the job they asked it to be added to do." So
-- each role declares the service capabilities it needs to actually
-- function. At provisioning, the audit_connections_for_role helper joins
-- this against the tenant's oauth_connections (and future
-- tenant_mcp_servers) and surfaces "ready / blocked on X / optional
-- missing" to the owner BEFORE they finish adding the agent.
--
-- Capabilities are semantic slugs (not specific provider names) so that
-- either of equivalent providers satisfies the requirement:
--   • "email"      → google email OR microsoft email OR yahoo OR imap
--   • "calendar"   → google calendar OR microsoft calendar OR apple
--   • "accounting" → quickbooks (and any future accounting integrations)
--   • "payments"   → stripe (and any future payment processors)
--   • "instagram"  → meta/instagram OAuth
--   • "deployments"→ requires MCP (vercel-mcp, etc.) — flagged as MCP-only
--                    until MCP ingestion ships
--
-- Adding a new capability later is a code change in the resolver
-- (role-catalog.ts CAPABILITY_RESOLVERS) plus optional new role rows
-- referencing it.

ALTER TABLE agent_role_catalog
  ADD COLUMN IF NOT EXISTS required_capabilities JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE agent_role_catalog
  ADD COLUMN IF NOT EXISTS optional_capabilities JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ─── Seed capability requirements for the 10 existing roles ────────────────
-- These reflect what a real agent of each role actually needs to do useful
-- work. "Required" = without this capability the role's core workflows are
-- broken. "Optional" = nice-to-have for richer routines.

UPDATE agent_role_catalog SET
  required_capabilities = '["email", "accounting"]'::jsonb,
  optional_capabilities = '["payments", "sheets", "drive"]'::jsonb
WHERE role_slug = 'financial-advisor';

UPDATE agent_role_catalog SET
  required_capabilities = '["email"]'::jsonb,
  optional_capabilities = '["accounting", "sheets", "drive", "calendar"]'::jsonb
WHERE role_slug = 'operations-manager';

UPDATE agent_role_catalog SET
  required_capabilities = '["calendar"]'::jsonb,
  optional_capabilities = '["email", "booking"]'::jsonb
WHERE role_slug = 'scheduler';

UPDATE agent_role_catalog SET
  required_capabilities = '[]'::jsonb,
  optional_capabilities = '["version-control", "deployments", "error-tracking", "project-mgmt", "claude-code"]'::jsonb
WHERE role_slug = 'web-developer';

UPDATE agent_role_catalog SET
  required_capabilities = '["email"]'::jsonb,
  optional_capabilities = '["calendar", "drive"]'::jsonb
WHERE role_slug = 'personal-assistant';

UPDATE agent_role_catalog SET
  required_capabilities = '[]'::jsonb,
  optional_capabilities = '[]'::jsonb
WHERE role_slug = 'runtime-auditor';

UPDATE agent_role_catalog SET
  required_capabilities = '["instagram"]'::jsonb,
  optional_capabilities = '["analytics", "search-console", "drive"]'::jsonb
WHERE role_slug = 'marketing-manager';

UPDATE agent_role_catalog SET
  required_capabilities = '["email"]'::jsonb,
  optional_capabilities = '["calendar"]'::jsonb
WHERE role_slug = 'customer-service';

UPDATE agent_role_catalog SET
  required_capabilities = '["email"]'::jsonb,
  optional_capabilities = '["calendar", "booking"]'::jsonb
WHERE role_slug = 'recruiter';

UPDATE agent_role_catalog SET
  required_capabilities = '[]'::jsonb,
  optional_capabilities = '["drive", "claude-code"]'::jsonb
WHERE role_slug = 'ux-designer';

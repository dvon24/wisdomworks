-- Agent role catalog — the canonical "dictionary" of agent roles the
-- platform supports. Owners pick FROM this catalog at provisioning; they
-- can rename the display ("call him Marcus" instead of "Mira") but the
-- underlying canonical role is locked. That eliminates free-text-to-slug
-- guessing entirely: every agent has exactly one canonical_role_slug
-- chosen from a known set.
--
-- This connects three architectural threads:
--   • project_agent_catalog.md (Story 2.17 — browseable catalog)
--   • project_workflow_templates.md (templates per canonical role)
--   • project_mcp_ingestion.md (default tools per canonical role)
--
-- A web developer is a web developer regardless of which project they
-- work on. Marcus the WisdomWorks Operations Manager and Connor the
-- Au7o Operations Manager are two display-different instances of the
-- same canonical role with the same templates + default tools.

CREATE TABLE IF NOT EXISTS agent_role_catalog (
  role_slug       TEXT PRIMARY KEY,                  -- canonical identifier ('financial-advisor', 'operations-manager', etc.)
  display_default TEXT NOT NULL,                     -- suggested display name when an owner provisions this role
  category        TEXT NOT NULL,                     -- 'finance' | 'ops' | 'engineering' | 'people' | 'marketing' | 'meta'
  description     TEXT NOT NULL,                     -- 1-2 sentence summary of what this agent does
  default_tools   JSONB NOT NULL DEFAULT '[]'::jsonb,-- array of tool name patterns the agent typically uses
  system_prompt_fragment TEXT,                       -- role-specific behavioral hints injected into prompts (reserved for future)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-agent canonical role + display name. The free-text agent_role
-- column stays for backward compat / UI flavor but doesn't drive logic.
ALTER TABLE agent_configs
  ADD COLUMN IF NOT EXISTS canonical_role_slug TEXT
    REFERENCES agent_role_catalog(role_slug) ON DELETE SET NULL;

ALTER TABLE agent_configs
  ADD COLUMN IF NOT EXISTS display_name TEXT;

CREATE INDEX IF NOT EXISTS agent_configs_canonical_role_idx
  ON agent_configs (canonical_role_slug)
  WHERE canonical_role_slug IS NOT NULL;

-- ─── Seed the canonical catalog ────────────────────────────────────────────
-- 10 starter roles covering the most common shapes for small-business +
-- platform-team scenarios. New roles can be inserted later without code
-- changes (templates + tools attach via the role_slug FK).

INSERT INTO agent_role_catalog (role_slug, display_default, category, description, default_tools) VALUES
('financial-advisor',
  'Mira',
  'finance',
  'Manages personal + business finances — P&L, AR, burn rate, expense categorization. Handles money-in, money-out, and reporting cadence.',
  '["get_my_spend", "get_spend_breakdown", "qbo_outstanding_ar", "qbo_list_unpaid_invoices", "qbo_create_invoice", "create_payment_link", "list_recent_payments"]'::jsonb),
('operations-manager',
  'Marcus',
  'ops',
  'Runs day-to-day business operations — financial health, customer ops, supplier relations, internal coordination. Adjacent to finance but broader.',
  '["get_spend_breakdown", "qbo_list_unpaid_invoices", "get_project_status", "list_open_tasks", "create_document"]'::jsonb),
('scheduler',
  'Riley',
  'ops',
  'Handles calendar coordination, appointment bookings, conflict resolution, and meeting logistics across the team.',
  '["list_calendar_events", "find_calendar_conflicts", "create_calendar_event", "find_booking_availability", "book_appointment", "list_my_schedule"]'::jsonb),
('web-developer',
  'Alex',
  'engineering',
  'Web/software development for a specific project — commits, deploys, build monitoring, technical research, error triage.',
  '["get_project_status", "list_all_projects", "list_pending_research", "request_research"]'::jsonb),
('personal-assistant',
  'Iris',
  'meta',
  'Orchestrator — the owner''s primary interface. Routes work to other agents, coordinates handoffs, manages context across the team.',
  '["list_my_team", "list_workflows", "list_unread_emails", "list_open_tasks", "draft_email"]'::jsonb),
('runtime-auditor',
  'Axis',
  'meta',
  'Monitors team health and runtime state — flags drift, surfaces failing agents, audits team configuration. Runs continuously in the background.',
  '["check_agent_health", "audit_team", "list_my_team"]'::jsonb),
('marketing-manager',
  'Luna',
  'marketing',
  'Owns brand voice, content calendar, social posting, engagement tracking. Drafts and proposes; the owner approves.',
  '["instagram_recent_activity", "publish_instagram_post", "publish_facebook_post", "propose_marketing_draft", "list_marketing_drafts", "marketing_performance_summary"]'::jsonb),
('customer-service',
  'Nora',
  'people',
  'Handles inbound customer communication — questions, complaints, follow-ups, basic triage before escalating to the owner.',
  '["list_unread_emails", "search_emails", "draft_email", "send_email"]'::jsonb),
('recruiter',
  'Sage',
  'people',
  'Screens candidate emails, manages interview logistics, tracks the hiring pipeline. Drafts initial outreach + scheduling.',
  '["list_unread_emails", "search_emails", "find_booking_availability", "draft_email", "list_known_people"]'::jsonb),
('ux-designer',
  'Sally',
  'engineering',
  'Design partner for product decisions — wireframes, user flows, usability reviews. Pairs with web-developer agents on shipping.',
  '["create_document", "list_pending_research", "request_research"]'::jsonb);

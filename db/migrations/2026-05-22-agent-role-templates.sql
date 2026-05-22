-- Role-scoped workflow templates — canonical day-1 routines per agent role.
--
-- When the owner provisions an agent (Marcus, Mira, Riley, Alex, etc.),
-- the seed_role_templates helper copies the matching role templates into
-- user_workflows as pending_approval rows. Owner sees them in the next
-- Iris response and bulk-approves with "approve all" or picks specific
-- ones.
--
-- This is what makes "add an agent" feel like "hire an employee" instead
-- of "instantiate a class." The agent ships with day-1 routines that the
-- owner just needs to approve.
--
-- Templates are shared across tenants (no tenant_phone column) — every
-- new Marcus on the platform gets the same starter set. Per-tenant
-- customization happens through Iris's standard create_workflow /
-- update / pause / delete tools after provisioning.

CREATE TABLE IF NOT EXISTS agent_role_templates (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_slug    TEXT NOT NULL,                       -- lowercased role match key (e.g. 'financial-advisor', 'scheduler', 'au7o-dev')
  name_suffix  TEXT NOT NULL,                       -- the unique part of the workflow name (e.g. 'daily-pnl-brief')
                                                    -- final name is "<agent_name_lower>-<name_suffix>"
  description  TEXT NOT NULL,
  cron_expr    TEXT,                                -- 5-field cron, or NULL for on-demand-only templates
  steps        JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- A short label categorizing the workflow purpose (helps the owner
  -- understand the bundle when Iris lists them after provisioning).
  category     TEXT,                                -- 'summary' | 'monitoring' | 'followup' | 'briefing'
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (role_slug, name_suffix)
);

CREATE INDEX IF NOT EXISTS agent_role_templates_role_idx
  ON agent_role_templates (role_slug);

-- ─── Seed canonical templates ───────────────────────────────────────────────
-- These templates use ONLY tools that exist in the catalog as of 2026-05-22.
-- Adding a new template? Verify the tool name exists in agent-tools.ts first
-- or the seeded workflow will fail at execution.

-- FINANCIAL ADVISOR (Marcus's role)
INSERT INTO agent_role_templates (role_slug, name_suffix, description, cron_expr, steps, category) VALUES
('financial-advisor', 'daily-pnl-brief',
  'Pull current-month spend breakdown and email a PDF summary every morning.',
  '0 7 * * *',
  '[
    { "agent": "{{agent_name}}", "tool": "get_spend_breakdown", "args": {} },
    { "agent": "{{agent_name}}", "tool": "create_document", "args": { "format": "pdf", "filename": "daily-pnl", "title": "Daily P&L Brief", "content": "{previous}" } },
    { "tool": "send_email", "args": { "subject": "Daily P&L brief", "body": "Your daily spend summary is attached.", "attachments": [{ "url": "{previous.storage_url}", "filename": "{previous.safeName}" }] } }
  ]'::jsonb,
  'briefing'),
('financial-advisor', 'weekly-pnl-brief',
  'Last-week P&L summary delivered as a PDF every Monday at 8am UTC.',
  '0 8 * * 1',
  '[
    { "agent": "{{agent_name}}", "tool": "get_spend_breakdown", "args": {} },
    { "agent": "{{agent_name}}", "tool": "create_document", "args": { "format": "pdf", "filename": "weekly-pnl", "title": "Weekly P&L Brief", "content": "{previous}" } },
    { "tool": "send_email", "args": { "subject": "Weekly P&L brief", "body": "Your weekly P&L summary is attached.", "attachments": [{ "url": "{previous.storage_url}", "filename": "{previous.safeName}" }] } }
  ]'::jsonb,
  'briefing'),
('financial-advisor', 'unpaid-invoice-scan',
  'Check QuickBooks for unpaid invoices and alert the owner if any are overdue.',
  '0 9 * * 1,3,5',
  '[
    { "agent": "{{agent_name}}", "tool": "qbo_list_unpaid_invoices", "args": {} }
  ]'::jsonb,
  'monitoring'),
('financial-advisor', 'monthly-burn-report',
  'Full-month spend breakdown delivered the first of every month.',
  '0 9 1 * *',
  '[
    { "agent": "{{agent_name}}", "tool": "get_spend_breakdown", "args": {} },
    { "agent": "{{agent_name}}", "tool": "create_document", "args": { "format": "pdf", "filename": "monthly-burn", "title": "Monthly Burn Report", "content": "{previous}" } },
    { "tool": "send_email", "args": { "subject": "Monthly burn report", "body": "Your monthly burn report is attached.", "attachments": [{ "url": "{previous.storage_url}", "filename": "{previous.safeName}" }] } }
  ]'::jsonb,
  'briefing');

-- FINANCE (Mira — personal-finance leaning)
INSERT INTO agent_role_templates (role_slug, name_suffix, description, cron_expr, steps, category) VALUES
('finance', 'weekly-spend-summary',
  'Weekly personal-finance summary delivered every Sunday evening.',
  '0 18 * * 0',
  '[
    { "agent": "{{agent_name}}", "tool": "get_my_spend", "args": {} }
  ]'::jsonb,
  'briefing'),
('finance', 'overdue-payment-scan',
  'Scan QuickBooks AR every weekday at 10am for overdue customer balances.',
  '0 10 * * 1-5',
  '[
    { "agent": "{{agent_name}}", "tool": "qbo_outstanding_ar", "args": {} }
  ]'::jsonb,
  'monitoring');

-- SCHEDULER / EXECUTIVE COORDINATOR (Riley's role)
INSERT INTO agent_role_templates (role_slug, name_suffix, description, cron_expr, steps, category) VALUES
('scheduler', 'morning-schedule-brief',
  'Pull today''s calendar events and surface anything needing attention.',
  '0 7 * * 1-5',
  '[
    { "agent": "{{agent_name}}", "tool": "list_calendar_events", "args": {} }
  ]'::jsonb,
  'briefing'),
('scheduler', 'conflict-check',
  'Scan upcoming calendar for double-bookings and overlapping events.',
  '0 8,13,17 * * 1-5',
  '[
    { "agent": "{{agent_name}}", "tool": "find_calendar_conflicts", "args": {} }
  ]'::jsonb,
  'monitoring'),
('scheduler', 'pending-followups-sweep',
  'Daily check of pending follow-ups awaiting owner approval.',
  '30 8 * * *',
  '[
    { "agent": "{{agent_name}}", "tool": "list_pending_followups", "args": {} }
  ]'::jsonb,
  'monitoring');

-- AU7O DEV (Alex's role) — project-status monitoring
INSERT INTO agent_role_templates (role_slug, name_suffix, description, cron_expr, steps, category) VALUES
('au7o-dev', 'project-status-check',
  'Daily snapshot of Au7o project status — commits, deploys, build state.',
  '0 9 * * *',
  '[
    { "agent": "{{agent_name}}", "tool": "get_project_status", "args": { "projectName": "Au7o" } }
  ]'::jsonb,
  'monitoring'),
('au7o-dev', 'open-research-tasks',
  'Surface any pending research requests so they don''t pile up.',
  '0 15 * * 1-5',
  '[
    { "agent": "{{agent_name}}", "tool": "list_pending_research", "args": {} }
  ]'::jsonb,
  'monitoring');

-- ORCHESTRATOR (Iris herself / Personal Assistant role) — meta workflows
INSERT INTO agent_role_templates (role_slug, name_suffix, description, cron_expr, steps, category) VALUES
('personal-assistant', 'morning-inbox-sweep',
  'Daily morning check of unread emails so nothing slips through.',
  '30 7 * * *',
  '[
    { "agent": "{{agent_name}}", "tool": "list_unread_emails", "args": {} }
  ]'::jsonb,
  'briefing'),
('personal-assistant', 'open-tasks-rollup',
  'Sweep open tasks from the ontology so the owner sees what''s still on the plate.',
  '0 17 * * 1-5',
  '[
    { "agent": "{{agent_name}}", "tool": "list_open_tasks", "args": {} }
  ]'::jsonb,
  'briefing');

-- RUNTIME AUDITOR (Axis's role)
INSERT INTO agent_role_templates (role_slug, name_suffix, description, cron_expr, steps, category) VALUES
('runtime-auditor', 'daily-team-health',
  'Daily health-check of every agent — surfaces failing, idle, or never-ran agents.',
  '0 6 * * *',
  '[
    { "agent": "{{agent_name}}", "tool": "check_agent_health", "args": {} }
  ]'::jsonb,
  'monitoring'),
('runtime-auditor', 'weekly-team-audit',
  'Full team audit every Sunday — counts agents across all storage locations.',
  '0 7 * * 0',
  '[
    { "agent": "{{agent_name}}", "tool": "audit_team", "args": {} }
  ]'::jsonb,
  'monitoring');

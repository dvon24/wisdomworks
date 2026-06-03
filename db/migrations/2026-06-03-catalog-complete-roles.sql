-- 2026-06-03 — Complete the agent library so GET /api/admin/catalog-audit
-- returns 200: un-mute the 6 roles the catalog-integrity audit flagged and
-- resolve the 2 orphan template slugs. After this, every catalog role ships
-- with >=1 day-1 routine that uses ONLY tools verified to exist in
-- agent-tools.ts (per the seed-file rule — a bad tool name fails at execution).

-- 1. Reassign orphan template slugs to their catalog homes (owner decisions,
--    2026-06-03): au7o-dev IS the web-developer role; finance folds into
--    financial-advisor. Idempotent — a re-run matches nothing. Reassigning
--    au7o-dev's templates also un-mutes web-developer (it had zero of its own).
UPDATE agent_role_templates SET role_slug = 'web-developer'     WHERE role_slug = 'au7o-dev';
UPDATE agent_role_templates SET role_slug = 'financial-advisor' WHERE role_slug = 'finance';

-- 2. Author day-1 routines for the 5 still-mute roles. Read/monitoring tools
--    only (no required args, no side effects), each drawn from that role's own
--    default_tools and present in the existing proven-good template set. All
--    land as pending_approval at provision time; the owner approves before any
--    fire. ON CONFLICT keeps this idempotent.
INSERT INTO agent_role_templates (role_slug, name_suffix, description, cron_expr, steps, category) VALUES
-- CUSTOMER SERVICE
('customer-service', 'morning-inbox-triage',
  'Surface customer emails awaiting a reply each weekday morning.',
  '0 8 * * 1-5',
  '[{ "agent": "{{agent_name}}", "tool": "list_unread_emails", "args": {} }]'::jsonb,
  'monitoring'),
('customer-service', 'afternoon-inbox-sweep',
  'Second inbox pass mid-afternoon so nothing waits overnight.',
  '0 15 * * 1-5',
  '[{ "agent": "{{agent_name}}", "tool": "list_unread_emails", "args": {} }]'::jsonb,
  'monitoring'),
-- MARKETING MANAGER
('marketing-manager', 'engagement-check',
  'Review recent Instagram engagement twice a week.',
  '0 10 * * 1,4',
  '[{ "agent": "{{agent_name}}", "tool": "instagram_recent_activity", "args": {} }]'::jsonb,
  'monitoring'),
('marketing-manager', 'draft-queue-review',
  'Surface marketing drafts awaiting the owner''s approval each weekday.',
  '0 9 * * 1-5',
  '[{ "agent": "{{agent_name}}", "tool": "list_marketing_drafts", "args": {} }]'::jsonb,
  'monitoring'),
('marketing-manager', 'weekly-performance-recap',
  'Friday recap of the week''s marketing performance.',
  '0 17 * * 5',
  '[{ "agent": "{{agent_name}}", "tool": "marketing_performance_summary", "args": {} }]'::jsonb,
  'briefing'),
-- OPERATIONS MANAGER
('operations-manager', 'open-tasks-sweep',
  'Daily sweep of open operational tasks needing attention.',
  '0 8 * * 1-5',
  '[{ "agent": "{{agent_name}}", "tool": "list_open_tasks", "args": {} }]'::jsonb,
  'monitoring'),
('operations-manager', 'weekly-project-status',
  'Monday brief on the status of active projects.',
  '0 8 * * 1',
  '[{ "agent": "{{agent_name}}", "tool": "get_project_status", "args": {} }]'::jsonb,
  'briefing'),
('operations-manager', 'unpaid-invoice-watch',
  'Check for unpaid invoices three times a week.',
  '0 9 * * 1,3,5',
  '[{ "agent": "{{agent_name}}", "tool": "qbo_list_unpaid_invoices", "args": {} }]'::jsonb,
  'monitoring'),
-- RECRUITER
('recruiter', 'candidate-inbox-triage',
  'Surface candidate replies awaiting a response each weekday morning.',
  '0 9 * * 1-5',
  '[{ "agent": "{{agent_name}}", "tool": "list_unread_emails", "args": {} }]'::jsonb,
  'monitoring'),
('recruiter', 'weekly-talent-pool-review',
  'Monday review of the known-people/talent pool.',
  '0 8 * * 1',
  '[{ "agent": "{{agent_name}}", "tool": "list_known_people", "args": {} }]'::jsonb,
  'summary'),
-- UX DESIGNER
('ux-designer', 'weekly-research-digest',
  'Monday review of pending research requests informing design work.',
  '0 9 * * 1',
  '[{ "agent": "{{agent_name}}", "tool": "list_pending_research", "args": {} }]'::jsonb,
  'summary')
ON CONFLICT (role_slug, name_suffix) DO NOTHING;

SELECT 'catalog complete: 6 roles un-muted, finance + au7o-dev orphans reassigned' AS status;

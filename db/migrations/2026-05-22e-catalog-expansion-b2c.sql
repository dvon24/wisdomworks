-- Catalog expansion — 20 new canonical roles covering B2C / lifestyle /
-- personal / solo-professional / household / education / health / creative.
--
-- Devon 2026-05-22: "we should expand the catalog by looking at all
-- possibilities — if I wanted a personal trainer to suggest workouts then
-- what?" The existing 10-role catalog was heavily B2B-ops focused
-- (financial-advisor, operations-manager, scheduler, web-developer...)
-- which contradicts the platform's "marketing to everyone, not just B2B"
-- positioning.
--
-- These 20 new roles cover the realistic shapes a mass-market user would
-- ask for. Most have minimal required_capabilities (just email — so the
-- agent can report back) because lifestyle/personal roles derive value
-- from COACHING + STRUCTURE + PERSISTENCE, not data integration. Templates
-- come where existing tools can produce useful output today — coaching
-- roles that need content generation (workout plans, meal plans, study
-- guides) ship with EMPTY template sets initially. Owners can build custom
-- workflows via Iris's create_workflow tool; richer templates land once
-- the content-generation primitive ships.
--
-- New categories introduced: 'health', 'lifestyle', 'education', 'creative',
-- 'professional', 'household'. Category is free-text TEXT so no constraint
-- update needed.

INSERT INTO agent_role_catalog (role_slug, display_default, category, description, default_tools, required_capabilities, optional_capabilities) VALUES
-- ─── HEALTH ────────────────────────────────────────────────────────────────
('personal-trainer',
  'Coach',
  'health',
  'Designs weekly workouts based on goals, tracks adherence, adjusts based on owner check-ins. Coaches via WhatsApp + scheduled calendar reminders.',
  '["list_calendar_events", "create_calendar_event", "create_document", "remember_this", "recall_atoms"]'::jsonb,
  '["email"]'::jsonb,
  '["calendar"]'::jsonb),
('nutritionist',
  'Nico',
  'health',
  'Plans weekly meals, tracks food logs, suggests adjustments based on goals. Sends grocery lists, monitors adherence.',
  '["create_document", "send_email", "remember_this", "recall_atoms"]'::jsonb,
  '["email"]'::jsonb,
  '["drive", "spreadsheet"]'::jsonb),
('medication-tracker',
  'Felix',
  'health',
  'Reminds owner of scheduled medications, tracks adherence, alerts on refills. Keeps a log of side effects and doctor follow-ups.',
  '["list_calendar_events", "create_calendar_event", "remember_this", "recall_atoms"]'::jsonb,
  '["email"]'::jsonb,
  '["calendar"]'::jsonb),
('fitness-logger',
  'Sol',
  'health',
  'Logs daily activity, summarizes trends weekly, flags streaks and slumps. Best paired with a personal-trainer.',
  '["remember_this", "recall_atoms", "create_document", "send_email"]'::jsonb,
  '["email"]'::jsonb,
  '[]'::jsonb),
('sleep-coach',
  'Nox',
  'health',
  'Tracks sleep patterns, coaches bedtime routines, sends evening wind-down reminders. Surfaces patterns over time.',
  '["create_calendar_event", "remember_this", "recall_atoms"]'::jsonb,
  '["email"]'::jsonb,
  '["calendar"]'::jsonb),

-- ─── LIFESTYLE ─────────────────────────────────────────────────────────────
('life-coach',
  'Quinn',
  'lifestyle',
  'Weekly goal review, monthly reflection, accountability check-ins. Helps owner break down big goals into daily actions.',
  '["list_open_tasks", "remember_this", "recall_atoms", "create_document", "send_email"]'::jsonb,
  '["email"]'::jsonb,
  '[]'::jsonb),
('travel-planner',
  'Atlas',
  'lifestyle',
  'Researches destinations, builds itineraries, manages pre-departure checklists. Tracks loyalty programs and travel preferences.',
  '["list_calendar_events", "create_calendar_event", "remember_this", "create_document", "send_email", "request_research"]'::jsonb,
  '["email"]'::jsonb,
  '["calendar"]'::jsonb),
('meal-planner',
  'Hazel',
  'lifestyle',
  'Weekly menus tailored to dietary goals + household preferences. Produces grocery lists. Pairs with nutritionist if present.',
  '["create_document", "send_email", "remember_this", "recall_atoms"]'::jsonb,
  '["email"]'::jsonb,
  '["drive"]'::jsonb),

-- ─── EDUCATION ─────────────────────────────────────────────────────────────
('tutor',
  'Quill',
  'education',
  'Subject-area tutoring with weekly study plans, progress tracking, exam prep. Adjusts pace based on owner feedback.',
  '["create_document", "send_email", "remember_this", "recall_atoms", "list_open_tasks"]'::jsonb,
  '["email"]'::jsonb,
  '["drive"]'::jsonb),
('language-coach',
  'Lex',
  'education',
  'Daily vocabulary drills, weekly conversation prompts, monthly progress assessment. Tracks fluency milestones.',
  '["create_document", "send_email", "remember_this", "recall_atoms"]'::jsonb,
  '["email"]'::jsonb,
  '[]'::jsonb),

-- ─── CREATIVE ──────────────────────────────────────────────────────────────
('writer',
  'Pen',
  'creative',
  'Drafts long-form content, manages writing projects, tracks daily word-count goals. Stores style preferences over time.',
  '["create_document", "send_email", "remember_this", "recall_atoms", "list_open_tasks"]'::jsonb,
  '["email"]'::jsonb,
  '["drive"]'::jsonb),
('content-creator',
  'Reel',
  'creative',
  'Plans content calendar, drafts posts/scripts, tracks engagement across platforms. Distinct from marketing-manager — this is the maker, not the strategist.',
  '["instagram_recent_activity", "propose_marketing_draft", "list_marketing_drafts", "create_document"]'::jsonb,
  '["email"]'::jsonb,
  '["instagram", "drive"]'::jsonb),
('editor',
  'Vera',
  'creative',
  'Reviews drafts for style/clarity, maintains tone consistency, manages editorial calendar. Pairs with writer or content-creator.',
  '["create_document", "send_email", "remember_this", "recall_atoms"]'::jsonb,
  '["email"]'::jsonb,
  '["drive"]'::jsonb),

-- ─── PROFESSIONAL ──────────────────────────────────────────────────────────
('real-estate-agent',
  'Casey',
  'professional',
  'Tracks listings, manages showings, follows up with prospects. Aggregates market data weekly.',
  '["list_calendar_events", "search_emails", "draft_email", "remember_this", "create_document"]'::jsonb,
  '["email"]'::jsonb,
  '["calendar"]'::jsonb),
('freelancer-pm',
  'Jules',
  'professional',
  'Project manager for solo freelancers — tracks client work, deadlines, invoicing, capacity. Single source of truth across gigs.',
  '["list_open_tasks", "list_calendar_events", "create_document", "send_email", "remember_this"]'::jsonb,
  '["email"]'::jsonb,
  '["calendar", "drive"]'::jsonb),
('consultant',
  'Drake',
  'professional',
  'Manages multiple client engagements, tracks billable hours, drafts deliverables. Weekly client rollups + monthly billing summary.',
  '["list_open_tasks", "list_calendar_events", "create_document", "send_email", "remember_this"]'::jsonb,
  '["email"]'::jsonb,
  '["calendar", "drive"]'::jsonb),

-- ─── HOUSEHOLD ─────────────────────────────────────────────────────────────
('household-manager',
  'Hearth',
  'household',
  'Coordinates household tasks, tracks bills + due dates, manages service-provider relationships. Family-calendar hub.',
  '["list_open_tasks", "list_calendar_events", "create_calendar_event", "remember_this", "send_email"]'::jsonb,
  '["email"]'::jsonb,
  '["calendar"]'::jsonb),
('grocery-planner',
  'Basil',
  'household',
  'Builds weekly grocery lists from meal plans + pantry inventory. Tracks recurring items and pantry restocking cadence.',
  '["create_document", "send_email", "remember_this", "recall_atoms"]'::jsonb,
  '["email"]'::jsonb,
  '["drive"]'::jsonb),

-- ─── BUSINESS (gaps in original catalog) ───────────────────────────────────
('bookkeeper',
  'Penny',
  'finance',
  'Pure bookkeeping — categorizes expenses, reconciles statements, prepares data for accountant/CPA. Distinct from financial-advisor (data entry vs coaching).',
  '["get_my_spend", "get_spend_breakdown", "search_emails", "create_document", "send_email", "remember_this"]'::jsonb,
  '["email"]'::jsonb,
  '["accounting", "spreadsheet", "payments"]'::jsonb),
('project-manager',
  'Pace',
  'ops',
  'Tracks multi-project portfolios, manages dependencies, surfaces blockers. Weekly project status + monthly portfolio review.',
  '["get_project_status", "list_all_projects", "list_open_tasks", "create_document", "send_email"]'::jsonb,
  '["email"]'::jsonb,
  '["calendar", "drive"]'::jsonb)
ON CONFLICT (role_slug) DO NOTHING;

-- ─── Templates — only where existing tools can produce useful output ──────
-- Coaching roles (personal-trainer, nutritionist, life-coach, etc.) ship
-- with empty template sets initially because their value requires
-- content-generation (workout plans, meal plans, study guides) that the
-- workflow engine doesn't have a primitive for yet. Owners can still ask
-- Iris to create custom workflows; richer templates land with the
-- content-generation enhancement.

INSERT INTO agent_role_templates (role_slug, name_suffix, description, cron_expr, steps, category) VALUES

-- LIFE COACH — daily accountability sweep using list_open_tasks
('life-coach', 'daily-accountability-sweep',
  'Daily 7pm pulse on open tasks — what got done, what slipped.',
  '0 19 * * *',
  '[
    { "agent": "{{agent_name}}", "tool": "list_open_tasks", "args": {} }
  ]'::jsonb,
  'briefing'),

-- TRAVEL PLANNER — pre-departure scan of upcoming travel events
('travel-planner', 'upcoming-trips-scan',
  'Weekly look-ahead at travel events on the calendar so nothing surprises.',
  '0 9 * * 0',
  '[
    { "agent": "{{agent_name}}", "tool": "list_calendar_events", "args": {} }
  ]'::jsonb,
  'monitoring'),

-- CONTENT CREATOR — weekly engagement summary on Instagram
('content-creator', 'weekly-engagement-summary',
  'Sunday evening recap of recent Instagram activity + pending drafts.',
  '0 19 * * 0',
  '[
    { "agent": "{{agent_name}}", "tool": "instagram_recent_activity", "args": {} }
  ]'::jsonb,
  'briefing'),
('content-creator', 'pending-drafts-check',
  'Weekday morning check on marketing drafts awaiting approval.',
  '30 8 * * 1-5',
  '[
    { "agent": "{{agent_name}}", "tool": "list_marketing_drafts", "args": {} }
  ]'::jsonb,
  'monitoring'),

-- FREELANCER PM — weekly client rollup using open tasks
('freelancer-pm', 'weekly-client-rollup',
  'Sunday evening: open tasks + scheduled meetings across all clients.',
  '0 18 * * 0',
  '[
    { "agent": "{{agent_name}}", "tool": "list_open_tasks", "args": {} }
  ]'::jsonb,
  'briefing'),

-- CONSULTANT — daily meeting prep
('consultant', 'morning-meeting-prep',
  'Weekday morning brief of today''s client meetings.',
  '0 8 * * 1-5',
  '[
    { "agent": "{{agent_name}}", "tool": "list_calendar_events", "args": {} }
  ]'::jsonb,
  'briefing'),

-- HOUSEHOLD MANAGER — daily task + appointment sweep
('household-manager', 'morning-household-sweep',
  'Daily 7am pulse on household tasks + family calendar.',
  '0 7 * * *',
  '[
    { "agent": "{{agent_name}}", "tool": "list_open_tasks", "args": {} }
  ]'::jsonb,
  'briefing'),

-- BOOKKEEPER — weekly spend categorization summary
('bookkeeper', 'weekly-spend-summary',
  'Friday afternoon spend categorization summary so the books stay current.',
  '0 16 * * 5',
  '[
    { "agent": "{{agent_name}}", "tool": "get_spend_breakdown", "args": {} }
  ]'::jsonb,
  'briefing'),
('bookkeeper', 'monthly-expense-pdf',
  'First of every month, generate the prior month''s expense report PDF and email it.',
  '0 8 1 * *',
  '[
    { "agent": "{{agent_name}}", "tool": "get_spend_breakdown", "args": {} },
    { "agent": "{{agent_name}}", "tool": "create_document", "args": { "format": "pdf", "filename": "monthly-expenses", "title": "Monthly Expense Report", "content": "{previous}" } },
    { "tool": "send_email", "args": { "subject": "Monthly expense report", "body": "Bookkeeping summary attached.", "attachments": [{ "url": "{previous.storage_url}", "filename": "{previous.safeName}" }] } }
  ]'::jsonb,
  'briefing'),

-- PROJECT MANAGER — daily project status check (Au7o + WisdomWorks)
('project-manager', 'morning-portfolio-sweep',
  'Weekday morning rollup of every connected project''s status.',
  '0 8 * * 1-5',
  '[
    { "agent": "{{agent_name}}", "tool": "list_all_projects", "args": {} }
  ]'::jsonb,
  'briefing'),
('project-manager', 'open-tasks-rollup',
  'Daily 5pm rollup of open tasks across the portfolio.',
  '0 17 * * 1-5',
  '[
    { "agent": "{{agent_name}}", "tool": "list_open_tasks", "args": {} }
  ]'::jsonb,
  'briefing')
ON CONFLICT (role_slug, name_suffix) DO NOTHING;

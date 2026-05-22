-- Expand the canonical agent role catalog from B2B-ops only (10 roles) to
-- a broader B2C + solo-professional + lifestyle catalog (30 roles total).
--
-- Devon's framing 2026-05-22: "marketing to everyone, not just B2B."
-- Most plausible owners want personal/lifestyle/coaching agents (personal
-- trainer, nutritionist, life coach, tutor) at least as much as they want
-- finance/ops agents. The previous catalog ignored that segment entirely.
--
-- 20 new roles added across 6 new categories: health, lifestyle, education,
-- creative, solo-professional, household. Plus a few business-gap fills
-- (bookkeeper vs financial-advisor, project-manager, content-creator vs
-- marketing-manager).
--
-- All capability requirements are minimal (usually just "email") so day-1
-- audits don't show new roles as perma-blocked. Optional capabilities
-- include MCP-pending ones (fitness-tracker, calendar in some cases) so
-- owners see "more value when you connect X" without it being a hard gate.

INSERT INTO agent_role_catalog (role_slug, display_default, category, description, default_tools, required_capabilities, optional_capabilities) VALUES

-- ─── HEALTH (3) ────────────────────────────────────────────────────────────
('personal-trainer',
  'Coach',
  'health',
  'Designs weekly workouts based on owner goals, schedules them, and runs pre/post check-ins via chat. Adjusts plans based on adherence + recovery.',
  '["list_calendar_events", "create_calendar_event", "create_document", "list_my_schedule", "remember_this", "recall_atoms"]'::jsonb,
  '["email"]'::jsonb,
  '["calendar", "fitness-tracker"]'::jsonb),

('nutritionist',
  'Nico',
  'health',
  'Builds meal plans aligned with owner goals, suggests recipes, tracks logged meals, and adjusts calorie/macro targets weekly.',
  '["create_document", "remember_this", "recall_atoms", "send_email"]'::jsonb,
  '["email"]'::jsonb,
  '["drive", "spreadsheet"]'::jsonb),

('sleep-coach',
  'Nox',
  'health',
  'Recommends wind-down routines, sends bedtime reminders, tracks sleep quality from owner check-ins, suggests adjustments.',
  '["create_calendar_event", "remember_this", "recall_atoms"]'::jsonb,
  '["email"]'::jsonb,
  '["calendar", "fitness-tracker"]'::jsonb),

-- ─── LIFESTYLE (5) ─────────────────────────────────────────────────────────
('life-coach',
  'Quinn',
  'lifestyle',
  'Weekly goal-setting + accountability check-ins. Tracks long-running personal goals, prompts reflection, celebrates milestones.',
  '["remember_this", "recall_atoms", "list_open_tasks", "create_document"]'::jsonb,
  '["email"]'::jsonb,
  '["calendar", "drive"]'::jsonb),

('travel-planner',
  'Atlas',
  'lifestyle',
  'Researches destinations, drafts itineraries, drops calendar holds for travel dates, sends pre-trip checklists.',
  '["request_research", "create_document", "create_calendar_event", "list_calendar_events"]'::jsonb,
  '["email"]'::jsonb,
  '["calendar", "drive"]'::jsonb),

('meal-planner',
  'Hazel',
  'lifestyle',
  'Weekly meal plans + grocery lists tailored to owner preferences. Routes between cuisines, manages dietary constraints.',
  '["create_document", "remember_this", "recall_atoms", "send_email"]'::jsonb,
  '["email"]'::jsonb,
  '["drive", "spreadsheet"]'::jsonb),

('household-manager',
  'Hearth',
  'lifestyle',
  'Tracks household tasks (cleaning rotations, maintenance schedules, appointment logistics), sends weekly briefs to keep things on track.',
  '["list_open_tasks", "create_calendar_event", "list_calendar_events", "remember_this"]'::jsonb,
  '["email"]'::jsonb,
  '["calendar"]'::jsonb),

('grocery-planner',
  'Basil',
  'lifestyle',
  'Builds weekly grocery lists from owner pantry + meal plans, surfaces what is running low, drafts shopping list per store.',
  '["create_document", "remember_this", "recall_atoms"]'::jsonb,
  '["email"]'::jsonb,
  '["drive", "spreadsheet"]'::jsonb),

-- ─── EDUCATION (2) ─────────────────────────────────────────────────────────
('tutor',
  'Quill',
  'education',
  'Subject-matter tutor — explains concepts, drafts practice problems, tracks understanding over time, adjusts pace.',
  '["create_document", "query_knowledge_base", "remember_this", "recall_atoms"]'::jsonb,
  '["email"]'::jsonb,
  '["drive"]'::jsonb),

('language-coach',
  'Lex',
  'education',
  'Daily language drills, vocabulary review, conversation practice prompts. Tracks owner level + progress over time.',
  '["create_document", "remember_this", "recall_atoms"]'::jsonb,
  '["email"]'::jsonb,
  '["drive"]'::jsonb),

-- ─── CREATIVE (3) ──────────────────────────────────────────────────────────
('writer',
  'Pen',
  'creative',
  'Drafts articles, blog posts, essays, copy. Takes owner brief, produces drafts for review, iterates on feedback.',
  '["create_document", "request_research", "remember_this"]'::jsonb,
  '["email"]'::jsonb,
  '["drive"]'::jsonb),

('content-creator',
  'Reel',
  'creative',
  'Produces social-ready content (short captions, scripts, hooks). Distinct from marketing-manager (strategy/cadence) — this role makes the actual posts.',
  '["create_document", "propose_marketing_draft", "list_marketing_drafts", "list_marketing_styles"]'::jsonb,
  '["email"]'::jsonb,
  '["instagram", "drive"]'::jsonb),

('editor',
  'Vera',
  'creative',
  'Reviews and edits the owner''s written work for clarity, tone, and structure. Pairs with writer agents on drafts.',
  '["create_document", "query_knowledge_base"]'::jsonb,
  '["email"]'::jsonb,
  '["drive"]'::jsonb),

-- ─── SOLO PROFESSIONAL (3) ─────────────────────────────────────────────────
('real-estate-agent',
  'Casey',
  'solo-professional',
  'Tracks listings, schedules showings, drafts client emails + follow-ups, monitors transaction milestones.',
  '["list_unread_emails", "search_emails", "draft_email", "list_calendar_events", "create_calendar_event", "list_known_people"]'::jsonb,
  '["email"]'::jsonb,
  '["calendar", "spreadsheet"]'::jsonb),

('freelancer-pm',
  'Jules',
  'solo-professional',
  'Tracks projects, deadlines, client communications, and invoices for a solo freelancer or consultant. Drafts status updates + follow-ups.',
  '["list_open_tasks", "list_unread_emails", "draft_email", "create_document", "remember_this"]'::jsonb,
  '["email"]'::jsonb,
  '["calendar", "accounting", "spreadsheet"]'::jsonb),

('consultant',
  'Drake',
  'solo-professional',
  'Research-heavy advisor that prepares client deliverables — pre-meeting briefs, post-meeting summaries, recommendations decks.',
  '["request_research", "create_document", "query_knowledge_base", "list_calendar_events"]'::jsonb,
  '["email"]'::jsonb,
  '["calendar", "drive"]'::jsonb),

-- ─── BUSINESS GAPS (2) ─────────────────────────────────────────────────────
('bookkeeper',
  'Penny',
  'finance',
  'Data-entry-focused finance agent — categorizes receipts, reconciles transactions, prepares records. Distinct from financial-advisor (strategy/coaching).',
  '["search_emails", "remember_this", "recall_atoms", "create_document"]'::jsonb,
  '["email"]'::jsonb,
  '["accounting", "spreadsheet", "drive"]'::jsonb),

('project-manager',
  'Pace',
  'ops',
  'Coordinates multi-step projects across the owner''s team — milestones, status reports, blocker escalation, retros.',
  '["list_open_tasks", "list_all_projects", "get_project_status", "create_document", "list_calendar_events"]'::jsonb,
  '["email"]'::jsonb,
  '["calendar", "drive"]'::jsonb),

-- ─── HEALTH (extras to round to 20) ────────────────────────────────────────
('medication-tracker',
  'Felix',
  'health',
  'Sends medication reminders, tracks adherence via owner check-ins, alerts on refill timing, flags missed doses.',
  '["create_calendar_event", "list_calendar_events", "remember_this", "recall_atoms"]'::jsonb,
  '["email"]'::jsonb,
  '["calendar"]'::jsonb),

('fitness-logger',
  'Sol',
  'health',
  'Daily activity logger — captures workouts, steps, recovery state from owner reports, weekly summaries trends + suggestions.',
  '["remember_this", "recall_atoms", "create_document"]'::jsonb,
  '["email"]'::jsonb,
  '["fitness-tracker", "spreadsheet"]'::jsonb);

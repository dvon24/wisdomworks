-- Starter workflow templates for the 20 new canonical roles added in
-- 2026-05-22e. Each role gets 2-3 templates covering the most common
-- shapes: weekly briefings, daily check-ins, scheduled status pulls.
--
-- All templates use ONLY tools that exist in the catalog as of
-- 2026-05-22. Workflows that benefit from MCP-pending capabilities
-- (fitness-tracker, etc.) work via owner check-ins for now and get
-- richer when the MCPs land.
--
-- The 2026-05-22 dispatcher enhancement surfaces the last successful
-- step's output_preview as the WhatsApp message body, so single-step
-- workflows (just a list_calendar_events call, e.g.) deliver real
-- content to the owner, not just status pings.

-- ─── PERSONAL-TRAINER (Coach) ──────────────────────────────────────────────
INSERT INTO agent_role_templates (role_slug, name_suffix, description, cron_expr, steps, category) VALUES
('personal-trainer', 'weekly-workout-plan',
  'Sunday evening — generates next week''s workout plan as a PDF and emails it.',
  '0 18 * * 0',
  '[
    { "agent": "{{agent_name}}", "tool": "create_document", "args": { "format": "pdf", "filename": "weekly-workout-plan", "title": "Weekly Workout Plan", "content": "Generate a 4-day workout plan for the upcoming week based on the owner''s recent activity and goals. Include warmups, primary lifts, accessories, and recovery notes." } },
    { "tool": "send_email", "args": { "subject": "Weekly workout plan", "body": "Your week of workouts is attached.", "attachments": [{ "url": "{previous.storage_url}", "filename": "{previous.safeName}" }] } }
  ]'::jsonb,
  'briefing'),
('personal-trainer', 'morning-workout-prompt',
  'Daily morning ping — checks the calendar for today''s workout and surfaces it as a reminder.',
  '0 7 * * 1-5',
  '[
    { "agent": "{{agent_name}}", "tool": "list_calendar_events", "args": {} }
  ]'::jsonb,
  'briefing'),
('personal-trainer', 'weekly-progress-review',
  'Sunday morning — summarizes last week''s training adherence and suggests adjustments.',
  '0 9 * * 0',
  '[
    { "agent": "{{agent_name}}", "tool": "recall_atoms", "args": { "query": "workout adherence and feedback last 7 days" } }
  ]'::jsonb,
  'briefing');

-- ─── NUTRITIONIST (Nico) ───────────────────────────────────────────────────
INSERT INTO agent_role_templates (role_slug, name_suffix, description, cron_expr, steps, category) VALUES
('nutritionist', 'weekly-meal-plan',
  'Sunday evening — drafts next week''s meals + macros aligned to owner goals.',
  '30 18 * * 0',
  '[
    { "agent": "{{agent_name}}", "tool": "create_document", "args": { "format": "pdf", "filename": "weekly-meal-plan", "title": "Weekly Meal Plan", "content": "Generate a 7-day meal plan with 3 meals + 1 snack per day, aligned with the owner''s logged dietary goals." } },
    { "tool": "send_email", "args": { "subject": "Your weekly meal plan", "body": "Meals + macros attached.", "attachments": [{ "url": "{previous.storage_url}", "filename": "{previous.safeName}" }] } }
  ]'::jsonb,
  'briefing'),
('nutritionist', 'daily-meal-checkin',
  'Daily check-in prompt — asks owner about logged meals + flags any gaps.',
  '0 20 * * *',
  '[
    { "agent": "{{agent_name}}", "tool": "recall_atoms", "args": { "query": "meals logged today" } }
  ]'::jsonb,
  'monitoring');

-- ─── SLEEP-COACH (Nox) ─────────────────────────────────────────────────────
INSERT INTO agent_role_templates (role_slug, name_suffix, description, cron_expr, steps, category) VALUES
('sleep-coach', 'bedtime-routine-ping',
  'Evening wind-down prompt — reminds the owner about their bedtime routine.',
  '0 22 * * *',
  '[
    { "agent": "{{agent_name}}", "tool": "recall_atoms", "args": { "query": "sleep routine and recent sleep quality" } }
  ]'::jsonb,
  'briefing'),
('sleep-coach', 'morning-sleep-checkin',
  'Morning prompt — asks how the owner slept, logs the answer.',
  '0 7 * * *',
  '[
    { "agent": "{{agent_name}}", "tool": "recall_atoms", "args": { "query": "sleep checkin yesterday" } }
  ]'::jsonb,
  'monitoring');

-- ─── LIFE-COACH (Quinn) ────────────────────────────────────────────────────
INSERT INTO agent_role_templates (role_slug, name_suffix, description, cron_expr, steps, category) VALUES
('life-coach', 'weekly-goal-review',
  'Sunday evening — surfaces the owner''s active goals, asks for reflection.',
  '0 19 * * 0',
  '[
    { "agent": "{{agent_name}}", "tool": "list_open_tasks", "args": {} }
  ]'::jsonb,
  'briefing'),
('life-coach', 'monday-week-kickoff',
  'Monday morning — prompts a top-3 priorities for the week.',
  '0 8 * * 1',
  '[
    { "agent": "{{agent_name}}", "tool": "recall_atoms", "args": { "query": "long-running personal goals and last week reflection" } }
  ]'::jsonb,
  'briefing');

-- ─── TRAVEL-PLANNER (Atlas) ────────────────────────────────────────────────
INSERT INTO agent_role_templates (role_slug, name_suffix, description, cron_expr, steps, category) VALUES
('travel-planner', 'upcoming-trip-checklist',
  'Weekly — surfaces any trips on the calendar in the next 14 days with a pre-trip checklist.',
  '0 9 * * 1',
  '[
    { "agent": "{{agent_name}}", "tool": "list_calendar_events", "args": {} }
  ]'::jsonb,
  'briefing');

-- ─── MEAL-PLANNER (Hazel) ──────────────────────────────────────────────────
INSERT INTO agent_role_templates (role_slug, name_suffix, description, cron_expr, steps, category) VALUES
('meal-planner', 'sunday-grocery-list',
  'Sunday morning — drafts the grocery list for next week''s planned meals.',
  '0 10 * * 0',
  '[
    { "agent": "{{agent_name}}", "tool": "create_document", "args": { "format": "pdf", "filename": "grocery-list", "title": "Weekly Grocery List", "content": "Build a grocery list from the upcoming week''s meal plan, organized by store section." } },
    { "tool": "send_email", "args": { "subject": "This week''s grocery list", "body": "Grocery list attached.", "attachments": [{ "url": "{previous.storage_url}", "filename": "{previous.safeName}" }] } }
  ]'::jsonb,
  'briefing');

-- ─── HOUSEHOLD-MANAGER (Hearth) ────────────────────────────────────────────
INSERT INTO agent_role_templates (role_slug, name_suffix, description, cron_expr, steps, category) VALUES
('household-manager', 'weekly-household-brief',
  'Sunday evening — surfaces open household tasks for the upcoming week.',
  '0 19 * * 0',
  '[
    { "agent": "{{agent_name}}", "tool": "list_open_tasks", "args": {} }
  ]'::jsonb,
  'briefing'),
('household-manager', 'daily-schedule',
  'Morning — surfaces today''s household-relevant calendar events.',
  '30 7 * * *',
  '[
    { "agent": "{{agent_name}}", "tool": "list_calendar_events", "args": {} }
  ]'::jsonb,
  'briefing');

-- ─── GROCERY-PLANNER (Basil) ───────────────────────────────────────────────
INSERT INTO agent_role_templates (role_slug, name_suffix, description, cron_expr, steps, category) VALUES
('grocery-planner', 'weekly-shopping-list',
  'Saturday morning — generates a shopping list from owner''s pantry inventory + meal preferences.',
  '0 9 * * 6',
  '[
    { "agent": "{{agent_name}}", "tool": "create_document", "args": { "format": "pdf", "filename": "shopping-list", "title": "Weekly Shopping List", "content": "Build a categorized shopping list based on owner pantry state and known meal preferences." } },
    { "tool": "send_email", "args": { "subject": "This week''s shopping list", "body": "Shopping list attached.", "attachments": [{ "url": "{previous.storage_url}", "filename": "{previous.safeName}" }] } }
  ]'::jsonb,
  'briefing');

-- ─── TUTOR (Quill) ─────────────────────────────────────────────────────────
INSERT INTO agent_role_templates (role_slug, name_suffix, description, cron_expr, steps, category) VALUES
('tutor', 'daily-practice-prompt',
  'Daily — generates a practice problem aligned to the owner''s current subject and level.',
  '0 18 * * 1-5',
  '[
    { "agent": "{{agent_name}}", "tool": "recall_atoms", "args": { "query": "current subject, level, and recent areas of struggle" } }
  ]'::jsonb,
  'briefing');

-- ─── LANGUAGE-COACH (Lex) ──────────────────────────────────────────────────
INSERT INTO agent_role_templates (role_slug, name_suffix, description, cron_expr, steps, category) VALUES
('language-coach', 'daily-vocab',
  'Daily morning — 5 new words + a conversation prompt in the target language.',
  '0 8 * * *',
  '[
    { "agent": "{{agent_name}}", "tool": "recall_atoms", "args": { "query": "target language, current level, recent vocabulary" } }
  ]'::jsonb,
  'briefing');

-- ─── WRITER (Pen) ──────────────────────────────────────────────────────────
INSERT INTO agent_role_templates (role_slug, name_suffix, description, cron_expr, steps, category) VALUES
('writer', 'weekly-writing-prompt',
  'Monday morning — surfaces the owner''s active writing projects and any open drafts.',
  '0 9 * * 1',
  '[
    { "agent": "{{agent_name}}", "tool": "recall_atoms", "args": { "query": "active writing projects and recent drafts" } }
  ]'::jsonb,
  'briefing');

-- ─── CONTENT-CREATOR (Reel) ────────────────────────────────────────────────
INSERT INTO agent_role_templates (role_slug, name_suffix, description, cron_expr, steps, category) VALUES
('content-creator', 'weekly-content-batch',
  'Friday afternoon — proposes a batch of 5 posts for the upcoming week.',
  '0 14 * * 5',
  '[
    { "agent": "{{agent_name}}", "tool": "list_marketing_drafts", "args": {} }
  ]'::jsonb,
  'briefing'),
('content-creator', 'engagement-checkin',
  'Daily morning — surfaces yesterday''s post performance.',
  '0 9 * * 1-5',
  '[
    { "agent": "{{agent_name}}", "tool": "instagram_recent_activity", "args": {} }
  ]'::jsonb,
  'monitoring');

-- ─── EDITOR (Vera) ─────────────────────────────────────────────────────────
INSERT INTO agent_role_templates (role_slug, name_suffix, description, cron_expr, steps, category) VALUES
('editor', 'pending-drafts-review',
  'Daily afternoon — surfaces any drafts waiting on editorial review.',
  '0 15 * * 1-5',
  '[
    { "agent": "{{agent_name}}", "tool": "list_marketing_drafts", "args": {} }
  ]'::jsonb,
  'monitoring');

-- ─── REAL-ESTATE-AGENT (Casey) ─────────────────────────────────────────────
INSERT INTO agent_role_templates (role_slug, name_suffix, description, cron_expr, steps, category) VALUES
('real-estate-agent', 'morning-pipeline-check',
  'Daily morning — pulls calendar showings + unread client emails.',
  '0 7 * * 1-6',
  '[
    { "agent": "{{agent_name}}", "tool": "list_calendar_events", "args": {} }
  ]'::jsonb,
  'briefing'),
('real-estate-agent', 'client-followup-sweep',
  'Daily afternoon — surfaces unanswered client emails for follow-up drafts.',
  '0 16 * * 1-5',
  '[
    { "agent": "{{agent_name}}", "tool": "list_unread_emails", "args": {} }
  ]'::jsonb,
  'monitoring');

-- ─── FREELANCER-PM (Jules) ─────────────────────────────────────────────────
INSERT INTO agent_role_templates (role_slug, name_suffix, description, cron_expr, steps, category) VALUES
('freelancer-pm', 'monday-week-plan',
  'Monday morning — surfaces open projects, client emails, and the week''s calendar.',
  '0 8 * * 1',
  '[
    { "agent": "{{agent_name}}", "tool": "list_open_tasks", "args": {} }
  ]'::jsonb,
  'briefing'),
('freelancer-pm', 'friday-status-prep',
  'Friday afternoon — surfaces what to include in weekly client status emails.',
  '0 15 * * 5',
  '[
    { "agent": "{{agent_name}}", "tool": "list_all_projects", "args": {} }
  ]'::jsonb,
  'briefing');

-- ─── CONSULTANT (Drake) ────────────────────────────────────────────────────
INSERT INTO agent_role_templates (role_slug, name_suffix, description, cron_expr, steps, category) VALUES
('consultant', 'pre-meeting-brief',
  'Daily morning — surfaces today''s meetings so prep materials can be staged.',
  '0 7 * * 1-5',
  '[
    { "agent": "{{agent_name}}", "tool": "list_calendar_events", "args": {} }
  ]'::jsonb,
  'briefing');

-- ─── BOOKKEEPER (Penny) ────────────────────────────────────────────────────
INSERT INTO agent_role_templates (role_slug, name_suffix, description, cron_expr, steps, category) VALUES
('bookkeeper', 'daily-receipt-scan',
  'Daily evening — scans recent emails for receipts + expense confirmations to categorize.',
  '0 20 * * 1-5',
  '[
    { "agent": "{{agent_name}}", "tool": "search_emails", "args": { "query": "receipt OR invoice OR purchase confirmation" } }
  ]'::jsonb,
  'monitoring');

-- ─── PROJECT-MANAGER (Pace) ────────────────────────────────────────────────
INSERT INTO agent_role_templates (role_slug, name_suffix, description, cron_expr, steps, category) VALUES
('project-manager', 'daily-status-roll-up',
  'Daily morning — surfaces project status across all active projects.',
  '0 8 * * 1-5',
  '[
    { "agent": "{{agent_name}}", "tool": "list_all_projects", "args": {} }
  ]'::jsonb,
  'briefing'),
('project-manager', 'open-tasks-sweep',
  'Daily afternoon — surfaces open tasks that haven''t moved.',
  '0 16 * * 1-5',
  '[
    { "agent": "{{agent_name}}", "tool": "list_open_tasks", "args": {} }
  ]'::jsonb,
  'monitoring');

-- ─── MEDICATION-TRACKER (Felix) ────────────────────────────────────────────
INSERT INTO agent_role_templates (role_slug, name_suffix, description, cron_expr, steps, category) VALUES
('medication-tracker', 'morning-med-reminder',
  'Daily morning — surfaces the owner''s medication schedule + reminders.',
  '0 7 * * *',
  '[
    { "agent": "{{agent_name}}", "tool": "recall_atoms", "args": { "query": "medication schedule and refill timing" } }
  ]'::jsonb,
  'briefing'),
('medication-tracker', 'evening-adherence-checkin',
  'Daily evening — asks owner to confirm today''s doses were taken.',
  '0 20 * * *',
  '[
    { "agent": "{{agent_name}}", "tool": "recall_atoms", "args": { "query": "medications scheduled today" } }
  ]'::jsonb,
  'monitoring');

-- ─── FITNESS-LOGGER (Sol) ──────────────────────────────────────────────────
INSERT INTO agent_role_templates (role_slug, name_suffix, description, cron_expr, steps, category) VALUES
('fitness-logger', 'evening-activity-checkin',
  'Daily evening — prompts the owner to log today''s activity if not already captured.',
  '0 21 * * *',
  '[
    { "agent": "{{agent_name}}", "tool": "recall_atoms", "args": { "query": "activity logged today" } }
  ]'::jsonb,
  'monitoring'),
('fitness-logger', 'weekly-activity-summary',
  'Sunday evening — week-in-review of logged activity.',
  '0 19 * * 0',
  '[
    { "agent": "{{agent_name}}", "tool": "recall_atoms", "args": { "query": "activity logged last 7 days" } }
  ]'::jsonb,
  'briefing');

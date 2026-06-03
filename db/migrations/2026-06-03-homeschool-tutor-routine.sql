-- 2026-06-03 — Homeschool vertical: a weekly-curriculum routine for the tutor
-- role, paired with HOMESCHOOL_TEMPLATE (vertical-templates.ts). MVP scope:
-- the agent recalls each student's subject/level/progress and composes next
-- week's curriculum for the OWNER to review (mirrors the existing
-- daily-practice-prompt: recall_atoms -> the agent's reply IS the deliverable).
--
-- NOT here (deliberately): auto-DELIVERY of the plan to a student's phone (SMS)
-- or a parent's email from a roster. Devon's point — "a homeschool can target a
-- student's phone number" — is the SAME primitive as the salon texting a
-- customer: send to a contact from a roster. That dynamic-recipient + roster +
-- outbound machinery is built ONCE with the SMB customer-messaging framework
-- and homeschool inherits it; it is not a homeschool one-off. Until then the
-- owner forwards the reviewed plan.
--
-- Idempotent: ON CONFLICT keeps re-runs safe. tutor already ships
-- daily-practice-prompt, so this is additive (tutor was never mute).

INSERT INTO agent_role_templates (role_slug, name_suffix, description, cron_expr, steps, category) VALUES
('tutor', 'weekly-curriculum-plan',
  'Every Sunday evening, draft next week''s curriculum/lesson plan per student for the owner to review and send.',
  '0 17 * * 0',
  '[{ "agent": "{{agent_name}}", "tool": "recall_atoms", "args": { "query": "each student subject, grade level, recent progress and areas of struggle" } }]'::jsonb,
  'briefing')
ON CONFLICT (role_slug, name_suffix) DO NOTHING;

SELECT 'tutor weekly-curriculum-plan seeded (homeschool vertical)' AS status;

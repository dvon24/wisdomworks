-- 2026-06-18 — Give the personal-trainer catalog role the DAILY in-chat workout.
--
-- The existing personal-trainer templates (2026-05-22f) deliver a WEEKLY plan
-- PDF (emailed — needs Gmail connected) + a morning calendar ping (needs a
-- calendar connected). Neither reproduces the experience validated on Devon's
-- own tenant: a daily workout BUILT by the trainer from the owner's saved
-- training split and delivered straight to WhatsApp — no connected services
-- required. That experience came from a hand-made workflow
-- ('weekday-workout-delivery'), so a fresh fitness onboard never got it.
--
-- This adds that workflow as a catalog template, so every personal-trainer
-- onboard ships with the daily-workout-in-chat experience day one. delegate to
-- the trainer (self by name via {{agent_name}}); the worker reads the owner's
-- scoped split atom and returns the full session. Schedule 13:00 UTC Mon–Fri
-- = 3pm CET, matching the proven setup.
--
-- Overlap-safe: distinct steps + distinct hour from morning-workout-prompt
-- ('0 7 * * 1-5'), so the 2026-06 overlap dedup (PR #58) won't flag it.
-- ON CONFLICT DO NOTHING — idempotent; re-running is a no-op.

INSERT INTO agent_role_templates (role_slug, name_suffix, description, cron_expr, steps, category) VALUES
('personal-trainer', 'weekday-workout-delivery',
  'Weekday 3pm — the trainer builds today''s workout from the owner''s saved split and delivers it straight to chat.',
  '0 13 * * 1-5',
  '[
    { "agent": "{{agent_name}}", "tool": "delegate_to_agent", "args": { "agentName": "{{agent_name}}", "task": "Build today''s workout from the owner''s saved weekly training split and recent activity. Match the day to the split (e.g. if today is the split''s leg day, program legs). Deliver the COMPLETE session — warm-up, main lifts with sets/reps/rest, accessories, cool-down. Open with the workout itself; no preamble, no restating the date or context. If the owner noted they''re skipping or short on time today, honor that." } }
  ]'::jsonb,
  'briefing')
ON CONFLICT (role_slug, name_suffix) DO NOTHING;

SELECT 'personal-trainer: weekday-workout-delivery template added (daily in-chat workout)' AS status;

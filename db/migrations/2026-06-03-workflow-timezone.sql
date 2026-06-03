-- Optional IANA timezone for user_workflows so a workflow's cron schedule can
-- track LOCAL wall-clock across DST instead of drifting with UTC. e.g. a workout
-- set for "3pm Europe/Berlin" stays 3pm in both CET (UTC+1) and CEST (UTC+2);
-- stored as "0 13 * * *" UTC it was 3pm in summer but drifted to 2pm in winter.
--
-- NULL = interpret the schedule in UTC (unchanged behavior). The dispatcher reads
-- this column (via select=*, so it's safe whether or not this migration has run)
-- and passes it to nextRunAfter(expr, from, timezone).
--
-- Idempotent + additive: existing rows get NULL, so no schedule changes until a
-- workflow is explicitly given a timezone.
ALTER TABLE user_workflows ADD COLUMN IF NOT EXISTS timezone text;

-- NOTE: the one-time re-expression of Devon's workout
--   (cron_expr '0 13 * * *' UTC  ->  '0 15 * * *' @ 'Europe/Berlin')
-- is applied OUT OF BAND after the timezone-aware dispatcher is deployed, NOT
-- here, so the new cron string is only ever interpreted by code that understands
-- the timezone (otherwise "0 15" would briefly mean 15:00 UTC = 5pm Berlin).

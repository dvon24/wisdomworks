-- 2026-06-07 — Recurring events on the internal (native) calendar.
--
-- tenant_events stored only one-off events (single start_at/end_at). Devon
-- wanted a STANDING time-block — "I work out at 7am every day" — that the daily
-- brief + conflict detection always know about so the agents plan around it.
--
-- We add a recurrence rule + optional end date. The stored start_at/end_at is
-- the FIRST occurrence (and defines the time-of-day + duration); the app
-- (managed-calendar.listEventsInRange) expands the series into concrete
-- occurrences within whatever window it's queried for. One-off events keep
-- recurrence = NULL and behave exactly as before.

ALTER TABLE tenant_events ADD COLUMN IF NOT EXISTS recurrence TEXT;          -- NULL | 'daily' | 'weekly' | 'weekdays'
ALTER TABLE tenant_events ADD COLUMN IF NOT EXISTS recurrence_until TIMESTAMPTZ;  -- NULL = forever

DO $$ BEGIN
  ALTER TABLE tenant_events ADD CONSTRAINT tenant_events_recurrence_check
    CHECK (recurrence IS NULL OR recurrence IN ('daily', 'weekly', 'weekdays'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The expansion query filters active recurring series by (start_at, recurrence_until).
CREATE INDEX IF NOT EXISTS tenant_events_recurring_idx
  ON tenant_events (tenant_phone, start_at)
  WHERE recurrence IS NOT NULL AND cancelled_at IS NULL;

SELECT 'tenant_events: recurrence + recurrence_until added (standing time-blocks)' AS status;

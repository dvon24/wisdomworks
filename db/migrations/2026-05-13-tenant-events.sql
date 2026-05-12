-- Managed calendar — tenant-native events so owners without a connected
-- Google/Apple calendar still get scheduling out of the box.
--
-- Coexists with the external connections. The brain merges native
-- (tenant_events) + connected (oauth_connections.service=calendar) +
-- bookings (client_visits) when producing the daily brief and when
-- searching for conflicts.
--
-- Run once in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS tenant_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_phone TEXT NOT NULL,
  title TEXT NOT NULL,
  notes TEXT,
  location TEXT,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  all_day BOOLEAN NOT NULL DEFAULT FALSE,
  -- Who/what created the event:
  --   'owner_defined' — owner asked Iris to schedule it
  --   'agent_created' — an agent added it autonomously (rare)
  --   'external_sync' — mirrored from a connected calendar
  source TEXT NOT NULL DEFAULT 'owner_defined',
  -- If sourced externally, where it came from + provider id for dedup
  external_provider TEXT,
  external_id TEXT,
  -- Tags for filtering: ['work', 'personal', 'family', etc.]
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Soft-delete: cancelled events stay in the row for audit + so
  -- conflict-detection knows the slot was held at some point
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT tenant_events_source_check CHECK (source IN ('owner_defined', 'agent_created', 'external_sync')),
  CONSTRAINT tenant_events_time_order CHECK (end_at >= start_at)
);

CREATE INDEX IF NOT EXISTS tenant_events_tenant_idx
  ON tenant_events (tenant_phone, start_at) WHERE cancelled_at IS NULL;

CREATE INDEX IF NOT EXISTS tenant_events_range_idx
  ON tenant_events (tenant_phone, start_at, end_at) WHERE cancelled_at IS NULL;

-- External-id dedup (for two-way sync with Google/Apple later)
CREATE UNIQUE INDEX IF NOT EXISTS tenant_events_external_id_idx
  ON tenant_events (tenant_phone, external_provider, external_id)
  WHERE external_id IS NOT NULL;

SELECT 'tenant_events ready' AS status;

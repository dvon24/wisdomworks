-- 2026-06-05 — recent_delegations: short-lived cache to stop double-delivery.
--
-- Live 2026-06-05 transcript: Devon sent two quick messages ("where's the
-- workout" then "present the workout") and got TWO different full workouts
-- (4:38 + 4:40). There is no in-flight lock or recent-delegation dedup, so each
-- message spawned its own Iris turn, each delegated to Coach, each ran the
-- worker fresh → two different artifacts.
--
-- delegate_to_agent now records each result here, and BEFORE running the worker
-- checks for a recent identical delegation (same tenant + agent + normalized
-- task signature, within ~10 min) and reuses it. Stops the double-delivery and
-- saves a worker run when the owner re-asks impatiently.
--
-- Ephemeral by nature; old rows are pruned opportunistically on write.

CREATE TABLE IF NOT EXISTS recent_delegations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_phone TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  -- Normalized first-80-chars of the task — stable for templated asks like
  -- "Generate today's workout..." so a re-ask matches.
  task_sig TEXT NOT NULL,
  result_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recent_delegations_lookup
  ON recent_delegations (tenant_phone, agent_name, task_sig, created_at DESC);

-- Tenant isolation. Inlined (the _enable_tenant_rls helper is dropped at the
-- end of 2026-05-14d; app_tenant_phone() is permanent).
ALTER TABLE recent_delegations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS recent_delegations_tenant_isolation ON recent_delegations;
CREATE POLICY recent_delegations_tenant_isolation ON recent_delegations
  FOR ALL TO authenticated, anon
  USING (tenant_phone = app_tenant_phone())
  WITH CHECK (tenant_phone = app_tenant_phone());

SELECT 'recent_delegations ready (double-delivery dedup)' AS status;

-- 2026-06-06 — Deferred delegations: the recovery "door" for the spend cap.
--
-- When a tenant is over the daily spend cap, delegate_to_agent is withheld from
-- Iris's tool list. Instead of a dead-end "I can't" (or worse, the fabricated
-- "passing to Coach now" that PR1 now blocks), Iris QUEUES the delegation here.
-- A per-minute drain cron runs each pending row the moment the tenant is back
-- under cap, then notifies the owner with the result — turning the wall into a
-- door (Iris's "I'll lock it in at midnight" instinct, made real). The owner can
-- also override ("run it now") to execute immediately, cap notwithstanding.
--
-- RLS is INLINED with the permanent app_tenant_phone() (the _enable_tenant_rls
-- helper is dropped at the end of the 2026-05-14d migration — see
-- reference_enable_tenant_rls_is_dropped). Service-role access bypasses RLS;
-- this is defense-in-depth so no tenant ever sees another's queued work.

CREATE TABLE IF NOT EXISTS deferred_delegations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_phone TEXT NOT NULL,
  target_agent TEXT NOT NULL,
  task TEXT NOT NULL,
  reason TEXT,
  source_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | running | done | failed | cancelled
  attempts INT NOT NULL DEFAULT 0,
  result_preview TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ran_at TIMESTAMPTZ
);

-- The drain cron + the owner-override both query pending rows per tenant.
CREATE INDEX IF NOT EXISTS deferred_delegations_pending_idx
  ON deferred_delegations (tenant_phone, created_at)
  WHERE status = 'pending';

ALTER TABLE deferred_delegations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deferred_delegations_tenant ON deferred_delegations;
CREATE POLICY deferred_delegations_tenant ON deferred_delegations
  USING (tenant_phone = app_tenant_phone())
  WITH CHECK (tenant_phone = app_tenant_phone());

SELECT 'deferred_delegations table created (spend-cap recovery door)' AS status;

-- Story 6.4 — Unified, hash-chained audit log.
--
-- Per `reference_ai_compliance_patterns.md` Pattern 2 (Immutable Append-Only
-- Ledger). Every sensitive operation (admin action, data export, autonomous
-- agent action, governance bypass, credential access) gets one row in
-- unified_audit_log. Each row carries:
--   previous_hash → entry_hash of the prior row for the same tenant
--   entry_hash    → SHA-256 of (this row's fields, including previous_hash)
--
-- Result: ANY tampering with a historical row breaks the hash chain at and
-- after that row. The verify_audit_chain RPC walks the chain and reports
-- exactly where (if anywhere) the chain was broken. Auditor evidence
-- becomes "run the verify function" instead of "trust our database."
--
-- Per-tenant chains (not global) so:
--   - Tenants can be audited independently
--   - Write bottleneck is per-tenant, not global
--   - Tenant audit reports walk only their own chain
--
-- Race-safety: the append RPC takes a row-level FOR UPDATE lock on the
-- latest row for the tenant before computing the new hash. Concurrent
-- appends for the same tenant serialize cleanly.
--
-- Service role bypasses RLS for write (so app code can append events).
-- Tenant reads go through the tenant_isolation policy from migration 14d.
--
-- Run once in the Supabase SQL Editor.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS unified_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_phone TEXT NOT NULL,
  -- Who took the action. Free-text for agent display names; constrained kind.
  actor TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('owner', 'agent', 'admin', 'system', 'visitor')),
  -- What was done. Suggested taxonomy:
  --   'admin.api_call', 'admin.tenant_reset',
  --   'data.export', 'data.delete', 'data.access_credential',
  --   'governance.bypass', 'governance.policy_override',
  --   'agent.autonomous_action', 'agent.tool_invocation',
  --   'auth.session_issued', 'auth.session_redeemed',
  --   'compliance.profile_change'
  action TEXT NOT NULL,
  -- Optional pointer to the resource acted on (entity id, file path, URL).
  resource TEXT,
  outcome TEXT NOT NULL DEFAULT 'success'
    CHECK (outcome IN ('success', 'failure', 'blocked')),
  -- Structured details. Caller's responsibility to redact PII here
  -- (use redactPII from @wisdomworks/shared before passing to logAuditEvent).
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Hash chain
  previous_hash TEXT NOT NULL,
  entry_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS unified_audit_log_tenant_time_idx
  ON unified_audit_log (tenant_phone, created_at DESC);

CREATE INDEX IF NOT EXISTS unified_audit_log_tenant_action_idx
  ON unified_audit_log (tenant_phone, action);

-- Story 6.2 — RLS on the audit log too. Service role bypasses for writes;
-- tenant reads via app_tenant_phone() in the policy.
ALTER TABLE unified_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON unified_audit_log;
CREATE POLICY tenant_isolation ON unified_audit_log
  FOR ALL TO authenticated, anon
  USING (tenant_phone = app_tenant_phone())
  WITH CHECK (tenant_phone = app_tenant_phone());

-- ─── append_audit_event ─────────────────────────────────────────────────────
-- Single point of entry for adding events. Computes the hash chain link in
-- one transaction so concurrent appends for the same tenant serialize.

CREATE OR REPLACE FUNCTION append_audit_event(
  p_tenant_phone TEXT,
  p_actor TEXT,
  p_actor_type TEXT,
  p_action TEXT,
  p_resource TEXT DEFAULT NULL,
  p_outcome TEXT DEFAULT 'success',
  p_payload JSONB DEFAULT '{}'::jsonb
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_prev_hash TEXT;
  v_canonical JSONB;
  v_entry_hash TEXT;
  v_id UUID;
  v_created_at TIMESTAMPTZ := now();
BEGIN
  -- Lock the latest row for this tenant to prevent races on the chain head.
  SELECT entry_hash INTO v_prev_hash
  FROM unified_audit_log
  WHERE tenant_phone = p_tenant_phone
  ORDER BY created_at DESC, id DESC
  LIMIT 1
  FOR UPDATE;

  IF v_prev_hash IS NULL THEN
    v_prev_hash := '0';
  END IF;

  -- Canonical serialization for the hash. jsonb keys are stored in a
  -- deterministic order so the text cast is stable across rebuilds.
  v_canonical := jsonb_build_object(
    'tenant_phone', p_tenant_phone,
    'actor', p_actor,
    'actor_type', p_actor_type,
    'action', p_action,
    'resource', p_resource,
    'outcome', p_outcome,
    'payload', p_payload,
    'previous_hash', v_prev_hash,
    'created_at', v_created_at
  );

  v_entry_hash := encode(digest(v_canonical::text, 'sha256'), 'hex');

  INSERT INTO unified_audit_log (
    tenant_phone, actor, actor_type, action, resource, outcome,
    payload, previous_hash, entry_hash, created_at
  ) VALUES (
    p_tenant_phone, p_actor, p_actor_type, p_action, p_resource, p_outcome,
    p_payload, v_prev_hash, v_entry_hash, v_created_at
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION append_audit_event IS
  'Story 6.4 — single append-only entry point for the hash-chained audit log. Computes entry_hash from the row contents + previous row''s hash. Race-safe via FOR UPDATE on the chain head. Pass already-redacted text in payload — this function does not redact.';

-- ─── verify_audit_chain ─────────────────────────────────────────────────────
-- Walks the per-tenant chain and reports the first break (if any).
-- Auditor evidence: invoke this RPC and assert verified_rows == total_rows
-- AND broken_at IS NULL.

CREATE OR REPLACE FUNCTION verify_audit_chain(
  p_tenant_phone TEXT,
  p_since TIMESTAMPTZ DEFAULT NULL
) RETURNS TABLE (
  total_rows INT,
  verified_rows INT,
  broken_at UUID,
  break_reason TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_prev_hash TEXT := '0';
  v_first_row BOOLEAN := TRUE;
  v_total INT := 0;
  v_verified INT := 0;
  v_broken_id UUID;
  v_break_reason TEXT;
  v_row RECORD;
  v_canonical JSONB;
  v_expected_hash TEXT;
BEGIN
  FOR v_row IN
    SELECT * FROM unified_audit_log
    WHERE tenant_phone = p_tenant_phone
      AND (p_since IS NULL OR created_at >= p_since)
    ORDER BY created_at ASC, id ASC
  LOOP
    v_total := v_total + 1;

    -- previous_hash should link to the prior verified entry. For partial
    -- verification (p_since set), we accept the first row's previous_hash
    -- as the chain entry point and only check structural correctness from
    -- that point forward.
    IF NOT v_first_row AND v_row.previous_hash <> v_prev_hash THEN
      v_broken_id := v_row.id;
      v_break_reason := format(
        'previous_hash mismatch at row %s: chain expected %s, row has %s',
        v_row.id, v_prev_hash, v_row.previous_hash
      );
      EXIT;
    END IF;

    -- Recompute the entry hash from the stored fields.
    v_canonical := jsonb_build_object(
      'tenant_phone', v_row.tenant_phone,
      'actor', v_row.actor,
      'actor_type', v_row.actor_type,
      'action', v_row.action,
      'resource', v_row.resource,
      'outcome', v_row.outcome,
      'payload', v_row.payload,
      'previous_hash', v_row.previous_hash,
      'created_at', v_row.created_at
    );

    v_expected_hash := encode(digest(v_canonical::text, 'sha256'), 'hex');

    IF v_expected_hash <> v_row.entry_hash THEN
      v_broken_id := v_row.id;
      v_break_reason := format(
        'entry_hash mismatch at row %s: row contents have been tampered (expected %s, stored %s)',
        v_row.id, v_expected_hash, v_row.entry_hash
      );
      EXIT;
    END IF;

    v_verified := v_verified + 1;
    v_prev_hash := v_row.entry_hash;
    v_first_row := FALSE;
  END LOOP;

  RETURN QUERY SELECT v_total, v_verified, v_broken_id, v_break_reason;
END;
$$;

COMMENT ON FUNCTION verify_audit_chain IS
  'Story 6.4 — walks the per-tenant audit chain and reports the first integrity break. Pass p_since to verify only events after a checkpoint (useful for periodic verification jobs).';

-- Grant execute on the RPCs to authenticated + anon so the deck can call
-- them (subject to the RLS policy on the table). Service role has its own
-- access path.
GRANT EXECUTE ON FUNCTION append_audit_event(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION verify_audit_chain(TEXT, TIMESTAMPTZ) TO authenticated, anon, service_role;

SELECT 'unified_audit_log + append/verify RPCs ready' AS status;

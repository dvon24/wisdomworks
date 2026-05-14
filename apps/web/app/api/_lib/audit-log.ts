/**
 * Story 6.4 — Unified, hash-chained audit log.
 *
 * Single entry point for recording sensitive operations: admin actions,
 * data exports, autonomous agent actions, governance bypasses, credential
 * access, compliance-profile changes. The DB-side append_audit_event RPC
 * computes the SHA-256 chain link; this helper just submits.
 *
 * Fire-and-forget. NEVER throws into the caller's flow — an audit failure
 * must not block the operation being audited. (We separately monitor
 * audit-write failures via console.warn; if those start showing up we
 * have a bigger problem.)
 *
 * Callers are responsible for redacting PII from `payload` before
 * passing it in. Use redactPII from @wisdomworks/shared for free-text.
 * The audit log is intentionally append-only; we can't fix a row after.
 */

import { redactPII } from '@wisdomworks/shared';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export type ActorType = 'owner' | 'agent' | 'admin' | 'system' | 'visitor';

export type AuditOutcome = 'success' | 'failure' | 'blocked';

/**
 * Suggested taxonomy for the `action` field — keep these stable across
 * commits so audit queries don't break. Add new values here as new event
 * types land; don't free-text.
 */
export type AuditAction =
  // Admin / operator
  | 'admin.api_call'
  | 'admin.tenant_reset'
  | 'admin.config_change'
  // Data lifecycle
  | 'data.export'
  | 'data.delete'
  | 'data.access_credential'
  // Governance
  | 'governance.bypass'
  | 'governance.policy_override'
  | 'governance.escalation'
  // Agent autonomy
  | 'agent.autonomous_action'
  | 'agent.tool_invocation'
  | 'agent.guardrail_blocked'
  // Auth
  | 'auth.session_issued'
  | 'auth.session_redeemed'
  | 'auth.session_rejected'
  // Compliance
  | 'compliance.profile_change'
  | 'compliance.attestation_signed'
  // Custom (please prefer one of the above)
  | (string & {});

export interface AuditEventInput {
  tenantPhone: string;
  actor: string;          // Display name: 'Devon', 'Marcus (marketing)', 'admin-cron', etc
  actorType: ActorType;
  action: AuditAction;
  resource?: string;      // Optional pointer (entity id, file path, URL)
  outcome?: AuditOutcome; // Default 'success'
  payload?: Record<string, unknown>;
  /** If true (default), free-text values in payload pass through redactPII before insert. */
  redact?: boolean;
}

/**
 * Append an event to the hash-chained audit log. Fire-and-forget.
 * Returns the inserted row's UUID, or null on failure.
 */
export async function logAuditEvent(input: AuditEventInput): Promise<string | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const cleanPhone = input.tenantPhone.replace(/[\s\-+()]/g, '');
    const payload = input.redact === false
      ? (input.payload ?? {})
      : redactPayloadFreeText(input.payload ?? {});

    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/append_audit_event`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_tenant_phone: cleanPhone,
        p_actor: input.actor,
        p_actor_type: input.actorType,
        p_action: input.action,
        p_resource: input.resource ?? null,
        p_outcome: input.outcome ?? 'success',
        p_payload: payload,
      }),
    });
    if (!res.ok) {
      console.warn('[audit-log] append failed:', res.status, await res.text());
      return null;
    }
    const id = await res.json();
    return typeof id === 'string' ? id : null;
  } catch (err) {
    console.warn('[audit-log] append exception:', err);
    return null;
  }
}

/**
 * Verify the chain integrity for a tenant. Returns { totalRows, verifiedRows,
 * brokenAt, breakReason }. Use brokenAt == null AND verified == total as
 * the "chain intact" assertion.
 */
export async function verifyAuditChain(
  tenantPhone: string,
  since?: Date,
): Promise<{ totalRows: number; verifiedRows: number; brokenAt: string | null; breakReason: string | null } | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/verify_audit_chain`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_tenant_phone: cleanPhone,
        p_since: since?.toISOString() ?? null,
      }),
    });
    if (!res.ok) {
      console.warn('[audit-log] verify failed:', res.status, await res.text());
      return null;
    }
    const rows = await res.json();
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) return null;
    return {
      totalRows: row.total_rows ?? 0,
      verifiedRows: row.verified_rows ?? 0,
      brokenAt: row.broken_at ?? null,
      breakReason: row.break_reason ?? null,
    };
  } catch (err) {
    console.warn('[audit-log] verify exception:', err);
    return null;
  }
}

/**
 * Walk an arbitrary JSON-like value and redact any string leaves via redactPII.
 * Recurses into objects + arrays. Leaves non-string scalars (numbers, bool,
 * null) untouched.
 */
function redactPayloadFreeText(value: unknown): unknown {
  if (typeof value === 'string') return redactPII(value).redacted;
  if (Array.isArray(value)) return value.map(redactPayloadFreeText);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactPayloadFreeText(v);
    }
    return out;
  }
  return value;
}

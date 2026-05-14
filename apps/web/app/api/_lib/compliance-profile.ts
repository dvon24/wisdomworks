/**
 * Story 6.12 — Compliance framework profiles per tenant.
 *
 * Source of truth: tenant_compliance_profiles table. Wraps reads + writes
 * + provides a typed framework taxonomy.
 *
 * Today this is mostly read-only — the deck doesn't yet have a UI to
 * toggle frameworks. We'll expose it via an admin endpoint when the
 * first compliance-bound tenant onboards. The infrastructure is ready
 * so we can flip a flag the day a HIPAA/SOX/etc tenant signs.
 */

import { computeComplianceProfileHmac, verifyRowHmac } from '@wisdomworks/shared';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

/** Stable taxonomy — extend the migration's CHECK constraint when adding new ones. */
export type ComplianceFramework =
  | 'gdpr'
  | 'ccpa'
  | 'hipaa'
  | 'pci_dss'
  | 'soc2_type1'
  | 'soc2_type2'
  | 'iso_27001'
  | 'sox'
  | 'fedramp_low'
  | 'fedramp_mod'
  | 'fedramp_high';

export interface SignedAgreement {
  kind: string;            // 'baa' | 'dpa' | 'msa' | 'sox_controls' | ...
  signed_at: string;       // ISO timestamp
  reference_url?: string;
  signed_by?: string;
  version?: string;
}

export interface ComplianceProfile {
  tenantPhone: string;
  frameworks: ComplianceFramework[];
  activationGates: string[];
  egressAllowlist: string[] | null;   // null = unrestricted
  signedAgreements: SignedAgreement[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** Default-empty profile for tenants without a row. Use when caller wants
 *  a consistent shape without checking nullability. */
export function defaultProfile(tenantPhone: string): ComplianceProfile {
  return {
    tenantPhone,
    frameworks: [],
    activationGates: [],
    egressAllowlist: null,
    signedAgreements: [],
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export async function loadComplianceProfile(tenantPhone: string): Promise<ComplianceProfile | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_compliance_profiles?tenant_phone=eq.${cleanPhone}&limit=1`,
      { headers: headers() },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    const row = rows?.[0];
    if (!row) return null;

    // Story 6.8 — verify HMAC if signed. Phase A: legacy unsigned rows OK
    // (logged as warning). Phase B (post-backfill): treat unsigned as
    // tamper. A real mismatch on a signed row is ALWAYS an error.
    if (row.hmac) {
      try {
        const check = verifyRowHmac(
          {
            type: 'compliance_profile',
            tenant_phone: row.tenant_phone,
            frameworks: [...(row.frameworks ?? [])].sort(),
            signed_agreements: row.signed_agreements ?? [],
            activation_gates: [...(row.activation_gates ?? [])].sort(),
            egress_allowlist: row.egress_allowlist ? [...row.egress_allowlist].sort() : null,
          },
          row.hmac,
          { treatUnsignedAsLegacy: true },
        );
        if (!check.verified && check.reason === 'hmac_mismatch') {
          // Hard error — the row was tampered. Log governance.bypass via
          // the audit log. Fire-and-forget so the read still succeeds
          // (we surface the tampered data, but the audit trail is locked).
          console.error(`[compliance-profile] HMAC TAMPER DETECTED for ${row.tenant_phone}`);
          void (async () => {
            try {
              const { logAuditEvent } = await import('./audit-log');
              await logAuditEvent({
                tenantPhone: row.tenant_phone,
                actor: 'system',
                actorType: 'system',
                action: 'governance.bypass',
                resource: 'tenant_compliance_profiles',
                outcome: 'failure',
                payload: { detector: 'row_hmac', table: 'tenant_compliance_profiles' },
                redact: false,
              });
            } catch {}
          })();
        }
      } catch (err) {
        // HMAC_ROW_SECRET not configured or other compute failure.
        // Log but don't block the read.
        console.warn('[compliance-profile] HMAC verify exception:', err);
      }
    }

    return {
      tenantPhone: row.tenant_phone,
      frameworks: row.frameworks ?? [],
      activationGates: row.activation_gates ?? [],
      egressAllowlist: row.egress_allowlist,
      signedAgreements: row.signed_agreements ?? [],
      metadata: row.metadata ?? {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  } catch (err) {
    console.warn('[compliance-profile] load failed:', err);
    return null;
  }
}

export async function upsertComplianceProfile(
  tenantPhone: string,
  patch: Partial<Omit<ComplianceProfile, 'tenantPhone' | 'createdAt' | 'updatedAt'>>,
): Promise<ComplianceProfile | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');

    // Story 6.8 — compute HMAC over the FINAL row contents (merging the
    // patch against any existing row). Load-then-merge-then-sign so the
    // HMAC reflects what's actually being written.
    const existing = await loadComplianceProfile(cleanPhone);
    const merged: ComplianceProfile = {
      tenantPhone: cleanPhone,
      frameworks: patch.frameworks ?? existing?.frameworks ?? [],
      activationGates: patch.activationGates ?? existing?.activationGates ?? [],
      egressAllowlist: patch.egressAllowlist ?? existing?.egressAllowlist ?? null,
      signedAgreements: patch.signedAgreements ?? existing?.signedAgreements ?? [],
      metadata: patch.metadata ?? existing?.metadata ?? {},
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    let hmac: string | null = null;
    try {
      hmac = computeComplianceProfileHmac({
        tenant_phone: merged.tenantPhone,
        frameworks: merged.frameworks,
        signed_agreements: merged.signedAgreements,
        activation_gates: merged.activationGates,
        egress_allowlist: merged.egressAllowlist,
      });
    } catch (err) {
      // HMAC_ROW_SECRET not configured — log and continue. The row is
      // stored unsigned and counts as "legacy" until the secret is set
      // and a backfill runs.
      console.warn('[compliance-profile] HMAC compute failed (continuing unsigned):', err);
    }

    const body: Record<string, unknown> = {
      tenant_phone: cleanPhone,
      updated_at: merged.updatedAt,
      hmac,
    };
    if (patch.frameworks !== undefined) body.frameworks = patch.frameworks;
    if (patch.activationGates !== undefined) body.activation_gates = patch.activationGates;
    if (patch.egressAllowlist !== undefined) body.egress_allowlist = patch.egressAllowlist;
    if (patch.signedAgreements !== undefined) body.signed_agreements = patch.signedAgreements;
    if (patch.metadata !== undefined) body.metadata = patch.metadata;

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_compliance_profiles?on_conflict=tenant_phone`,
      {
        method: 'POST',
        headers: { ...headers(), Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      console.warn('[compliance-profile] upsert failed:', await res.text());
      return null;
    }
    const rows = await res.json();
    const row = rows?.[0];
    if (!row) return null;
    return {
      tenantPhone: row.tenant_phone,
      frameworks: row.frameworks ?? [],
      activationGates: row.activation_gates ?? [],
      egressAllowlist: row.egress_allowlist,
      signedAgreements: row.signed_agreements ?? [],
      metadata: row.metadata ?? {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  } catch (err) {
    console.warn('[compliance-profile] upsert exception:', err);
    return null;
  }
}

/**
 * Returns true if the tenant has any activation_gates open (e.g. unsigned BAA
 * for a HIPAA tenant). Callers gating tenant activation should consult this
 * before flipping agent_instances to running, or before allowing any
 * data-write operation.
 */
export async function isActivationBlocked(tenantPhone: string): Promise<{ blocked: boolean; gates: string[] }> {
  const profile = await loadComplianceProfile(tenantPhone);
  if (!profile) return { blocked: false, gates: [] };
  return {
    blocked: profile.activationGates.length > 0,
    gates: profile.activationGates,
  };
}

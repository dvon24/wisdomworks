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
    const body: Record<string, unknown> = {
      tenant_phone: cleanPhone,
      updated_at: new Date().toISOString(),
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

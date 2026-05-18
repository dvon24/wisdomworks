/**
 * Story 6.12 Part 2 — Compliance Matrix.
 *
 * Part 1 (already shipped) gave us a profile per tenant: which
 * frameworks they've selected, which agreements they've signed, what
 * activation_gates are open, and an egress allowlist.
 *
 * Part 2 (this file) closes the loop:
 *
 *   1. Declarative requirement spec per framework — "HIPAA requires
 *      a signed BAA + audit logging + PII redaction + breach-notification
 *      capability." Spec lives in code, not the DB, so requirement
 *      changes ship as code changes (auditable via git).
 *
 *   2. computeComplianceStatus(tenantPhone) — walks each framework
 *      the tenant has selected, evaluates each requirement against
 *      the tenant's current state (signed agreements, platform
 *      capabilities), returns per-requirement met/unmet.
 *
 *   3. deriveActivationGates(matrix) — converts unmet-and-blocking
 *      requirements into activation_gates strings the existing
 *      isActivationBlocked() helper already checks.
 *
 * The matrix is the SHIP DECISION input for compliance-bound tenants:
 * if any requirement is unmet AND `blocks_activation` is true, the
 * tenant's agents can't go live. The admin endpoint surfaces this
 * for review before activation.
 */

import {
  loadComplianceProfile,
  type ComplianceFramework,
  type ComplianceProfile,
  type SignedAgreement,
} from './compliance-profile';

// ─── Requirement spec ──────────────────────────────────────────────────

export type RequirementCheckKind =
  /** Tenant must have a signed_agreement with kind=X */
  | 'signed_agreement'
  /** Platform-level capability (always-true for us — e.g. "audit log
   *  exists"). Use this for documentation; the assertion is that we
   *  the platform vendor provide it. */
  | 'platform_capability'
  /** A field on metadata must be set + truthy (e.g. dataResidency,
   *  retentionPolicyDays) */
  | 'metadata_field'
  /** Egress allowlist must be configured (not null) */
  | 'egress_restricted';

export interface ComplianceRequirement {
  /** Stable id for the requirement. Used to compute activation gate strings. */
  id: string;
  /** Short human label for the matrix UI. */
  label: string;
  /** Longer-form description of why this matters. */
  rationale: string;
  /** What the platform provides automatically (so the owner knows
   *  what they DON'T have to configure). */
  platform_provides?: string;
  /** What the tenant has to do (e.g., sign a BAA). Empty when the
   *  platform handles it entirely. */
  tenant_action?: string;
  /** Whether this requirement blocks tenant activation when unmet.
   *  Some controls are "should-have" not "must-have." */
  blocks_activation: boolean;
  check: {
    kind: RequirementCheckKind;
    /** Spec varies by check kind. */
    args?: any;
  };
}

export interface FrameworkSpec {
  framework: ComplianceFramework;
  label: string;
  scope: string;
  requirements: ComplianceRequirement[];
}

/**
 * Per-framework requirement specs. Tight + declarative on purpose —
 * adding a control = one entry. Adding a framework = one block. No
 * runtime DB shape to coordinate.
 *
 * These specs are deliberately CONSERVATIVE — they encode what the
 * platform already provides + what the tenant must add. They are NOT
 * a substitute for legal review with the customer's compliance team.
 */
export const FRAMEWORK_SPECS: Record<ComplianceFramework, FrameworkSpec> = {
  gdpr: {
    framework: 'gdpr',
    label: 'GDPR (EU)',
    scope: 'Personal data of EU data subjects',
    requirements: [
      {
        id: 'gdpr.dpa_signed',
        label: 'Signed Data Processing Agreement',
        rationale: 'Article 28 — controller-to-processor relationship requires written DPA.',
        tenant_action: 'Sign WisdomWorks DPA template (one-time, before tenant activates).',
        blocks_activation: true,
        check: { kind: 'signed_agreement', args: { kind: 'dpa' } },
      },
      {
        id: 'gdpr.export_capability',
        label: 'Data export (Article 15 / 20)',
        rationale: 'Data subject access + portability rights.',
        platform_provides: '/api/compliance/export endpoint (Story 6.7) returns all tenant data as JSON.',
        blocks_activation: false,
        check: { kind: 'platform_capability' },
      },
      {
        id: 'gdpr.deletion_capability',
        label: 'Right to be forgotten (Article 17)',
        rationale: 'Data subject deletion rights.',
        platform_provides: '/api/compliance/delete endpoint (Story 6.7) hard-deletes tenant rows.',
        blocks_activation: false,
        check: { kind: 'platform_capability' },
      },
      {
        id: 'gdpr.audit_log',
        label: 'Tamper-evident audit log (Article 30)',
        rationale: 'Records-of-processing requirement.',
        platform_provides: 'Hash-chained audit log (Story 6.4) covers every tenant-data mutation.',
        blocks_activation: false,
        check: { kind: 'platform_capability' },
      },
    ],
  },
  ccpa: {
    framework: 'ccpa',
    label: 'CCPA / CPRA (California)',
    scope: 'Personal information of California residents',
    requirements: [
      {
        id: 'ccpa.export_capability',
        label: 'Right to know (Cal. Civ. Code § 1798.110)',
        rationale: 'Consumer right to access personal info collected.',
        platform_provides: '/api/compliance/export endpoint.',
        blocks_activation: false,
        check: { kind: 'platform_capability' },
      },
      {
        id: 'ccpa.deletion_capability',
        label: 'Right to delete (§ 1798.105)',
        rationale: 'Consumer right to deletion.',
        platform_provides: '/api/compliance/delete endpoint.',
        blocks_activation: false,
        check: { kind: 'platform_capability' },
      },
    ],
  },
  hipaa: {
    framework: 'hipaa',
    label: 'HIPAA (US health data)',
    scope: 'Protected Health Information (PHI)',
    requirements: [
      {
        id: 'hipaa.baa_signed',
        label: 'Signed Business Associate Agreement',
        rationale: '45 CFR 164.502 — BA cannot create/use/disclose PHI without a BAA.',
        tenant_action: 'Sign WisdomWorks BAA template before tenant activates. BAA must be in place BEFORE any PHI flows.',
        blocks_activation: true,
        check: { kind: 'signed_agreement', args: { kind: 'baa' } },
      },
      {
        id: 'hipaa.encryption_at_rest',
        label: 'Encryption at rest',
        rationale: '45 CFR 164.312(a)(2)(iv) — implementation specification.',
        platform_provides: 'Supabase Postgres + Storage encrypt at rest. Sensitive tokens additionally AES-256-GCM encrypted (Story 6.3).',
        blocks_activation: false,
        check: { kind: 'platform_capability' },
      },
      {
        id: 'hipaa.encryption_in_transit',
        label: 'Encryption in transit',
        rationale: '45 CFR 164.312(e)(2)(ii) — transmission security.',
        platform_provides: 'TLS enforced for every external endpoint (Vercel + Supabase).',
        blocks_activation: false,
        check: { kind: 'platform_capability' },
      },
      {
        id: 'hipaa.audit_controls',
        label: 'Audit controls (164.312(b))',
        rationale: 'Hardware/software/procedural mechanisms that record activity.',
        platform_provides: 'Hash-chained audit log (Story 6.4) — tamper-evident, includes all admin actions, auth events, and tenant-data mutations.',
        blocks_activation: false,
        check: { kind: 'platform_capability' },
      },
      {
        id: 'hipaa.access_controls',
        label: 'Access controls (164.312(a)(1))',
        rationale: 'Unique user identification + emergency access procedure.',
        platform_provides: 'Per-tenant magic-link auth via Iris (Story 6.1) + service-role API for admin operations. RLS-style guards on every tenant-data route.',
        blocks_activation: false,
        check: { kind: 'platform_capability' },
      },
      {
        id: 'hipaa.breach_notification_prep',
        label: 'Breach-notification readiness',
        rationale: '45 CFR 164.404 — covered entity must notify individuals within 60 days.',
        platform_provides: 'Hash-chained audit log gives forensic timeline. Incident response runbook in docs/security/.',
        tenant_action: 'Tenant (the covered entity) is responsible for the notification itself.',
        blocks_activation: false,
        check: { kind: 'platform_capability' },
      },
    ],
  },
  pci_dss: {
    framework: 'pci_dss',
    label: 'PCI-DSS (payment card data)',
    scope: 'Cardholder data',
    requirements: [
      {
        id: 'pci.no_card_storage',
        label: 'Never store cardholder data',
        rationale: 'Requirement 3 — protect stored cardholder data. Our posture: never accept it.',
        platform_provides: 'All payment processing goes through Stripe; raw card data never touches WisdomWorks infrastructure. PII redactor strips any card-shaped numbers via Luhn check (packages/shared/src/privacy/redact.ts).',
        blocks_activation: false,
        check: { kind: 'platform_capability' },
      },
    ],
  },
  soc2_type1: {
    framework: 'soc2_type1',
    label: 'SOC 2 Type 1',
    scope: 'Security/availability controls at a point in time',
    requirements: [
      {
        id: 'soc2.audit_log',
        label: 'Logging + monitoring',
        rationale: 'CC7.2 — system activity logged for detection of anomalous activity.',
        platform_provides: 'Hash-chained audit log (Story 6.4).',
        blocks_activation: false,
        check: { kind: 'platform_capability' },
      },
      {
        id: 'soc2.access_controls',
        label: 'Logical access',
        rationale: 'CC6.1 — logical access controls in place.',
        platform_provides: 'Per-tenant auth + RLS-equivalent guards on every route (Story 6.1, 6.2).',
        blocks_activation: false,
        check: { kind: 'platform_capability' },
      },
      {
        id: 'soc2.backup_recovery',
        label: 'Backup + recovery drill',
        rationale: 'A1.2 — recovery capability tested.',
        platform_provides: 'Daily snapshots (Story 2.10) + monthly recovery drill cadence (Story 6.6 — see SECURITY.md).',
        blocks_activation: false,
        check: { kind: 'platform_capability' },
      },
    ],
  },
  soc2_type2: {
    framework: 'soc2_type2',
    label: 'SOC 2 Type 2',
    scope: 'Security/availability controls over a 6+ month period',
    requirements: [
      // Type 2 inherits Type 1 + adds operating-effectiveness over time.
      // We surface the same requirements; the auditor evaluates evidence.
      {
        id: 'soc2.audit_log',
        label: 'Logging + monitoring (continuous)',
        rationale: 'CC7.2 — continuously evidenced over the audit period.',
        platform_provides: 'Hash-chained audit log + tamper-proof storage retains evidence across audit period.',
        blocks_activation: false,
        check: { kind: 'platform_capability' },
      },
      {
        id: 'soc2.backup_recovery_drilled',
        label: 'Backup recovery drilled monthly',
        rationale: 'A1.2 — recovery capability TESTED, not just claimed.',
        platform_provides: 'Recovery drill endpoint + cadence documented in SECURITY.md (Story 6.6). Each drill is audit-logged.',
        blocks_activation: false,
        check: { kind: 'platform_capability' },
      },
    ],
  },
  iso_27001: {
    framework: 'iso_27001',
    label: 'ISO/IEC 27001',
    scope: 'Information security management system',
    requirements: [
      {
        id: 'iso.access_control_policy',
        label: 'Access control policy (A.5.15)',
        rationale: 'Annex A.5.15 — access control policy and access rights to assets.',
        platform_provides: 'Per-tenant auth + role-scoped admin overrides (Story 6.1).',
        blocks_activation: false,
        check: { kind: 'platform_capability' },
      },
      {
        id: 'iso.cryptographic_controls',
        label: 'Cryptographic controls (A.8.24)',
        rationale: 'Use of cryptography for confidentiality + integrity.',
        platform_provides: 'TLS in transit, encryption at rest, HMAC integrity on sensitive rows, AES-256-GCM for tokens (Stories 6.3, 6.8).',
        blocks_activation: false,
        check: { kind: 'platform_capability' },
      },
    ],
  },
  sox: {
    framework: 'sox',
    label: 'SOX (Sarbanes-Oxley)',
    scope: 'Financial reporting controls (public US companies)',
    requirements: [
      {
        id: 'sox.audit_log_integrity',
        label: 'Tamper-evident audit log (Section 404)',
        rationale: 'Internal controls over financial reporting.',
        platform_provides: 'Hash-chained audit log + row HMACs (Stories 6.4, 6.8). Tampering is detectable.',
        blocks_activation: false,
        check: { kind: 'platform_capability' },
      },
      {
        id: 'sox.access_separation',
        label: 'Separation of duties',
        rationale: 'Section 404 control objectives.',
        tenant_action: 'Tenant must configure agent roles such that the same agent does not both initiate AND approve financial actions. WisdomWorks supports this via L1/L2 approval gates.',
        blocks_activation: false,
        check: { kind: 'platform_capability' },
      },
    ],
  },
  fedramp_low: {
    framework: 'fedramp_low',
    label: 'FedRAMP Low',
    scope: 'US government data with low-impact baseline',
    requirements: [
      {
        id: 'fedramp.egress_restricted',
        label: 'Egress allowlist (boundary control)',
        rationale: 'Government environments cannot send data to arbitrary third parties.',
        tenant_action: 'Configure egress_allowlist explicitly (no nulls). All outbound calls validated against this list.',
        blocks_activation: true,
        check: { kind: 'egress_restricted' },
      },
      {
        id: 'fedramp.audit_log',
        label: 'AU-2 Auditable events',
        rationale: 'Define + log auditable events.',
        platform_provides: 'Hash-chained audit log covers admin, auth, tenant-data, governance.bypass events.',
        blocks_activation: false,
        check: { kind: 'platform_capability' },
      },
    ],
  },
  fedramp_mod: {
    framework: 'fedramp_mod',
    label: 'FedRAMP Moderate',
    scope: 'US government data with moderate-impact baseline',
    requirements: [
      {
        id: 'fedramp.egress_restricted',
        label: 'Egress allowlist (boundary control)',
        rationale: 'Government environments cannot send data to arbitrary third parties.',
        tenant_action: 'Configure egress_allowlist explicitly. All outbound calls validated against this list.',
        blocks_activation: true,
        check: { kind: 'egress_restricted' },
      },
      {
        id: 'fedramp.audit_log',
        label: 'AU-2 Auditable events + AU-6 review',
        rationale: 'Define + log + review auditable events.',
        platform_provides: 'Hash-chained audit log. Verification RPC for integrity check.',
        blocks_activation: false,
        check: { kind: 'platform_capability' },
      },
      {
        id: 'fedramp.encryption_inflight',
        label: 'SC-8 Transmission confidentiality',
        rationale: 'TLS for all sensitive transmissions.',
        platform_provides: 'TLS enforced.',
        blocks_activation: false,
        check: { kind: 'platform_capability' },
      },
    ],
  },
  fedramp_high: {
    framework: 'fedramp_high',
    label: 'FedRAMP High',
    scope: 'US government data with high-impact baseline (typically air-gapped tenant deployments)',
    requirements: [
      {
        id: 'fedramp_high.air_gap_deployment',
        label: 'Air-gapped tenant deployment',
        rationale: 'FedRAMP High deployments are typically isolated — no cross-tenant skill sharing, no cross-region failover, no third-party egress.',
        tenant_action: 'This tier requires a dedicated deployment topology — contact WisdomWorks for the air-gap deployment playbook. Multi-tenant Cloud is NOT FedRAMP High eligible.',
        blocks_activation: true,
        check: { kind: 'metadata_field', args: { field: 'air_gap_deployment_confirmed', expectTruthy: true } },
      },
    ],
  },
};

// ─── Computation ───────────────────────────────────────────────────────

export interface RequirementStatus {
  requirement: ComplianceRequirement;
  met: boolean;
  reason?: string;
}

export interface FrameworkStatus {
  framework: ComplianceFramework;
  label: string;
  total: number;
  met: number;
  unmet: number;
  blockingUnmet: number;
  requirements: RequirementStatus[];
}

export interface ComplianceMatrix {
  tenantPhone: string;
  computedAt: string;
  frameworks: FrameworkStatus[];
  derivedActivationGates: string[];
  blocked: boolean;
}

/** Evaluate a single requirement against the tenant's profile. */
function evaluateRequirement(req: ComplianceRequirement, profile: ComplianceProfile): RequirementStatus {
  switch (req.check.kind) {
    case 'platform_capability':
      // Always met — the platform provides it.
      return { requirement: req, met: true, reason: 'platform-provided' };
    case 'signed_agreement': {
      const wantKind = req.check.args?.kind;
      const found = profile.signedAgreements.find((s: SignedAgreement) => s.kind === wantKind);
      return {
        requirement: req,
        met: !!found,
        reason: found ? `signed ${found.signed_at}` : `no signed_agreements row with kind="${wantKind}"`,
      };
    }
    case 'metadata_field': {
      const field = req.check.args?.field;
      const expectTruthy = req.check.args?.expectTruthy ?? true;
      const val = (profile.metadata as any)?.[field];
      const truthy = !!val;
      return {
        requirement: req,
        met: expectTruthy ? truthy : !truthy,
        reason: `metadata.${field} = ${JSON.stringify(val)}`,
      };
    }
    case 'egress_restricted':
      return {
        requirement: req,
        met: Array.isArray(profile.egressAllowlist) && profile.egressAllowlist.length > 0,
        reason:
          profile.egressAllowlist === null
            ? 'egress_allowlist is null (unrestricted)'
            : `egress_allowlist has ${profile.egressAllowlist.length} entries`,
      };
    default:
      return { requirement: req, met: false, reason: `unknown check kind: ${(req.check as any).kind}` };
  }
}

/**
 * Compute the full compliance matrix for a tenant. The matrix includes
 * every framework the tenant has selected, with each requirement
 * evaluated as met/unmet. Derived activation gates are the ids of
 * `blocks_activation && !met` requirements — these are the things
 * that prevent agent activation.
 */
export async function computeComplianceStatus(tenantPhone: string): Promise<ComplianceMatrix> {
  const profile = await loadComplianceProfile(tenantPhone);
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  if (!profile || profile.frameworks.length === 0) {
    return {
      tenantPhone: cleanPhone,
      computedAt: new Date().toISOString(),
      frameworks: [],
      derivedActivationGates: [],
      blocked: false,
    };
  }

  const frameworkStatuses: FrameworkStatus[] = [];
  const derivedGates: string[] = [];

  for (const fw of profile.frameworks) {
    const spec = FRAMEWORK_SPECS[fw];
    if (!spec) continue;
    const reqStatuses = spec.requirements.map((r) => evaluateRequirement(r, profile));
    const met = reqStatuses.filter((r) => r.met).length;
    const unmet = reqStatuses.filter((r) => !r.met).length;
    const blockingUnmet = reqStatuses.filter((r) => !r.met && r.requirement.blocks_activation).length;
    for (const rs of reqStatuses) {
      if (!rs.met && rs.requirement.blocks_activation) {
        derivedGates.push(rs.requirement.id);
      }
    }
    frameworkStatuses.push({
      framework: fw,
      label: spec.label,
      total: spec.requirements.length,
      met,
      unmet,
      blockingUnmet,
      requirements: reqStatuses,
    });
  }

  return {
    tenantPhone: cleanPhone,
    computedAt: new Date().toISOString(),
    frameworks: frameworkStatuses,
    derivedActivationGates: Array.from(new Set(derivedGates)).sort(),
    blocked: derivedGates.length > 0,
  };
}

/**
 * Derive activation_gates from the matrix and (optionally) push them
 * back to the tenant_compliance_profiles row. Idempotent — re-running
 * after the owner signs a BAA naturally clears the gate.
 */
export async function syncDerivedActivationGates(tenantPhone: string): Promise<{
  matrix: ComplianceMatrix;
  gates_persisted: boolean;
}> {
  const matrix = await computeComplianceStatus(tenantPhone);
  if (matrix.frameworks.length === 0) {
    return { matrix, gates_persisted: false };
  }
  const { upsertComplianceProfile } = await import('./compliance-profile');
  const persisted = await upsertComplianceProfile(tenantPhone, {
    activationGates: matrix.derivedActivationGates,
  });
  return { matrix, gates_persisted: !!persisted };
}

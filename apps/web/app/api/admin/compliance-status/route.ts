/**
 * GET /api/admin/compliance-status?phone=<tenant>&sync=true
 *   Bearer OWNER_API_TOKEN
 *
 * Epic 6.12 Part 2 — Compliance Matrix surface.
 *
 * Returns the full compliance matrix for a tenant:
 *   - Per-framework status (met / unmet / blocking-unmet counts)
 *   - Per-requirement evaluation with the reason
 *   - Derived activation_gates (the things that block tenant activation)
 *   - blocked: true if ANY blocking requirement is unmet
 *
 * When ?sync=true, also persists the derived gates back to the
 * tenant_compliance_profiles row so isActivationBlocked() reflects
 * the truth without a manual write.
 *
 * Use this:
 *   - Before activating a compliance-bound tenant (HIPAA, FedRAMP, etc.)
 *     to see what's still missing.
 *   - As an audit artifact during a SOC 2 / HIPAA assessment ("show
 *     me your controls matrix").
 *   - On a schedule (manual today, automatable later) to spot tenants
 *     who've drifted out of compliance.
 *
 * NOT a substitute for legal review. These specs encode what the
 * PLATFORM provides; the tenant's compliance team still needs to
 * sign off on their own posture.
 */

import { computeComplianceStatus, syncDerivedActivationGates, FRAMEWORK_SPECS } from '../../_lib/compliance-matrix';
import { logAuditEvent } from '../../_lib/audit-log';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(request: Request) {
  const auth = request.headers.get('authorization');
  const ownerToken = process.env.OWNER_API_TOKEN;
  if (!ownerToken || !auth?.startsWith('Bearer ') || auth.slice(7) !== ownerToken) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const phone = url.searchParams.get('phone');
  if (!phone) {
    return Response.json({
      error: 'phone query param required (e.g. ?phone=491703604562)',
      hint: 'GET /api/admin/compliance-status?phone=<tenant>&sync=true to also persist derived gates.',
      available_frameworks: Object.keys(FRAMEWORK_SPECS),
    }, { status: 400 });
  }

  const sync = url.searchParams.get('sync') === 'true';
  const cleanPhone = phone.replace(/[\s\-+()]/g, '');

  try {
    let matrix;
    let gatesPersisted = false;
    if (sync) {
      const out = await syncDerivedActivationGates(cleanPhone);
      matrix = out.matrix;
      gatesPersisted = out.gates_persisted;
    } else {
      matrix = await computeComplianceStatus(cleanPhone);
    }

    // Audit the access — compliance status reads are themselves
    // sensitive (they reveal where gates are missing).
    void logAuditEvent({
      tenantPhone: cleanPhone,
      actor: 'admin (OWNER_API_TOKEN)',
      actorType: 'admin',
      action: 'admin.api_call',
      resource: '/api/admin/compliance-status',
      outcome: 'success',
      payload: {
        endpoint: '/api/admin/compliance-status',
        sync,
        frameworks_evaluated: matrix.frameworks.length,
        derived_gates_count: matrix.derivedActivationGates.length,
        blocked: matrix.blocked,
      },
    });

    // English interpretation so a tired-Devon doesn't need to parse the matrix
    let interpretation: string;
    if (matrix.frameworks.length === 0) {
      interpretation = 'No compliance frameworks selected for this tenant. To enable: set tenant_compliance_profiles.frameworks to e.g. ["gdpr", "soc2_type1"] for this phone.';
    } else if (matrix.blocked) {
      const blockingItems = matrix.frameworks
        .flatMap((f) => f.requirements.filter((r) => !r.met && r.requirement.blocks_activation))
        .map((r) => `${r.requirement.label}: ${r.reason}`);
      interpretation = `🚨 BLOCKED. ${matrix.derivedActivationGates.length} blocking requirement(s) unmet. Tenant should NOT be activated until resolved:\n${blockingItems.map((b) => '  • ' + b).join('\n')}`;
    } else {
      const totalReqs = matrix.frameworks.reduce((s, f) => s + f.total, 0);
      const totalMet = matrix.frameworks.reduce((s, f) => s + f.met, 0);
      interpretation = `✓ Eligible for activation. ${totalMet}/${totalReqs} requirements met across ${matrix.frameworks.length} framework${matrix.frameworks.length === 1 ? '' : 's'}. Any non-blocking unmet items are recommendations, not gates.`;
    }

    return Response.json({
      ...matrix,
      sync_requested: sync,
      gates_persisted_to_db: gatesPersisted,
      interpretation,
      legal_disclaimer:
        'This matrix reflects platform-side controls + tenant-supplied configuration. It is NOT a substitute for legal review with the customer\'s compliance team. Framework requirement specs live in apps/web/app/api/_lib/compliance-matrix.ts and ship as code changes (auditable via git).',
    });
  } catch (err: any) {
    console.error('[compliance-status] error:', err);
    return Response.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}

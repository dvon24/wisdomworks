/**
 * Story 6.8 — Admin HMAC verification sweep.
 *
 * GET /api/admin/verify-row-hmacs
 *   ?table=tenant_compliance_profiles   (optional — default: scan all 3)
 *
 * Walks each row in the in-scope tables, recomputes its HMAC, and reports:
 *   - inventory:  counts from row_hmac_inventory() RPC
 *   - tampered:   list of row ids whose stored HMAC doesn't match the
 *                 recomputed value
 *
 * Admin-gated. Run periodically (manual or cron) to detect tampering
 * that bypassed the audit chain. Pairs with Story 6.4: the audit log
 * is the primary integrity surface, this RPC is the belt-and-suspenders
 * row-level cross-check.
 *
 * Phase A scope: scans tenant_compliance_profiles only (the table that
 * has the HMAC write wired in). oauth_connections + project_connections
 * are covered by the migration but the write paths aren't wired yet —
 * those would all show "legacy_unsigned" today.
 */

import {
  verifyRowHmac,
  computeComplianceProfileHmac,
} from '@wisdomworks/shared';
import { logAuditEvent } from '../../_lib/audit-log';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

export async function GET(request: Request) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return Response.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  const auth = request.headers.get('authorization');
  const ownerToken = process.env.OWNER_API_TOKEN;
  if (!ownerToken || !auth?.startsWith('Bearer ') || auth.slice(7) !== ownerToken) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!process.env.HMAC_ROW_SECRET) {
    return Response.json(
      { error: 'HMAC_ROW_SECRET not configured. Set it in Vercel env vars before running this scan.' },
      { status: 503 },
    );
  }

  try {
    // 1) Inventory — count signed/unsigned per table.
    const invRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/row_hmac_inventory`, {
      method: 'POST',
      headers: headers(),
      body: '{}',
    });
    const inventory = invRes.ok ? await invRes.json() : [];

    // 2) Walk tenant_compliance_profiles and verify each signed row.
    const tampered: Array<{ tenant_phone: string; reason: string }> = [];
    const unsigned: string[] = [];

    const profRes = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_compliance_profiles?select=tenant_phone,frameworks,signed_agreements,activation_gates,egress_allowlist,hmac`,
      { headers: headers() },
    );
    if (profRes.ok) {
      const rows = await profRes.json();
      for (const row of rows as any[]) {
        if (!row.hmac) {
          unsigned.push(row.tenant_phone);
          continue;
        }
        const recomputed = computeComplianceProfileHmac({
          tenant_phone: row.tenant_phone,
          frameworks: [...(row.frameworks ?? [])].sort(),
          signed_agreements: row.signed_agreements ?? [],
          activation_gates: [...(row.activation_gates ?? [])].sort(),
          egress_allowlist: row.egress_allowlist ? [...row.egress_allowlist].sort() : null,
        });
        // verifyRowHmac handles the comparison so test mode (treatUnsignedAsLegacy)
        // is consistent with the load path.
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
          tampered.push({ tenant_phone: row.tenant_phone, reason: check.reason });
          // Audit each tamper.
          void logAuditEvent({
            tenantPhone: row.tenant_phone,
            actor: 'admin (verify-row-hmacs)',
            actorType: 'admin',
            action: 'governance.bypass',
            resource: 'tenant_compliance_profiles',
            outcome: 'failure',
            payload: { detector: 'row_hmac_sweep', expected_hmac_prefix: recomputed.slice(0, 16), stored_hmac_prefix: row.hmac.slice(0, 16) },
            redact: false,
          });
        }
      }
    }

    return Response.json({
      scanned_at: new Date().toISOString(),
      inventory,
      tampered,
      unsigned_count: unsigned.length,
      unsigned_sample: unsigned.slice(0, 20),
      // tenant_compliance_profiles is the only table fully wired in Phase A.
      // oauth_connections + project_connections are in the schema but their
      // write paths haven't been wired yet — those would show all-legacy here.
      coverage_note: 'Phase A: tenant_compliance_profiles fully wired. oauth_connections + project_connections await Phase B write-path wiring + backfill.',
    });
  } catch (err: any) {
    console.error('[verify-row-hmacs] error:', err);
    return Response.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}

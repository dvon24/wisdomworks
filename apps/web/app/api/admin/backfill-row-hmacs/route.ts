/**
 * Story 6.8 Phase B — backfill HMACs on legacy oauth_connections +
 * tenant_compliance_profiles rows.
 *
 * POST /api/admin/backfill-row-hmacs
 *   Bearer OWNER_API_TOKEN
 *
 * Walks each tracked table, computes the row's canonical HMAC using
 * @wisdomworks/shared/computeXxxHmac, writes it back. Idempotent — rows
 * that already have a valid HMAC are left alone unless ?force=true is
 * passed.
 *
 * After a successful backfill, the verify-row-hmacs endpoint should
 * report 0 unsigned rows and 0 tampered rows. From that point forward,
 * any unsigned row is anomalous (someone bypassed the write helpers)
 * and any tampered row is a real integrity break.
 *
 * Audit-logged via the hash-chained ledger so the backfill itself is
 * tamper-evident.
 */

import {
  verifyRowHmac,
  computeComplianceProfileHmac,
  computeOAuthConnectionHmac,
} from '@wisdomworks/shared';
import { logAuditEvent } from '../../_lib/audit-log';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

export async function POST(request: Request) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return Response.json({ error: 'Supabase not configured' }, { status: 500 });
  }
  const auth = request.headers.get('authorization');
  const ownerToken = process.env.OWNER_API_TOKEN;
  if (!ownerToken || !auth?.startsWith('Bearer ') || auth.slice(7) !== ownerToken) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!process.env.HMAC_ROW_SECRET) {
    return Response.json({ error: 'HMAC_ROW_SECRET not configured. Set in Vercel env vars first.' }, { status: 503 });
  }

  const url = new URL(request.url);
  const force = url.searchParams.get('force') === 'true';

  const results = {
    oauth_connections: { scanned: 0, signed: 0, skipped_already_valid: 0, errored: 0 },
    tenant_compliance_profiles: { scanned: 0, signed: 0, skipped_already_valid: 0, errored: 0 },
  };

  try {
    // ─── oauth_connections ──────────────────────────────────────────────
    const oauthRes = await fetch(
      `${SUPABASE_URL}/rest/v1/oauth_connections?select=phone_number,provider,service,account_email,access_token,refresh_token,status,hmac`,
      { headers: headers() },
    );
    if (oauthRes.ok) {
      const rows = await oauthRes.json();
      for (const row of rows as any[]) {
        results.oauth_connections.scanned++;

        // If already has a valid HMAC and not forcing, skip.
        if (row.hmac && !force) {
          const check = verifyRowHmac(
            {
              type: 'oauth_connection',
              phone_number: row.phone_number,
              provider: row.provider,
              service: row.service,
              account_email: row.account_email,
              access_token: row.access_token,
              refresh_token: row.refresh_token,
              status: row.status,
            },
            row.hmac,
            { treatUnsignedAsLegacy: false },
          );
          if (check.verified) {
            results.oauth_connections.skipped_already_valid++;
            continue;
          }
        }

        try {
          const newHmac = computeOAuthConnectionHmac({
            phone_number: row.phone_number,
            provider: row.provider,
            service: row.service,
            account_email: row.account_email,
            access_token: row.access_token,
            refresh_token: row.refresh_token,
            status: row.status,
          });
          const patchRes = await fetch(
            `${SUPABASE_URL}/rest/v1/oauth_connections?phone_number=eq.${row.phone_number}&provider=eq.${row.provider}&service=eq.${row.service}`,
            {
              method: 'PATCH',
              headers: { ...headers(), Prefer: 'return=minimal' },
              body: JSON.stringify({ hmac: newHmac }),
            },
          );
          if (patchRes.ok) results.oauth_connections.signed++;
          else results.oauth_connections.errored++;
        } catch (err) {
          console.warn(`[backfill-hmacs] oauth row failed for ${row.phone_number}/${row.provider}/${row.service}:`, err);
          results.oauth_connections.errored++;
        }
      }
    }

    // ─── tenant_compliance_profiles ─────────────────────────────────────
    const complianceRes = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_compliance_profiles?select=tenant_phone,frameworks,signed_agreements,activation_gates,egress_allowlist,hmac`,
      { headers: headers() },
    );
    if (complianceRes.ok) {
      const rows = await complianceRes.json();
      for (const row of rows as any[]) {
        results.tenant_compliance_profiles.scanned++;
        if (row.hmac && !force) {
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
            { treatUnsignedAsLegacy: false },
          );
          if (check.verified) {
            results.tenant_compliance_profiles.skipped_already_valid++;
            continue;
          }
        }
        try {
          const newHmac = computeComplianceProfileHmac({
            tenant_phone: row.tenant_phone,
            frameworks: row.frameworks ?? [],
            signed_agreements: row.signed_agreements ?? [],
            activation_gates: row.activation_gates ?? [],
            egress_allowlist: row.egress_allowlist,
          });
          const patchRes = await fetch(
            `${SUPABASE_URL}/rest/v1/tenant_compliance_profiles?tenant_phone=eq.${row.tenant_phone}`,
            {
              method: 'PATCH',
              headers: { ...headers(), Prefer: 'return=minimal' },
              body: JSON.stringify({ hmac: newHmac }),
            },
          );
          if (patchRes.ok) results.tenant_compliance_profiles.signed++;
          else results.tenant_compliance_profiles.errored++;
        } catch (err) {
          console.warn(`[backfill-hmacs] compliance row failed for ${row.tenant_phone}:`, err);
          results.tenant_compliance_profiles.errored++;
        }
      }
    }

    // Audit the backfill itself.
    void logAuditEvent({
      tenantPhone: 'system',  // global admin operation, not tenant-scoped
      actor: 'admin (backfill-row-hmacs)',
      actorType: 'admin',
      action: 'admin.config_change',
      resource: '/api/admin/backfill-row-hmacs',
      outcome: 'success',
      payload: { force, results },
      redact: false,
    });

    return Response.json({
      backfilled_at: new Date().toISOString(),
      force,
      results,
      next_step: 'Hit GET /api/admin/verify-row-hmacs to confirm 0 unsigned rows remain.',
    });
  } catch (err: any) {
    console.error('[backfill-row-hmacs] error:', err);
    return Response.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}

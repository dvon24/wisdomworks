/**
 * POST /api/admin/regenerate-org-doc
 *
 * Re-runs documentOrganization for a tenant without going through the
 * full deploy-complete flow. Useful when the doc generator's output
 * gets improved (grammar fixes, dedup logic, etc.) and we want existing
 * tenants to pick up the cleaner output without redeploying.
 *
 * Body: { phone: string }
 *
 * Core logic lives in _lib/regenerate-org-doc.ts so the WhatsApp
 * team-mutation tools can call it directly after add/remove/rename.
 */

import { regenerateOrgDoc } from '../../_lib/regenerate-org-doc';
import { logAuditEvent } from '../../_lib/audit-log';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(request: Request) {
  // Story 6.1 — admin-only
  const auth = request.headers.get('authorization');
  const ownerToken = process.env.OWNER_API_TOKEN;
  if (!ownerToken || !auth?.startsWith('Bearer ') || auth.slice(7) !== ownerToken) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  let phone: string | undefined;
  try {
    const body = await request.json();
    phone = body?.phone;
    if (!phone) return Response.json({ error: 'phone required' }, { status: 400 });

    const result = await regenerateOrgDoc(phone);

    // Story 6.4 — append to the hash-chained audit log. Admin actions are
    // the highest-leverage audit target: they change tenant data via an
    // elevated bearer token, so a tamper-evident trail of every admin call
    // is the foundation of any future SOC 2 / HIPAA attestation.
    void logAuditEvent({
      tenantPhone: String(phone).replace(/[\s\-+()]/g, ''),
      actor: 'admin (OWNER_API_TOKEN)',
      actorType: 'admin',
      action: 'admin.api_call',
      resource: '/api/admin/regenerate-org-doc',
      outcome: result.ok ? 'success' : 'failure',
      payload: {
        endpoint: '/api/admin/regenerate-org-doc',
        integrations_count: result.integrations_count,
        agents_count: result.agents_count,
        ontology_action: result.action,
        error: result.error,
      },
    });

    if (!result.ok) {
      return Response.json({ error: result.error }, { status: 500 });
    }
    return Response.json({
      success: true,
      integrations_count: result.integrations_count,
      agents_count: result.agents_count,
      action: result.action,
    });
  } catch (err: any) {
    console.error('[regenerate-org-doc] error:', err);
    if (phone) {
      void logAuditEvent({
        tenantPhone: String(phone).replace(/[\s\-+()]/g, ''),
        actor: 'admin (OWNER_API_TOKEN)',
        actorType: 'admin',
        action: 'admin.api_call',
        resource: '/api/admin/regenerate-org-doc',
        outcome: 'failure',
        payload: { endpoint: '/api/admin/regenerate-org-doc', error: err?.message ?? String(err) },
      });
    }
    return Response.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}

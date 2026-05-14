/**
 * Story 6.7 — GDPR/CCPA Right-to-Be-Forgotten.
 *
 * POST /api/compliance/delete
 * Body: { phone: string, confirm: "PERMANENTLY DELETE <phone>" }
 *
 * Cascades the delete_tenant_data RPC, which removes every tenant-scoped
 * row across all tables EXCEPT:
 *   unified_audit_log      (audit trail — append-only by design)
 *   credential_access_log  (audit trail)
 *   overage_events         (billing record — legal retention)
 *
 * The deletion itself is recorded in unified_audit_log BEFORE the delete
 * runs, so the audit trail outlives the deleted data. Recipe satisfies
 * the GDPR/CCPA pattern: the user's data is gone, but a record that the
 * deletion happened (with who requested it + when) persists for
 * regulatory inquiry.
 *
 * Required body confirmation: the user must type the literal string
 * `PERMANENTLY DELETE <phone>` in the `confirm` field. Foot-gun shield.
 *
 * Admin-gated for now (OWNER_API_TOKEN). When the deck grows a "Delete
 * my account" button, the auth check shifts to a session cookie + a
 * two-step verification flow (request → confirm via Iris over WhatsApp).
 */

import { logAuditEvent } from '../../_lib/audit-log';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(request: Request) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return Response.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  const auth = request.headers.get('authorization');
  const ownerToken = process.env.OWNER_API_TOKEN;
  if (!ownerToken || !auth?.startsWith('Bearer ') || auth.slice(7) !== ownerToken) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: { phone?: string; confirm?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const { phone, confirm } = body;
  if (!phone) return Response.json({ error: 'phone required' }, { status: 400 });
  const cleanPhone = String(phone).replace(/[\s\-+()]/g, '');
  const expectedConfirm = `PERMANENTLY DELETE ${cleanPhone}`;
  if (confirm !== expectedConfirm) {
    return Response.json(
      {
        error: 'confirmation mismatch',
        hint: `body.confirm must equal exactly: "${expectedConfirm}"`,
      },
      { status: 400 },
    );
  }

  try {
    // Step 1 — write the audit entry FIRST. This row survives the deletion
    // (unified_audit_log is on the retained-tables list). It's the
    // evidence the deletion occurred + who authorized it.
    await logAuditEvent({
      tenantPhone: cleanPhone,
      actor: 'admin (OWNER_API_TOKEN)',
      actorType: 'admin',
      action: 'data.delete',
      resource: '/api/compliance/delete',
      outcome: 'success',
      payload: {
        confirmation_string: expectedConfirm,
        initiated_at: new Date().toISOString(),
      },
      // Don't redact — this audit entry IS the record. We want the exact
      // string the caller provided.
      redact: false,
    });

    // Step 2 — call the cascading delete RPC. Single transaction.
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/delete_tenant_data`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_tenant_phone: cleanPhone }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[compliance-delete] RPC failed:', errText);
      // Audit the failure too — the deletion was attempted but didn't
      // complete cleanly.
      void logAuditEvent({
        tenantPhone: cleanPhone,
        actor: 'admin (OWNER_API_TOKEN)',
        actorType: 'admin',
        action: 'data.delete',
        resource: '/api/compliance/delete',
        outcome: 'failure',
        payload: { error: errText },
        redact: false,
      });
      return Response.json({ error: 'deletion RPC failed', details: errText }, { status: 500 });
    }

    const counts = await res.json();
    return Response.json({
      success: true,
      tenant_phone: cleanPhone,
      deleted_at: new Date().toISOString(),
      per_table_counts: counts,
      retained_tables: ['unified_audit_log', 'credential_access_log', 'overage_events'],
    });
  } catch (err: any) {
    console.error('[compliance-delete] error:', err);
    return Response.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}

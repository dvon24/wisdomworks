/**
 * POST /api/iris-profile/dismiss-rule
 *   Body: { rule_id: string }
 *
 * Owner clicks "Dismiss" on a rule card in the iris-profile deck
 * page. This wraps the existing `dismissDispositionRule` helper from
 * disposition-mining.ts and applies the same session-cookie auth
 * pattern as /api/iris-profile.
 *
 * Validates that the rule actually belongs to the requesting tenant
 * before dismissing — defense against forged rule_ids.
 */

import { verifySessionToken } from '../../_lib/api-auth';
import { dismissDispositionRule } from '../../_lib/disposition-mining';
import { logAuditEvent } from '../../_lib/audit-log';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(request: Request) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return Response.json({ error: 'supabase not configured' }, { status: 500 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }
  const ruleId: string | undefined = body?.rule_id;
  if (!ruleId || typeof ruleId !== 'string') {
    return Response.json({ error: 'rule_id required' }, { status: 400 });
  }

  // Auth — owner-token admin override OR session cookie
  const auth = request.headers.get('authorization');
  const ownerToken = process.env.OWNER_API_TOKEN;
  const isOwnerToken = ownerToken && auth === `Bearer ${ownerToken}`;
  let actorPhone: string | null = null;
  if (isOwnerToken) {
    // Admin can dismiss any rule; we still need a phone for the audit log,
    // pulled from the rule's row below.
    actorPhone = null;
  } else {
    const cookieHeader = request.headers.get('cookie') ?? '';
    const sessionMatch = cookieHeader.match(/(?:^|;\s*)ww_session=([^;]+)/);
    if (!sessionMatch) return Response.json({ error: 'no session' }, { status: 401 });
    const verified = await verifySessionToken(decodeURIComponent(sessionMatch[1]!));
    if (!verified) return Response.json({ error: 'invalid session' }, { status: 401 });
    actorPhone = verified.phone.replace(/[\s\-+()]/g, '');
  }

  // Tenant-scope check — fetch the rule's owning tenant and confirm
  // it matches the session caller. Defense against forged rule_ids.
  try {
    const lookupRes = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_disposition_rules?id=eq.${encodeURIComponent(ruleId)}&select=tenant_phone,kind,rule_text&limit=1`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
      },
    );
    if (!lookupRes.ok) {
      return Response.json({ error: 'rule lookup failed' }, { status: 500 });
    }
    const rows = await lookupRes.json();
    const rule = rows?.[0];
    if (!rule) {
      // 404-shaped: rule doesn't exist (already dismissed elsewhere?)
      return Response.json({ ok: true, already_gone: true });
    }
    if (!isOwnerToken && rule.tenant_phone !== actorPhone) {
      return Response.json({ error: 'phone mismatch' }, { status: 403 });
    }
    const ruleTenant = String(rule.tenant_phone);

    const ok = await dismissDispositionRule(ruleTenant, ruleId);
    if (!ok) {
      return Response.json({ error: 'dismiss write failed' }, { status: 500 });
    }

    void logAuditEvent({
      tenantPhone: ruleTenant,
      actor: isOwnerToken ? 'admin (OWNER_API_TOKEN)' : ruleTenant,
      actorType: isOwnerToken ? 'admin' : 'owner',
      action: 'admin.config_change',
      resource: 'tenant_disposition_rules',
      outcome: 'success',
      payload: {
        rule_id: ruleId,
        kind: rule.kind,
        rule_text_preview: String(rule.rule_text ?? '').slice(0, 120),
        source: 'iris_profile_page',
      },
    });

    return Response.json({ ok: true, rule_id: ruleId });
  } catch (err: any) {
    console.error('[iris-profile/dismiss-rule] error:', err);
    return Response.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}

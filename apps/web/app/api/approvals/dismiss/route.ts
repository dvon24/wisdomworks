/**
 * POST /api/approvals/dismiss
 *
 * Marks one or more agent_runs as dismissed so they stop appearing in the
 * deck's Approvals tab. Replaces the old client-side-only dismissal,
 * which lost state on page reload.
 *
 * Body: { phone: string, ids: string[] }  (array of agent_runs.id)
 *
 * Auth: signed session cookie / phone header (same pattern as dashboard).
 * The endpoint only updates rows whose tenant_phone matches the requester,
 * so a malicious caller can't dismiss someone else's approvals.
 */

import { verifySessionToken } from '../../_lib/api-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 15;

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
  const phone: string | undefined = body?.phone;
  const ids: string[] | undefined = body?.ids;
  if (!phone || !Array.isArray(ids) || ids.length === 0) {
    return Response.json({ error: 'phone and ids[] required' }, { status: 400 });
  }
  // Soft cap so callers can't accidentally dismiss all 50k rows in a tenant.
  if (ids.length > 100) {
    return Response.json({ error: 'max 100 ids per request' }, { status: 400 });
  }

  // Auth: phone in the body must match the signed session cookie. The deck
  // sends the cookie on credentialed fetches; we trust the cookie's claim,
  // not the body's claim.
  const cookieHeader = request.headers.get('cookie') ?? '';
  const sessionMatch = cookieHeader.match(/(?:^|;\s*)ww_session=([^;]+)/);
  if (!sessionMatch) return Response.json({ error: 'no session' }, { status: 401 });
  const verified = await verifySessionToken(decodeURIComponent(sessionMatch[1]!));
  if (!verified) return Response.json({ error: 'invalid session' }, { status: 401 });

  const cleanCookiePhone = verified.phone.replace(/[\s\-+()]/g, '');
  const cleanBodyPhone = String(phone).replace(/[\s\-+()]/g, '');
  if (cleanCookiePhone !== cleanBodyPhone) {
    return Response.json({ error: 'phone mismatch' }, { status: 403 });
  }

  // PATCH the rows. Filter by tenant_phone AND id so even a forged ID
  // can only ever affect this tenant's rows.
  const idList = ids.map((id) => `"${String(id)}"`).join(',');
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_runs?tenant_phone=eq.${cleanCookiePhone}&id=in.(${idList})`,
      {
        method: 'PATCH',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({ outcome: 'dismissed' }),
      },
    );
    if (!res.ok) {
      const errText = await res.text().catch(() => '<no body>');
      return Response.json({ error: `dismiss failed: ${res.status} ${errText.slice(0, 300)}` }, { status: 500 });
    }
    const updated = await res.json().catch(() => []);
    return Response.json({ dismissed_count: Array.isArray(updated) ? updated.length : 0 });
  } catch (err: any) {
    return Response.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}

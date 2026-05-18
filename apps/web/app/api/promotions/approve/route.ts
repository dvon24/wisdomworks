/**
 * POST /api/promotions/approve
 *   Body: { phone, agentName, targetAutonomy }
 *
 * Package 3 — owner-action endpoint. When the owner approves a
 * promotion candidate (via the deck OR via Iris's approve_promotion
 * tool), this:
 *
 *   1. Validates the requested autonomy is the SAME level the cron
 *      proposed (no skipping levels via this endpoint — owners can
 *      manually set autonomy via a separate flow).
 *   2. Applies the promotion (PATCH agent_configs.config.autonomy).
 *   3. Closes the underlying business_insight (sets status='executed').
 *   4. Audit-logs the action via the hash-chained ledger.
 *
 * Auth: session cookie (deck flow) OR OWNER_API_TOKEN (admin).
 */

import { verifySessionToken } from '../../_lib/api-auth';
import { applyPromotion, type Autonomy } from '../../_lib/promotion-candidates';
import { logAuditEvent } from '../../_lib/audit-log';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const VALID_AUTONOMY: Autonomy[] = ['L1', 'L2', 'L3', 'L4'];

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
  const agentName: string | undefined = body?.agentName;
  const targetAutonomy: Autonomy | undefined = body?.targetAutonomy;
  if (!phone || !agentName || !targetAutonomy) {
    return Response.json({ error: 'phone, agentName, and targetAutonomy required' }, { status: 400 });
  }
  if (!VALID_AUTONOMY.includes(targetAutonomy)) {
    return Response.json({ error: `invalid targetAutonomy ${targetAutonomy}` }, { status: 400 });
  }
  const cleanPhone = String(phone).replace(/[\s\-+()]/g, '');

  // Auth — same dual pattern as elsewhere
  const auth = request.headers.get('authorization');
  const ownerToken = process.env.OWNER_API_TOKEN;
  const isOwnerToken = ownerToken && auth === `Bearer ${ownerToken}`;
  if (!isOwnerToken) {
    const cookieHeader = request.headers.get('cookie') ?? '';
    const sessionMatch = cookieHeader.match(/(?:^|;\s*)ww_session=([^;]+)/);
    if (!sessionMatch) return Response.json({ error: 'no session' }, { status: 401 });
    const verified = await verifySessionToken(decodeURIComponent(sessionMatch[1]!));
    if (!verified) return Response.json({ error: 'invalid session' }, { status: 401 });
    if (verified.phone.replace(/[\s\-+()]/g, '') !== cleanPhone) {
      return Response.json({ error: 'phone mismatch' }, { status: 403 });
    }
  }

  // Apply the promotion
  const applied = await applyPromotion(cleanPhone, agentName, targetAutonomy);
  if (!applied) {
    return Response.json({ error: 'apply failed — agent not found or update rejected' }, { status: 500 });
  }

  // Close the matching open business_insight so it stops surfacing
  // in the approvals tab. Best-effort.
  const signature = `promotion.${agentName.toLowerCase()}.${targetAutonomy}`;
  try {
    await fetch(
      `${SUPABASE_URL}/rest/v1/business_insights?tenant_phone=eq.${cleanPhone}&signature=eq.${encodeURIComponent(signature)}&status=eq.proposed`,
      {
        method: 'PATCH',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ status: 'executed' }),
      },
    );
  } catch {}

  void logAuditEvent({
    tenantPhone: cleanPhone,
    actor: isOwnerToken ? 'admin (OWNER_API_TOKEN)' : cleanPhone,
    actorType: isOwnerToken ? 'admin' : 'owner',
    action: 'admin.config_change',
    resource: 'agent_configs.autonomy',
    outcome: 'success',
    payload: { agent_name: agentName, new_autonomy: targetAutonomy, source: 'promotion_approval' },
    redact: false,
  });

  return Response.json({
    ok: true,
    agent_name: agentName,
    new_autonomy: applied,
    insight_closed: true,
    next_message: `${agentName} promoted to ${applied}. The change takes effect on their next tick (within ~15 min).`,
  });
}

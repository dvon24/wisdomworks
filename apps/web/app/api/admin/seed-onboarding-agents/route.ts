/**
 * POST /api/admin/seed-onboarding-agents  { phone }
 *   Authorization: Bearer <OWNER_API_TOKEN>           (manual / admin / backfill)
 *                  Bearer <SUPABASE_SERVICE_ROLE_KEY>  (internal: website -> web)
 *
 * The binding wire (GAP 1): binds every agent on the tenant to a canonical
 * catalog role and seeds its day-1 routines (pending_approval). Also the
 * legacy self-heal (GAP 6) — run it once for an existing tenant to bind agents
 * that predate the catalog (e.g. a tenant's old Coach/Mira added via WhatsApp).
 *
 * Called by apps/website deploy-complete right after it persists the derived
 * agents (passing the shared service key it already holds), and runnable by
 * the owner directly. Returns the bind/seed report, including any UNMATCHED
 * agents so a role that didn't resolve is SURFACED, never silently shipped mute.
 */

import { bindAndSeedTenantAgents } from '../../_lib/role-template-seeder';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request) {
  const auth = request.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const ownerToken = process.env.OWNER_API_TOKEN;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const authorized = !!token && ((!!ownerToken && token === ownerToken) || (!!serviceKey && token === serviceKey));
  if (!authorized) return Response.json({ error: 'unauthorized' }, { status: 401 });

  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }
  const phone = String(body?.phone ?? '').trim();
  if (!phone) return Response.json({ error: 'phone required' }, { status: 400 });

  const report = await bindAndSeedTenantAgents(phone);

  // Ping the PLATFORM owner when a NEW tenant onboards. Fire only on the
  // service-key path — that's the website's deploy-complete callback (a real
  // onboard); the owner-token path is a manual backfill the owner already knows
  // about. Devon flagged he has no signal when a friend self-onboards. The
  // report's `unmatched` is surfaced so a role that shipped without routines is
  // visible immediately. Non-blocking — never let the notify failure 500 the bind.
  const viaServiceKey = !!serviceKey && token === serviceKey;
  if (viaServiceKey && report.bound_count > 0) {
    void (async () => {
      try {
        const ownerPhone = (process.env.PLATFORM_OWNER_PHONE ?? '491703604562').replace(/[\s\-+()]/g, '');
        let biz = phone;
        try {
          const r = await fetch(
            `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${phone}&select=business_name,business_type&limit=1`,
            { headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` } },
          );
          if (r.ok) {
            const rows = await r.json();
            if (rows[0]?.business_name) biz = `${rows[0].business_name}${rows[0].business_type ? ` (${rows[0].business_type})` : ''}`;
          }
        } catch { /* name is cosmetic */ }
        const agentList = report.agents.filter((a) => a.bound).map((a) => `${a.agent_name} → ${a.role_slug}`).join(', ');
        const unmatchedNote = report.unmatched.length ? `\n⚠️ Unmatched (shipped WITHOUT routines): ${report.unmatched.join(', ')}` : '';
        const { sendOwnerMessage } = await import('../../_lib/owner-message');
        await sendOwnerMessage({
          tenantPhone: ownerPhone,
          body: `🎉 New tenant onboarded: ${biz} [${phone}]\nProvisioned ${report.bound_count} agent${report.bound_count === 1 ? '' : 's'}: ${agentList || '(none)'}.${unmatchedNote}\nThey still need to approve their workflows to go live.`,
          source: 'manual',
        });
      } catch (err) {
        console.warn('[seed-onboarding-agents] owner onboard-notify failed (non-blocking):', err);
      }
    })();
  }

  // Always 200 — `unmatched` carries the soft failures (a role with no catalog
  // match); the owner/gap-loop can resolve those. The report is the signal.
  return Response.json(report, { status: 200 });
}

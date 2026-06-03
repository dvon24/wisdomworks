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
  // Always 200 — `unmatched` carries the soft failures (a role with no catalog
  // match); the owner/gap-loop can resolve those. The report is the signal.
  return Response.json(report, { status: 200 });
}

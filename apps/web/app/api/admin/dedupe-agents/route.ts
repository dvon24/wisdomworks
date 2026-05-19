/**
 * POST /api/admin/dedupe-agents
 *   Bearer OWNER_API_TOKEN
 *   Body: { phone: string }
 *
 * Thin HTTP wrapper around _lib/admin-agents.dedupeAgentsForTenant.
 * Keeps the endpoint live for external callers (CLI scripts, future
 * admin UI, owner-facing buttons). In-process callers (Iris executor)
 * import the lib directly instead of fetching this URL — see the
 * 2026-05-19 refactor in agent-tools.ts.
 *
 * Audit-logged via the hash-chained ledger.
 */

import { dedupeAgentsForTenant } from '../../_lib/admin-agents';
import { logAuditEvent } from '../../_lib/audit-log';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(request: Request) {
  const auth = request.headers.get('authorization');
  const ownerToken = process.env.OWNER_API_TOKEN;
  if (!ownerToken || !auth?.startsWith('Bearer ') || auth.slice(7) !== ownerToken) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }
  const phone: string | undefined = body?.phone;
  if (!phone) return Response.json({ error: 'phone required' }, { status: 400 });

  const result = await dedupeAgentsForTenant(phone);

  void logAuditEvent({
    tenantPhone: result.tenant,
    actor: 'admin (OWNER_API_TOKEN)',
    actorType: 'admin',
    action: 'admin.config_change',
    resource: '/api/admin/dedupe-agents',
    outcome: result.ok ? 'success' : 'failure',
    payload: {
      endpoint: '/api/admin/dedupe-agents',
      groups_deduped: result.groups_deduped?.length ?? 0,
      rows_marked_removed: result.rows_marked_removed ?? 0,
      failures_count: result.failures?.length ?? 0,
    },
  });

  return Response.json(result);
}

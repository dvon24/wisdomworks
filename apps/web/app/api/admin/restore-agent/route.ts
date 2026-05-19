/**
 * POST /api/admin/restore-agent
 *   Bearer OWNER_API_TOKEN
 *   Body: { phone, agentName, mostRecentOnly? }
 *
 * Thin HTTP wrapper around _lib/admin-agents.restoreAgentForTenant.
 * In-process callers (Iris executor) import the lib directly.
 */

import { restoreAgentForTenant } from '../../_lib/admin-agents';
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
  const agentName: string | undefined = body?.agentName;
  const mostRecentOnly: boolean = body?.mostRecentOnly !== false;
  if (!phone || !agentName) {
    return Response.json({ error: 'phone and agentName required' }, { status: 400 });
  }

  const result = await restoreAgentForTenant({
    tenantPhone: phone,
    agentName,
    mostRecentOnly,
  });

  void logAuditEvent({
    tenantPhone: phone.replace(/[\s\-+()]/g, ''),
    actor: 'admin (OWNER_API_TOKEN)',
    actorType: 'admin',
    action: 'admin.config_change',
    resource: '/api/admin/restore-agent',
    outcome: result.ok ? 'success' : 'failure',
    payload: {
      endpoint: '/api/admin/restore-agent',
      agent_name: agentName,
      most_recent_only: mostRecentOnly,
      rows_restored: result.rows_restored,
      failures_count: result.failures?.length ?? 0,
    },
  });

  return Response.json(result);
}

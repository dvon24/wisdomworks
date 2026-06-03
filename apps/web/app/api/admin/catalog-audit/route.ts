/**
 * GET /api/admin/catalog-audit
 *   Bearer OWNER_API_TOKEN
 *
 * Runs auditCatalogIntegrity over the live agent_role_catalog +
 * agent_role_templates. Returns 200 when every role is complete, or 409 with
 * the full violation list when any role would ship MUTE (no day-1 routines),
 * has no tools, or is an orphan template slug.
 *
 * This is the runtime half of the "no agent ships mute" guarantee: run it on
 * demand, from a cron, or as a release gate before adding a new role to the
 * library. A 409 means "do not ship this catalog state."
 *
 * NOTE: the dangling-tool check (does each default_tool exist?) is intentionally
 * NOT wired yet. The canonical tool-name set is assembled across many
 * AnthropicTool consts in buildToolList, NOT the partial TOOL_REGISTRY map, so
 * passing TOOL_REGISTRY produces false positives on real tools. Sourcing the
 * complete tool-name set + enabling opts.validToolNames is a follow-up.
 */

import { auditCatalogIntegrity } from '../../_lib/role-catalog-audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(request: Request) {
  const auth = request.headers.get('authorization');
  const ownerToken = process.env.OWNER_API_TOKEN;
  if (!ownerToken || !auth?.startsWith('Bearer ') || auth.slice(7) !== ownerToken) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const report = await auditCatalogIntegrity();
  return Response.json(report, { status: report.ok ? 200 : 409 });
}

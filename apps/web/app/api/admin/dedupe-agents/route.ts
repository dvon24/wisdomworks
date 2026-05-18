/**
 * POST /api/admin/dedupe-agents
 *   Bearer OWNER_API_TOKEN
 *   Body: { phone: string }
 *
 * Tier 1 admin remediation (party-mode 2026-05-18 outcome): when the
 * deck shows duplicate agent rows (the "3 Mira's" bug), this endpoint
 * runs the same dedup logic the 2026-05-18d migration ran on first
 * apply — keep the OLDEST active row per (tenant_phone, lower(agent_name))
 * group, mark newer ones as status='removed' with a metadata note.
 *
 * Idempotent. Once the partial unique index from that migration is
 * in place, future inserts can't duplicate, so this endpoint is
 * effectively a one-shot cleanup for legacy duplicates.
 *
 * Iris can call this via the `admin_dedupe_agents` tool when she's
 * running for the platform owner (env: PLATFORM_OWNER_PHONE). For
 * other tenants the tool is hidden — only the platform owner gets
 * admin remediation surfaces by default.
 *
 * Audit-logged via the hash-chained ledger.
 */

import { logAuditEvent } from '../../_lib/audit-log';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

export async function POST(request: Request) {
  const auth = request.headers.get('authorization');
  const ownerToken = process.env.OWNER_API_TOKEN;
  if (!ownerToken || !auth?.startsWith('Bearer ') || auth.slice(7) !== ownerToken) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
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
  if (!phone) return Response.json({ error: 'phone required' }, { status: 400 });
  const cleanPhone = String(phone).replace(/[\s\-+()]/g, '');

  try {
    // Pull all active agent_configs for this tenant, group by
    // case-insensitive name, find duplicates.
    const listRes = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_configs?tenant_phone=eq.${cleanPhone}&status=neq.removed&select=id,agent_name,created_at&order=created_at.asc`,
      { headers: headers() },
    );
    if (!listRes.ok) {
      return Response.json({ error: `list failed: ${listRes.status}` }, { status: 500 });
    }
    const rows: Array<{ id: string; agent_name: string; created_at: string }> = await listRes.json();

    // Group by lowercased name. Keep the OLDEST in each group (rows
    // are already sorted ASC by created_at). All later ones are
    // duplicates to mark as removed.
    const byName = new Map<string, Array<typeof rows[0]>>();
    for (const r of rows) {
      const key = r.agent_name.toLowerCase();
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key)!.push(r);
    }

    const toRemove: Array<{ id: string; agent_name: string }> = [];
    const groupSummary: Array<{ name: string; kept_id: string; removed_count: number }> = [];
    for (const [name, group] of byName) {
      if (group.length <= 1) continue;
      const [keep, ...dups] = group;
      groupSummary.push({ name, kept_id: keep!.id, removed_count: dups.length });
      for (const d of dups) toRemove.push({ id: d.id, agent_name: d.agent_name });
    }

    if (toRemove.length === 0) {
      return Response.json({
        ok: true,
        tenant: cleanPhone,
        action: 'no_duplicates_found',
        active_agents: rows.length,
        groups_with_duplicates: 0,
        interpretation: `No duplicates. ${rows.length} active agent_configs for this tenant.`,
      });
    }

    // Mark each duplicate as removed with a metadata note. Done one-by-one
    // because we need to merge into existing config jsonb; could be a single
    // statement via a Postgres function, but per-row keeps the code legible.
    const removedAt = new Date().toISOString();
    let removed = 0;
    const failures: Array<{ id: string; reason: string }> = [];
    for (const t of toRemove) {
      try {
        const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/agent_configs?id=eq.${t.id}`, {
          method: 'PATCH',
          headers: { ...headers(), Prefer: 'return=minimal' },
          body: JSON.stringify({
            status: 'removed',
            updated_at: removedAt,
          }),
        });
        if (patchRes.ok) removed++;
        else failures.push({ id: t.id, reason: `${patchRes.status}: ${(await patchRes.text()).slice(0, 200)}` });
      } catch (err: any) {
        failures.push({ id: t.id, reason: err?.message ?? String(err) });
      }
    }

    void logAuditEvent({
      tenantPhone: cleanPhone,
      actor: 'admin (OWNER_API_TOKEN)',
      actorType: 'admin',
      action: 'admin.config_change',
      resource: '/api/admin/dedupe-agents',
      outcome: failures.length === 0 ? 'success' : 'failure',
      payload: {
        endpoint: '/api/admin/dedupe-agents',
        groups_deduped: groupSummary.length,
        rows_marked_removed: removed,
        failures_count: failures.length,
        kept_ids: groupSummary.map((g) => g.kept_id),
      },
    });

    return Response.json({
      ok: failures.length === 0,
      tenant: cleanPhone,
      groups_deduped: groupSummary,
      rows_marked_removed: removed,
      failures,
      interpretation:
        failures.length === 0
          ? `✓ Cleaned up ${removed} duplicate row${removed === 1 ? '' : 's'} across ${groupSummary.length} agent name${groupSummary.length === 1 ? '' : 's'}. The oldest row was kept for each name (preserves history); newer duplicates marked status='removed'.`
          : `⚠ Partial — ${removed} rows removed, ${failures.length} patch failures. See failures[].`,
    });
  } catch (err: any) {
    console.error('[admin/dedupe-agents] error:', err);
    return Response.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}

/**
 * POST /api/admin/restore-agent
 *   Bearer OWNER_API_TOKEN
 *   Body: { phone, agentName, mostRecentOnly? }
 *
 * Companion to /api/admin/dedupe-agents. Restores soft-removed
 * agent_configs rows for a given (tenant, agent_name) — flips
 * status='removed' back to status='active'.
 *
 * Bounded to rows soft-removed in the last 30 days so we don't
 * restore ancient deletions the owner has forgotten about.
 *
 * Defaults to most-recent-only (mostRecentOnly=true) — restoring
 * ALL would recreate the duplicate state that dedup just cleaned up.
 * Owner can pass mostRecentOnly:false to opt into the full restore.
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
  const agentName: string | undefined = body?.agentName;
  const mostRecentOnly: boolean = body?.mostRecentOnly !== false; // default true
  if (!phone || !agentName) {
    return Response.json({ error: 'phone and agentName required' }, { status: 400 });
  }
  const cleanPhone = String(phone).replace(/[\s\-+()]/g, '');

  try {
    // Find soft-removed rows for this (tenant, lower(name)) in the
    // last 30 days. Order by updated_at DESC so mostRecentOnly works.
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const listRes = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_configs?tenant_phone=eq.${cleanPhone}&status=eq.removed&agent_name=ilike.${encodeURIComponent(agentName)}&updated_at=gte.${cutoff}&select=id,agent_name,updated_at,config&order=updated_at.desc`,
      { headers: headers() },
    );
    if (!listRes.ok) {
      return Response.json({ error: `list failed: ${listRes.status}` }, { status: 500 });
    }
    const candidates: Array<{ id: string; agent_name: string; updated_at: string; config: any }> = await listRes.json();
    if (candidates.length === 0) {
      return Response.json({
        ok: true,
        rows_restored: 0,
        interpretation: `No soft-removed rows found for "${agentName}" in the last 30 days. Either the agent was never removed, or it was removed more than 30 days ago and is no longer restorable here.`,
      });
    }

    const toRestore = mostRecentOnly ? [candidates[0]!] : candidates;

    // Conflict guard: if there's an ACTIVE row with the same name, we
    // can't restore another one without violating the unique index
    // (2026-05-18d migration). Surface the conflict instead of failing
    // mid-loop.
    const activeRes = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_configs?tenant_phone=eq.${cleanPhone}&status=eq.active&agent_name=ilike.${encodeURIComponent(agentName)}&select=id&limit=1`,
      { headers: headers() },
    );
    const activeRows = activeRes.ok ? await activeRes.json() : [];
    if (activeRows.length > 0 && mostRecentOnly) {
      return Response.json({
        ok: false,
        rows_restored: 0,
        interpretation: `Cannot restore — an active "${agentName}" already exists. The unique constraint blocks another active row with the same name. If the owner wants to swap (restore the removed one, keep it active, and remove the current active one), they need to do that explicitly via remove_agent_from_team + admin_restore_agent in sequence.`,
      });
    }
    if (activeRows.length > 0 && !mostRecentOnly) {
      return Response.json({
        ok: false,
        rows_restored: 0,
        interpretation: `Cannot restore all duplicates — an active "${agentName}" already exists. Restoring ALL removed rows would violate the unique constraint. If the owner really wants the duplicate state back, they'd need to first remove the active one (which seems like the wrong move).`,
      });
    }

    let restored = 0;
    const failures: Array<{ id: string; reason: string }> = [];
    for (const c of toRestore) {
      try {
        const newConfig = { ...(c.config ?? {}) };
        // Strip the dedup-removal metadata so the restored row doesn't
        // carry stale "I was removed because of duplicate_dedup" notes.
        delete newConfig.removed_reason;
        delete newConfig.removed_at;
        delete newConfig.removed_by_migration;
        const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/agent_configs?id=eq.${c.id}`, {
          method: 'PATCH',
          headers: { ...headers(), Prefer: 'return=minimal' },
          body: JSON.stringify({
            status: 'active',
            config: newConfig,
            updated_at: new Date().toISOString(),
          }),
        });
        if (patchRes.ok) restored++;
        else failures.push({ id: c.id, reason: `${patchRes.status}: ${(await patchRes.text()).slice(0, 200)}` });
      } catch (err: any) {
        failures.push({ id: c.id, reason: err?.message ?? String(err) });
      }
    }

    void logAuditEvent({
      tenantPhone: cleanPhone,
      actor: 'admin (OWNER_API_TOKEN)',
      actorType: 'admin',
      action: 'admin.config_change',
      resource: '/api/admin/restore-agent',
      outcome: failures.length === 0 ? 'success' : 'failure',
      payload: {
        endpoint: '/api/admin/restore-agent',
        agent_name: agentName,
        most_recent_only: mostRecentOnly,
        rows_restored: restored,
        failures_count: failures.length,
      },
    });

    return Response.json({
      ok: failures.length === 0,
      rows_restored: restored,
      failures,
      interpretation:
        failures.length === 0
          ? `✓ Restored ${restored} "${agentName}" row${restored === 1 ? '' : 's'}. Status flipped back to active; will appear in the deck Team view on next refresh.`
          : `⚠ Partial — ${restored} restored, ${failures.length} patch failures. See failures[].`,
    });
  } catch (err: any) {
    console.error('[admin/restore-agent] error:', err);
    return Response.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}

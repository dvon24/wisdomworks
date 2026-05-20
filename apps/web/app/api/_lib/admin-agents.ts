/**
 * Admin agent-config operations — dedup + restore.
 *
 * Extracted 2026-05-19 so both the HTTP admin endpoints AND the Iris
 * executor can call this logic directly. Previously the Iris tool
 * fetched its own /api/admin/* endpoint over HTTP, which required a
 * NEXT_PUBLIC_APP_BASE_URL env var — silly since both the caller and
 * the endpoint live in the same Vercel deployment. This direct-call
 * pattern is the right shape going forward for in-process admin ops.
 *
 * The HTTP endpoints still exist (for external callers, future admin
 * UI, etc.) but now thin wrappers over these helpers.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

export interface DedupeResult {
  ok: boolean;
  tenant: string;
  action?: 'no_duplicates_found';
  active_agents?: number;
  groups_deduped?: Array<{ name: string; kept_id: string; removed_count: number }>;
  rows_marked_removed?: number;
  team_remaining?: Array<{ name: string; location: string }>;
  failures?: Array<{ id: string; reason: string }>;
  interpretation: string;
  reason?: string;
}

/**
 * Dedup agent_configs for one tenant. Keeps the OLDEST active row per
 * (tenant_phone, lower(agent_name)) group; marks newer duplicates as
 * status='removed'. Idempotent.
 */
export async function dedupeAgentsForTenant(tenantPhone: string): Promise<DedupeResult> {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return {
      ok: false,
      tenant: tenantPhone,
      interpretation: 'Supabase not configured.',
      reason: 'supabase_not_configured',
    };
  }
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');

  // Pull all active agent_configs for this tenant.
  const listRes = await fetch(
    `${SUPABASE_URL}/rest/v1/agent_configs?tenant_phone=eq.${cleanPhone}&status=neq.removed&select=id,agent_name,created_at&order=created_at.asc`,
    { headers: headers() },
  );
  if (!listRes.ok) {
    return {
      ok: false,
      tenant: cleanPhone,
      interpretation: `Couldn't read agent_configs (HTTP ${listRes.status}).`,
      reason: `list_failed_${listRes.status}`,
    };
  }
  const rows: Array<{ id: string; agent_name: string; created_at: string }> = await listRes.json();

  // Group by lowercased name. Keep the OLDEST in each group; the
  // rest are duplicates to mark as removed.
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
    // agent_configs is already clean — but the CHAT-SIDE team profile
    // can still have duplicates left over from before the migration.
    // Run chat-team dedup before exiting so the deck Team view reflects
    // reality. This is the bug Devon hit 2026-05-19: migration cleaned
    // agent_configs, tool reported "no duplicates," but the deck still
    // showed 5 Mira nodes because chat-team dedup was gated behind
    // "agent_configs had duplicates."
    const teamOnlyDedup = await dedupeChatTeamForTenant(cleanPhone);
    return {
      ok: true,
      tenant: cleanPhone,
      action: teamOnlyDedup.team_duplicates_removed > 0 ? undefined : 'no_duplicates_found',
      active_agents: rows.length,
      team_remaining: teamOnlyDedup.remaining_names,
      interpretation:
        teamOnlyDedup.team_duplicates_removed > 0
          ? `agent_configs was already clean (${rows.length} active rows). Cleaned ${teamOnlyDedup.team_duplicates_removed} duplicate entr${teamOnlyDedup.team_duplicates_removed === 1 ? 'y' : 'ies'} from the chat-side team profile (this is what the deck Team view renders — the count should drop on the next refresh). Remaining team: ${(teamOnlyDedup.remaining_names ?? []).map(n => n.location === 'top' ? n.name : `${n.name} (under ${n.location.slice(4)})`).join(', ') || '(empty)'}.`
          : `No duplicates anywhere. ${rows.length} active agent_configs for this tenant, and the chat-side team profile is also clean. Team: ${(teamOnlyDedup.remaining_names ?? []).map(n => n.location === 'top' ? n.name : `${n.name} (under ${n.location.slice(4)})`).join(', ') || '(empty)'}.`,
    };
  }

  const removedAt = new Date().toISOString();
  let removed = 0;
  const failures: Array<{ id: string; reason: string }> = [];
  for (const t of toRemove) {
    try {
      const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/agent_configs?id=eq.${t.id}`, {
        method: 'PATCH',
        headers: { ...headers(), Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'removed', updated_at: removedAt }),
      });
      if (patchRes.ok) removed++;
      else failures.push({ id: t.id, reason: `${patchRes.status}: ${(await patchRes.text()).slice(0, 200)}` });
    } catch (err: any) {
      failures.push({ id: t.id, reason: err?.message ?? String(err) });
    }
  }

  // Also dedupe the chat-side team JSON in whatsapp_contexts.profile.team.
  // BEFORE the 2026-05-15 fix, add_agent_to_team wrote ONLY to user.profile.team
  // and didn't touch agent_configs. After that fix it writes to both, but
  // historical bloat sits in the chat profile array and is what the deck
  // Team view renders. Cleanup must hit both stores or the owner still sees
  // duplicates in the tree visualization.
  const teamDedupResult = await dedupeChatTeamForTenant(cleanPhone);

  const remainingDesc = (teamDedupResult.remaining_names ?? [])
    .map(n => n.location === 'top' ? n.name : `${n.name} (under ${n.location.slice(4)})`)
    .join(', ') || '(empty)';

  const interpretation = failures.length === 0
    ? `✓ Cleaned up ${removed} duplicate agent_configs row${removed === 1 ? '' : 's'} across ${groupSummary.length} agent name${groupSummary.length === 1 ? '' : 's'} (kept the oldest of each). ${teamDedupResult.team_duplicates_removed > 0 ? `Also cleaned ${teamDedupResult.team_duplicates_removed} duplicate entr${teamDedupResult.team_duplicates_removed === 1 ? 'y' : 'ies'} from the chat-side team profile (this is what the deck Team view renders).` : 'Chat-side team profile was already clean.'} Remaining team: ${remainingDesc}.`
    : `⚠ Partial — ${removed} rows removed, ${failures.length} patch failures. See failures[].`;

  return {
    ok: failures.length === 0,
    tenant: cleanPhone,
    groups_deduped: groupSummary,
    rows_marked_removed: removed,
    team_remaining: teamDedupResult.remaining_names,
    failures,
    interpretation,
  };
}

/**
 * Dedupe the chat-side team JSON (whatsapp_contexts.profile.team). This
 * array can hold duplicate entries from before the 2026-05-15 fix to
 * add_agent_to_team. The deck Team-view tree visualization reads from
 * this array, so even after agent_configs is clean the owner sees
 * duplicates in the UI until we clean it too.
 *
 * 2026-05-20 — extended to global-namespace dedup. Previously this only
 * dedup'd within the top-level array and within each subTeam.agents
 * array, but the deck renders BOTH levels — so a name appearing once at
 * top-level AND inside three different subTeams shows as 4 nodes. The
 * fix below treats top-level + every subTeam as ONE namespace. First
 * occurrence wins (preferring top-level over sub-level since top-level
 * is the canonical home).
 *
 * Returns the final flat list of names + locations so the caller can
 * report exactly what remains. Helpful when the owner says "still see N
 * of X" — we can show them the actual structure.
 */
async function dedupeChatTeamForTenant(cleanPhone: string): Promise<{
  team_duplicates_removed: number;
  remaining_names?: Array<{ name: string; location: string }>;
}> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { team_duplicates_removed: 0 };
  try {
    const ctxRes = await fetch(
      `${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${cleanPhone}&select=profile&limit=1`,
      { headers: headers() },
    );
    if (!ctxRes.ok) return { team_duplicates_removed: 0 };
    const rows = await ctxRes.json();
    const ctx = rows?.[0];
    if (!ctx?.profile) return { team_duplicates_removed: 0 };
    const team = Array.isArray(ctx.profile.team) ? ctx.profile.team : [];
    if (team.length === 0) return { team_duplicates_removed: 0 };

    // Global namespace — every name (top-level OR in any subTeam) competes
    // for the same slot. First seen wins; everything else is dropped.
    const claimed = new Set<string>();
    const remaining: Array<{ name: string; location: string }> = [];
    let removed = 0;

    const dedupedTeam: any[] = [];
    for (const member of team) {
      const key = (member?.name ?? '').toLowerCase().trim();
      // Unnamed entries: keep them but don't claim a slot.
      if (!key) {
        dedupedTeam.push(member);
        continue;
      }
      if (claimed.has(key)) {
        removed++;
        continue;
      }
      claimed.add(key);
      remaining.push({ name: member.name, location: 'top' });

      // Now dedupe this member's subTeam.agents against the SAME global set.
      if (Array.isArray(member.subTeam?.agents)) {
        const dedupedSubAgents: any[] = [];
        for (const sub of member.subTeam.agents) {
          const subKey = (sub?.name ?? '').toLowerCase().trim();
          if (!subKey) {
            dedupedSubAgents.push(sub);
            continue;
          }
          if (claimed.has(subKey)) {
            removed++;
            continue;
          }
          claimed.add(subKey);
          remaining.push({ name: sub.name, location: `sub:${member.name}` });
          dedupedSubAgents.push(sub);
        }
        member.subTeam.agents = dedupedSubAgents;
        member.subTeam.count = dedupedSubAgents.length;
      }
      dedupedTeam.push(member);
    }

    if (removed === 0) {
      return { team_duplicates_removed: 0, remaining_names: remaining };
    }

    // Write back. Preserve all other profile fields.
    const newProfile = { ...ctx.profile, team: dedupedTeam };
    await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${cleanPhone}`, {
      method: 'PATCH',
      headers: { ...headers(), Prefer: 'return=minimal' },
      body: JSON.stringify({ profile: newProfile }),
    });
    return { team_duplicates_removed: removed, remaining_names: remaining };
  } catch (err) {
    console.warn('[admin-agents] chat-team dedup failed:', err);
    return { team_duplicates_removed: 0 };
  }
}

export interface RestoreResult {
  ok: boolean;
  rows_restored: number;
  failures?: Array<{ id: string; reason: string }>;
  interpretation: string;
}

/**
 * Restore soft-removed agent_configs rows for a given (tenant, name).
 * Bounded to rows removed in the last 30 days. Defaults to most-recent-
 * only — restoring ALL would recreate the duplicate state.
 *
 * Refuses to restore when an active row with the same name already
 * exists (would violate the partial unique index from migration
 * 2026-05-18d).
 */
export async function restoreAgentForTenant(args: {
  tenantPhone: string;
  agentName: string;
  mostRecentOnly?: boolean;
}): Promise<RestoreResult> {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return { ok: false, rows_restored: 0, interpretation: 'Supabase not configured.' };
  }
  const cleanPhone = args.tenantPhone.replace(/[\s\-+()]/g, '');
  const mostRecentOnly = args.mostRecentOnly !== false;
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const listRes = await fetch(
    `${SUPABASE_URL}/rest/v1/agent_configs?tenant_phone=eq.${cleanPhone}&status=eq.removed&agent_name=ilike.${encodeURIComponent(args.agentName)}&updated_at=gte.${cutoff}&select=id,agent_name,updated_at,config&order=updated_at.desc`,
    { headers: headers() },
  );
  if (!listRes.ok) {
    return { ok: false, rows_restored: 0, interpretation: `Couldn't read agent_configs (HTTP ${listRes.status}).` };
  }
  const candidates: Array<{ id: string; agent_name: string; updated_at: string; config: any }> = await listRes.json();
  if (candidates.length === 0) {
    return {
      ok: true,
      rows_restored: 0,
      interpretation: `No soft-removed rows found for "${args.agentName}" in the last 30 days. Either the agent was never removed, or it was removed more than 30 days ago and is no longer restorable here.`,
    };
  }

  const toRestore = mostRecentOnly ? [candidates[0]!] : candidates;

  // Conflict guard against the partial unique index.
  const activeRes = await fetch(
    `${SUPABASE_URL}/rest/v1/agent_configs?tenant_phone=eq.${cleanPhone}&status=eq.active&agent_name=ilike.${encodeURIComponent(args.agentName)}&select=id&limit=1`,
    { headers: headers() },
  );
  const activeRows = activeRes.ok ? await activeRes.json() : [];
  if (activeRows.length > 0) {
    return {
      ok: false,
      rows_restored: 0,
      interpretation: mostRecentOnly
        ? `Cannot restore — an active "${args.agentName}" already exists. To swap, first remove the active one (which is usually not what you want).`
        : `Cannot restore all duplicates — an active "${args.agentName}" already exists. Restoring all would violate the unique constraint.`,
    };
  }

  let restored = 0;
  const failures: Array<{ id: string; reason: string }> = [];
  for (const c of toRestore) {
    try {
      const newConfig = { ...(c.config ?? {}) };
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

  return {
    ok: failures.length === 0,
    rows_restored: restored,
    failures,
    interpretation:
      failures.length === 0
        ? `✓ Restored ${restored} "${args.agentName}" row${restored === 1 ? '' : 's'}. Status flipped back to active; will appear in the deck Team view on next refresh.`
        : `⚠ Partial — ${restored} restored, ${failures.length} patch failures. See failures[].`,
  };
}

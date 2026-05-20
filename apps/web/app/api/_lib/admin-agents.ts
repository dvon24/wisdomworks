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
    const remainingDesc = (teamOnlyDedup.remaining_names ?? [])
      .map(n => n.location === 'top' ? n.name : `${n.name} (under ${n.location.slice(4)})`)
      .join(', ') || '(empty)';
    if (teamOnlyDedup.write_error) {
      return {
        ok: false,
        tenant: cleanPhone,
        active_agents: rows.length,
        team_remaining: teamOnlyDedup.remaining_names,
        reason: `chat_team_write_failed`,
        interpretation: `agent_configs was already clean (${rows.length} active rows). Identified duplicates in the chat-side team profile but the PATCH to whatsapp_contexts FAILED with: ${teamOnlyDedup.write_error}. The team JSON was NOT updated — duplicates remain in the database. This is a code-level fix needed (RLS policy, schema constraint, or column mismatch). Remaining team if write had succeeded: ${remainingDesc}.`,
      };
    }
    return {
      ok: true,
      tenant: cleanPhone,
      action: teamOnlyDedup.team_duplicates_removed > 0 ? undefined : 'no_duplicates_found',
      active_agents: rows.length,
      team_remaining: teamOnlyDedup.remaining_names,
      interpretation:
        teamOnlyDedup.team_duplicates_removed > 0
          ? `agent_configs was already clean (${rows.length} active rows). Cleaned ${teamOnlyDedup.team_duplicates_removed} duplicate entr${teamOnlyDedup.team_duplicates_removed === 1 ? 'y' : 'ies'} from the chat-side team profile (this is what the deck Team view renders — the count should drop on the next refresh). Remaining team: ${remainingDesc}.`
          : `No duplicates anywhere. ${rows.length} active agent_configs for this tenant, and the chat-side team profile is also clean. Team: ${remainingDesc}.`,
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
  write_error?: string;
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

    // Write back. Preserve all other profile fields. Check the response —
    // fire-and-forget hid a silent-failure path where the PATCH was rejected
    // (RLS, schema constraint, type mismatch) but the tool still reported
    // "5 cleaned" because we never looked at the status code.
    const newProfile = { ...ctx.profile, team: dedupedTeam };
    const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${cleanPhone}`, {
      method: 'PATCH',
      headers: { ...headers(), Prefer: 'return=minimal' },
      body: JSON.stringify({ profile: newProfile }),
    });
    if (!patchRes.ok) {
      const errText = await patchRes.text().catch(() => '');
      console.error('[admin-agents] chat-team PATCH failed:', patchRes.status, errText.slice(0, 200));
      return {
        team_duplicates_removed: 0,
        remaining_names: remaining,
        write_error: `${patchRes.status}: ${errText.slice(0, 200)}`,
      };
    }
    return { team_duplicates_removed: removed, remaining_names: remaining };
  } catch (err) {
    console.warn('[admin-agents] chat-team dedup failed:', err);
    return { team_duplicates_removed: 0 };
  }
}

export interface AuditResult {
  ok: boolean;
  tenant: string;
  total_mentions: number;
  context_row_count: number;
  by_location: {
    agent_configs_active: Array<{ id: string; agent_name: string; created_at: string }>;
    agent_configs_removed: Array<{ id: string; agent_name: string; updated_at: string }>;
    chat_team_top_level: Array<{ name: string; index: number; ctx_row: number }>;
    chat_team_sub: Array<{ name: string; parent: string; index: number; ctx_row: number }>;
    agent_instances: Array<{ id: string; agent_config_id: string; status: string }>;
  };
  interpretation: string;
}

/**
 * Read-only diagnostic — finds every mention of an agent name across ALL
 * known storage locations. Shipped 2026-05-20 because the dedup tool kept
 * "fixing" things while the owner still saw stale duplicates; turns out
 * agent_instances and agent_runs were holding their own copies.
 *
 * Use this BEFORE any dedup-style write to confirm the actual data state.
 * Never writes. Pass a name (case-insensitive substring) or null for "all".
 */
export async function auditTeamForTenant(args: {
  tenantPhone: string;
  agentName?: string | null;
}): Promise<AuditResult> {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return {
      ok: false,
      tenant: args.tenantPhone,
      total_mentions: 0,
      context_row_count: 0,
      by_location: {
        agent_configs_active: [], agent_configs_removed: [],
        chat_team_top_level: [], chat_team_sub: [], agent_instances: [],
      },
      interpretation: 'Supabase not configured.',
    };
  }
  const cleanPhone = args.tenantPhone.replace(/[\s\-+()]/g, '');
  const needle = (args.agentName ?? '').toLowerCase().trim();
  const matches = (n: string | undefined | null) =>
    needle === '' || (n ?? '').toLowerCase().includes(needle);

  const [activeRes, removedRes, ctxRes, instancesRes] = await Promise.all([
    fetch(
      `${SUPABASE_URL}/rest/v1/agent_configs?tenant_phone=eq.${cleanPhone}&status=eq.active&select=id,agent_name,created_at&order=created_at.asc`,
      { headers: headers() },
    ),
    fetch(
      `${SUPABASE_URL}/rest/v1/agent_configs?tenant_phone=eq.${cleanPhone}&status=eq.removed&select=id,agent_name,updated_at&order=updated_at.desc`,
      { headers: headers() },
    ),
    // Removed limit=1 — if multiple context rows exist for this phone (which
    // would be a critical multi-row bug), we need to see ALL of them. The
    // dedup PATCH operates on phone_number=eq.X which updates EVERY matching
    // row; if the read+write are reading different rows due to no ORDER BY,
    // dedup-failure-without-write-failure becomes invisible.
    fetch(
      `${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${cleanPhone}&select=phone_number,profile`,
      { headers: headers() },
    ),
    fetch(
      `${SUPABASE_URL}/rest/v1/agent_instances?tenant_phone=eq.${cleanPhone}&select=id,agent_config_id,status`,
      { headers: headers() },
    ),
  ]);

  const activeAll = activeRes.ok ? await activeRes.json() : [];
  const removedAll = removedRes.ok ? await removedRes.json() : [];
  const ctxRows: any[] = ctxRes.ok ? await ctxRes.json() : [];
  const instancesAll = instancesRes.ok ? await instancesRes.json() : [];

  const agent_configs_active = (activeAll as any[]).filter(r => matches(r.agent_name));
  const agent_configs_removed = (removedAll as any[]).filter(r => matches(r.agent_name));

  // Build map of config_id → agent_name for filtering instances.
  const cfgIdToName = new Map<string, string>();
  for (const c of activeAll) cfgIdToName.set(c.id, c.agent_name);
  for (const c of removedAll) cfgIdToName.set(c.id, c.agent_name);
  const agent_instances = (instancesAll as any[]).filter(i =>
    matches(cfgIdToName.get(i.agent_config_id))
  );

  // Walk profile.team across EVERY context row. If multiple rows exist for
  // this phone, this is where the smoking gun shows up.
  const chat_team_top_level: Array<{ name: string; index: number; ctx_row: number }> = [];
  const chat_team_sub: Array<{ name: string; parent: string; index: number; ctx_row: number }> = [];
  ctxRows.forEach((ctxRow, rowIdx) => {
    const profile = ctxRow?.profile ?? {};
    const team = Array.isArray(profile.team) ? profile.team : [];
    team.forEach((m: any, i: number) => {
      if (matches(m?.name)) chat_team_top_level.push({ name: m.name, index: i, ctx_row: rowIdx });
      const subs = Array.isArray(m?.subTeam?.agents) ? m.subTeam.agents : [];
      subs.forEach((s: any, j: number) => {
        if (matches(s?.name)) chat_team_sub.push({ name: s.name, parent: m.name, index: j, ctx_row: rowIdx });
      });
    });
  });

  const total =
    agent_configs_active.length +
    agent_configs_removed.length +
    chat_team_top_level.length +
    chat_team_sub.length +
    agent_instances.length;

  const lines: string[] = [];
  lines.push(`whatsapp_contexts rows for this phone: ${ctxRows.length}${ctxRows.length > 1 ? ' ⚠️ MULTIPLE ROWS — this is the source of dedup-write/read divergence' : ''}`);
  lines.push(`agent_configs (active): ${agent_configs_active.length}${agent_configs_active.length > 0 ? ` — ${agent_configs_active.map(r => r.agent_name).join(', ')}` : ''}`);
  lines.push(`agent_configs (removed/soft-deleted): ${agent_configs_removed.length}`);
  lines.push(`chat profile.team (top-level): ${chat_team_top_level.length}${chat_team_top_level.length > 0 ? ` — ${chat_team_top_level.map(r => `${r.name}[row${r.ctx_row}]`).join(', ')}` : ''}`);
  lines.push(`chat profile.team (sub-agents): ${chat_team_sub.length}${chat_team_sub.length > 0 ? ` — ${chat_team_sub.map(r => `${r.name} (under ${r.parent})[row${r.ctx_row}]`).join(', ')}` : ''}`);
  lines.push(`agent_instances: ${agent_instances.length}`);

  return {
    ok: true,
    tenant: cleanPhone,
    total_mentions: total,
    context_row_count: ctxRows.length,
    by_location: {
      agent_configs_active,
      agent_configs_removed,
      chat_team_top_level,
      chat_team_sub,
      agent_instances,
    },
    interpretation:
      needle === ''
        ? `Full team audit — ${total} total agent rows across all stores:\n${lines.join('\n')}`
        : `Audit for "${args.agentName}" — ${total} mentions across all stores:\n${lines.join('\n')}`,
  };
}

export interface AgentHealth {
  agent_name: string;
  agent_role: string;
  instance_status: string | null;        // ready / running / paused / stopped / error / null (no instance row)
  runs_24h: number;
  runs_acted_24h: number;
  runs_failed_24h: number;
  last_run_at: string | null;
  last_run_outcome: string | null;
  verdict: 'working' | 'idle' | 'failing' | 'never_ran';
}

export interface HealthCheckResult {
  ok: boolean;
  tenant: string;
  generated_at: string;
  agents: AgentHealth[];
  interpretation: string;
}

/**
 * Axis's primary runtime monitor — for every active agent in the tenant's
 * agent_configs, report whether they're actually running successfully.
 *
 * Devon's frame 2026-05-20: "the consumer will want to see their agents at
 * work occasionally. And if Iris can't determine that they're working then
 * that's an issue." This tool closes that gap by joining agent_configs to
 * agent_instances (status) and agent_runs (recent activity).
 *
 * Verdict per agent:
 *   • working   — at least one acted/escalated run in last 24h, no errors
 *   • idle      — instance is ready/running, no runs in last 24h
 *   • failing   — instance status is error, OR failed runs > acted runs in 24h
 *   • never_ran — no agent_instance row OR no agent_runs ever
 */
export async function checkAgentHealth(tenantPhone: string): Promise<HealthCheckResult> {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return {
      ok: false,
      tenant: tenantPhone,
      generated_at: new Date().toISOString(),
      agents: [],
      interpretation: 'Supabase not configured.',
    };
  }
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [cfgRes, instRes, runsRes] = await Promise.all([
    fetch(
      `${SUPABASE_URL}/rest/v1/agent_configs?tenant_phone=eq.${cleanPhone}&status=neq.removed&select=id,agent_name,agent_role`,
      { headers: headers() },
    ),
    fetch(
      `${SUPABASE_URL}/rest/v1/agent_instances?tenant_phone=eq.${cleanPhone}&select=id,agent_config_id,status`,
      { headers: headers() },
    ),
    fetch(
      `${SUPABASE_URL}/rest/v1/agent_runs?tenant_phone=eq.${cleanPhone}&started_at=gte.${since}&select=agent_instance_id,outcome,started_at&order=started_at.desc`,
      { headers: headers() },
    ),
  ]);
  if (!cfgRes.ok) {
    return {
      ok: false,
      tenant: cleanPhone,
      generated_at: new Date().toISOString(),
      agents: [],
      interpretation: `Read failed: ${cfgRes.status}`,
    };
  }

  const configs = (await cfgRes.json()) as Array<{ id: string; agent_name: string; agent_role: string }>;
  const instances = instRes.ok ? ((await instRes.json()) as any[]) : [];
  const runs = runsRes.ok ? ((await runsRes.json()) as any[]) : [];

  const instByCfgId = new Map<string, any>();
  for (const i of instances) instByCfgId.set(i.agent_config_id, i);

  const runsByInstId = new Map<string, any[]>();
  for (const r of runs) {
    const list = runsByInstId.get(r.agent_instance_id) ?? [];
    list.push(r);
    runsByInstId.set(r.agent_instance_id, list);
  }

  const agentHealths: AgentHealth[] = configs.map(c => {
    const inst = instByCfgId.get(c.id);
    const instanceStatus = inst?.status ?? null;
    const instRuns = inst ? (runsByInstId.get(inst.id) ?? []) : [];
    const acted = instRuns.filter(r => r.outcome === 'acted' || r.outcome === 'escalated' || r.outcome === 'proposed').length;
    const failed = instRuns.filter(r => r.outcome === 'failed').length;
    const last = instRuns[0];
    let verdict: AgentHealth['verdict'];
    if (!inst || instRuns.length === 0) {
      verdict = 'never_ran';
    } else if (instanceStatus === 'error' || failed > acted) {
      verdict = 'failing';
    } else if (acted > 0) {
      verdict = 'working';
    } else {
      verdict = 'idle';
    }
    return {
      agent_name: c.agent_name,
      agent_role: c.agent_role,
      instance_status: instanceStatus,
      runs_24h: instRuns.length,
      runs_acted_24h: acted,
      runs_failed_24h: failed,
      last_run_at: last?.started_at ?? null,
      last_run_outcome: last?.outcome ?? null,
      verdict,
    };
  });

  const working = agentHealths.filter(a => a.verdict === 'working').length;
  const idle = agentHealths.filter(a => a.verdict === 'idle').length;
  const failing = agentHealths.filter(a => a.verdict === 'failing').length;
  const neverRan = agentHealths.filter(a => a.verdict === 'never_ran').length;

  const lines = agentHealths.map(a => {
    const badge = a.verdict === 'working' ? '✓ working'
      : a.verdict === 'idle' ? '· idle'
      : a.verdict === 'failing' ? '⚠ failing'
      : '○ never ran';
    return `  • ${a.agent_name} (${a.agent_role}) — ${badge}, ${a.runs_24h} run${a.runs_24h === 1 ? '' : 's'} in 24h${a.runs_failed_24h > 0 ? ` (${a.runs_failed_24h} failed)` : ''}${a.last_run_at ? `, last: ${new Date(a.last_run_at).toISOString().slice(11, 16)} UTC` : ''}`;
  });

  return {
    ok: true,
    tenant: cleanPhone,
    generated_at: new Date().toISOString(),
    agents: agentHealths,
    interpretation:
      `Team health (24h window): ${working} working · ${idle} idle · ${failing} failing · ${neverRan} never ran.\n${lines.join('\n')}`,
  };
}

export interface BackfillResult {
  ok: boolean;
  tenant: string;
  rows_inserted: number;
  rows_updated_parent: number;
  parent_links_resolved: number;
  parent_links_skipped: Array<{ child: string; missing_parent: string }>;
  interpretation: string;
}

/**
 * Reconcile agent_configs to the deduped state of whatsapp_contexts.profile.team.
 *
 * The party-mode diagnosis 2026-05-20: profile.team has been the de-facto
 * canonical store while agent_configs lagged behind (many writers to profile,
 * not all of them mirrored to configs). Devon's tenant has 1 Mira in profile
 * after dedup, 0 in agent_configs — switching the deck to read from configs
 * directly would make Mira vanish. This helper closes the gap.
 *
 * What it does, idempotently:
 *   1. Walk profile.team. For each top-level agent (by lowercased name) and
 *      each sub-agent inside subTeam.agents, ensure a matching active row
 *      exists in agent_configs.
 *   2. For sub-agents, set parent_agent_id to the parent's UUID once both
 *      rows exist.
 *   3. Skip duplicates within profile (treat profile as already deduped — the
 *      caller should run dedup first if needed).
 *
 * Pure additive — never removes existing agent_configs rows. Safe to re-run.
 */
export async function backfillAgentConfigsFromProfileTeam(
  tenantPhone: string,
): Promise<BackfillResult> {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return {
      ok: false,
      tenant: tenantPhone,
      rows_inserted: 0,
      rows_updated_parent: 0,
      parent_links_resolved: 0,
      parent_links_skipped: [],
      interpretation: 'Supabase not configured.',
    };
  }
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');

  // Pull the chat-side team and the current active agent_configs in parallel.
  // NOTE: whatsapp_contexts has no `updated_at` column (only last_assistant_message_at
  // was added later). Earlier draft used `order=updated_at.desc` which 400'd.
  const [ctxRes, cfgRes] = await Promise.all([
    fetch(
      `${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${cleanPhone}&select=profile&limit=1`,
      { headers: headers() },
    ),
    fetch(
      `${SUPABASE_URL}/rest/v1/agent_configs?tenant_phone=eq.${cleanPhone}&status=eq.active&select=id,agent_name,parent_agent_id`,
      { headers: headers() },
    ),
  ]);

  if (!ctxRes.ok || !cfgRes.ok) {
    return {
      ok: false,
      tenant: cleanPhone,
      rows_inserted: 0,
      rows_updated_parent: 0,
      parent_links_resolved: 0,
      parent_links_skipped: [],
      interpretation: `Read failed: contexts ${ctxRes.status}, configs ${cfgRes.status}.`,
    };
  }

  const ctxRows = await ctxRes.json();
  const profile = ctxRows?.[0]?.profile ?? {};
  const team = Array.isArray(profile.team) ? profile.team : [];

  const existingByName = new Map<string, { id: string; parent_agent_id: string | null }>();
  for (const c of (await cfgRes.json()) as any[]) {
    existingByName.set((c.agent_name ?? '').toLowerCase().trim(), {
      id: c.id,
      parent_agent_id: c.parent_agent_id ?? null,
    });
  }

  let inserted = 0;
  let parentUpdated = 0;
  let parentResolved = 0;
  const parentSkipped: Array<{ child: string; missing_parent: string }> = [];

  // Pass 1: insert any missing top-level agents.
  for (const member of team) {
    const name = (member?.name ?? '').toString().trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (existingByName.has(key)) continue;

    const tier = member?.tier ?? 'Sonnet';
    const role = member?.role ?? 'Specialist';
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/agent_configs`, {
      method: 'POST',
      headers: { ...headers(), Prefer: 'return=representation' },
      body: JSON.stringify({
        tenant_phone: cleanPhone,
        agent_name: name,
        agent_role: role,
        status: 'active',
        output_channels: Array.isArray(member?.channels) ? member.channels : [],
        model_routing: { primary: tier },
        governance_rules: [],
        config: {
          description: member?.description,
          tools: Array.isArray(member?.tools) ? member.tools : [],
          source: 'backfill:profile_team',
        },
        parent_agent_id: null,
      }),
    });
    if (insertRes.ok) {
      const rows = await insertRes.json();
      if (Array.isArray(rows) && rows[0]) {
        existingByName.set(key, { id: rows[0].id, parent_agent_id: null });
        inserted++;
      }
    }
  }

  // Pass 2: insert sub-agents under their parents, and patch parent_agent_id
  // on any sub-agents that already exist as orphan rows.
  for (const member of team) {
    const parentName = (member?.name ?? '').toString().trim().toLowerCase();
    if (!parentName) continue;
    const parent = existingByName.get(parentName);
    if (!parent) continue;
    const subs = Array.isArray(member?.subTeam?.agents) ? member.subTeam.agents : [];
    for (const sub of subs) {
      const subName = (sub?.name ?? '').toString().trim();
      if (!subName) continue;
      const subKey = subName.toLowerCase();
      const existing = existingByName.get(subKey);
      if (existing) {
        // Already in agent_configs — just make sure parent linkage is right.
        if (existing.parent_agent_id !== parent.id) {
          const patchRes = await fetch(
            `${SUPABASE_URL}/rest/v1/agent_configs?id=eq.${existing.id}`,
            {
              method: 'PATCH',
              headers: { ...headers(), Prefer: 'return=minimal' },
              body: JSON.stringify({
                parent_agent_id: parent.id,
                updated_at: new Date().toISOString(),
              }),
            },
          );
          if (patchRes.ok) {
            existing.parent_agent_id = parent.id;
            parentUpdated++;
            parentResolved++;
          } else {
            parentSkipped.push({ child: subName, missing_parent: `parent_id=${parent.id} (patch failed ${patchRes.status})` });
          }
        } else {
          parentResolved++;
        }
        continue;
      }
      // Insert the sub-agent fresh, linked to parent.
      const tier = sub?.tier ?? 'Sonnet';
      const role = sub?.role ?? 'Specialist';
      const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/agent_configs`, {
        method: 'POST',
        headers: { ...headers(), Prefer: 'return=representation' },
        body: JSON.stringify({
          tenant_phone: cleanPhone,
          agent_name: subName,
          agent_role: role,
          status: 'active',
          output_channels: [],
          model_routing: { primary: tier },
          governance_rules: [],
          config: {
            description: sub?.description,
            tools: [],
            source: 'backfill:profile_team_sub',
          },
          parent_agent_id: parent.id,
        }),
      });
      if (insertRes.ok) {
        const rows = await insertRes.json();
        if (Array.isArray(rows) && rows[0]) {
          existingByName.set(subKey, { id: rows[0].id, parent_agent_id: parent.id });
          inserted++;
          parentResolved++;
        }
      }
    }
  }

  return {
    ok: true,
    tenant: cleanPhone,
    rows_inserted: inserted,
    rows_updated_parent: parentUpdated,
    parent_links_resolved: parentResolved,
    parent_links_skipped: parentSkipped,
    interpretation:
      inserted === 0 && parentUpdated === 0
        ? `Backfill complete — agent_configs was already in sync with profile.team. No inserts, no parent fixes needed.`
        : `Backfill complete — inserted ${inserted} missing agent_configs row${inserted === 1 ? '' : 's'} and fixed ${parentUpdated} parent_agent_id link${parentUpdated === 1 ? '' : 's'}. The deck can now safely read from agent_configs as the canonical source.`,
  };
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

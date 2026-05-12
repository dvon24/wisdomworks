/**
 * Phase 1C — Tenant system state for orchestrator triage.
 *
 * Iris (orchestrator) is the last gate before agent escalations land
 * on the owner's phone. To triage well she needs to know:
 *   - What's connected (projects, OAuth, agents)
 *   - What's NOT (so she suppresses agents complaining about known gaps)
 *   - What the owner recently said (atoms confirmed in the last week)
 *   - What's already pending in their approval queue
 *
 * Lighter version surfaces to ALL agents so they self-suppress before
 * escalating something Iris would just suppress anyway.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

export interface TenantSystemState {
  /** Projects with assigned agents + sync state */
  connected_projects: { project_name: string; provider: string; agent_name?: string; last_synced_at?: string; sync_error?: string }[];
  /** Active OAuth connections (email, calendar, instagram, etc.) */
  connected_services: { provider: string; service: string; account?: string }[];
  /** Agent roster + status */
  team: { agent_name: string; agent_role: string; status: string }[];
  /** Constraint/event/preference atoms confirmed by owner in last 7 days */
  recent_owner_directives: { kind: string; content: string }[];
  /** Pending items the owner already needs to look at */
  pending_approvals_count: number;
  /** Last time owner interacted (any direction) */
  last_owner_interaction_at: string | null;
}

async function tryGet<T>(path: string): Promise<T[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: headers() });
    return res.ok ? await res.json() : [];
  } catch {
    return [];
  }
}

export async function computeTenantSystemState(tenantPhone: string): Promise<TenantSystemState> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    projects,
    oauth,
    configs,
    instances,
    atoms,
    pending,
    profileRows,
  ] = await Promise.all([
    tryGet<any>(`project_connections?tenant_phone=eq.${tenantPhone}&status=eq.active&select=id,project_name,provider,agent_config_id,last_synced_at,last_sync_error`),
    tryGet<any>(`oauth_connections?phone_number=eq.${tenantPhone}&status=eq.active&select=provider,service,account_email`),
    tryGet<any>(`agent_configs?tenant_phone=eq.${tenantPhone}&select=id,agent_name,agent_role,status`),
    tryGet<any>(`agent_instances?tenant_phone=eq.${tenantPhone}&select=agent_config_id,status`),
    tryGet<any>(`tenant_knowledge_atoms?tenant_phone=eq.${tenantPhone}&owner_confirmed=eq.true&status=eq.active&created_at=gte.${sevenDaysAgo}&kind=in.(constraint,goal,event,preference)&order=created_at.desc&limit=10&select=kind,content`),
    tryGet<any>(`notification_queue?tenant_phone=eq.${tenantPhone}&status=eq.pending&select=id`),
    tryGet<any>(`whatsapp_contexts?phone_number=eq.${tenantPhone}&select=last_seen,profile&limit=1`),
  ]);

  const cfgById = new Map<string, any>();
  for (const c of configs) cfgById.set(c.id, c);
  const instByCfg = new Map<string, any>();
  for (const i of instances) instByCfg.set(i.agent_config_id, i);

  const profile = profileRows[0]?.profile ?? {};
  const lastSeen = profileRows[0]?.last_seen ?? profile.lastWhatsAppActivity ?? profile.lastDeckVisit ?? null;

  return {
    connected_projects: projects.map((p) => ({
      project_name: p.project_name,
      provider: p.provider,
      agent_name: p.agent_config_id ? cfgById.get(p.agent_config_id)?.agent_name : undefined,
      last_synced_at: p.last_synced_at,
      sync_error: p.last_sync_error,
    })),
    connected_services: oauth.map((o) => ({
      provider: o.provider,
      service: o.service,
      account: o.account_email,
    })),
    team: configs.map((c) => ({
      agent_name: c.agent_name,
      agent_role: c.agent_role,
      status: instByCfg.get(c.id)?.status ?? c.status ?? 'unknown',
    })),
    recent_owner_directives: atoms.map((a) => ({ kind: a.kind, content: a.content })),
    pending_approvals_count: pending.length,
    last_owner_interaction_at: lastSeen,
  };
}

/**
 * Render the state as a compact prompt block. Two variants:
 *   - `forOrchestrator: true` → full state + triage directive (Iris gets this)
 *   - `forOrchestrator: false` → lighter version every agent sees so they
 *     self-suppress before escalating known gaps
 */
export function renderSystemStateForPrompt(state: TenantSystemState, opts: { forOrchestrator: boolean }): string {
  const lines: string[] = [];

  // What's connected
  if (state.connected_projects.length > 0) {
    lines.push('CONNECTED PROJECTS:');
    for (const p of state.connected_projects) {
      const owner = p.agent_name ? ` (managed by ${p.agent_name})` : '';
      const sync = p.sync_error ? ` — sync ERROR: ${p.sync_error.slice(0, 80)}` : p.last_synced_at ? ` — synced ${p.last_synced_at.slice(0, 16).replace('T', ' ')}` : ' — awaiting first sync';
      lines.push(`  - ${p.project_name} (${p.provider})${owner}${sync}`);
    }
  } else {
    lines.push('CONNECTED PROJECTS: (none yet — agents have no project data; complaints about "no baseline" or "missing data" are a known gap, not an emergency)');
  }

  if (state.connected_services.length > 0) {
    lines.push('CONNECTED SERVICES:');
    const grouped = new Map<string, string[]>();
    for (const s of state.connected_services) {
      const list = grouped.get(s.service) ?? [];
      list.push(s.provider + (s.account ? `:${s.account}` : ''));
      grouped.set(s.service, list);
    }
    for (const [service, providers] of grouped.entries()) {
      lines.push(`  - ${service}: ${providers.join(', ')}`);
    }
  } else {
    lines.push('CONNECTED SERVICES: (none yet)');
  }

  if (state.team.length > 0) {
    const running = state.team.filter((a) => a.status === 'running').length;
    const paused = state.team.filter((a) => a.status === 'paused').length;
    lines.push(`TEAM: ${state.team.length} agents (${running} running${paused > 0 ? `, ${paused} paused` : ''})`);
  }

  if (state.recent_owner_directives.length > 0) {
    lines.push('RECENT OWNER DIRECTIVES (within 7 days, owner-confirmed):');
    for (const d of state.recent_owner_directives.slice(0, 6)) {
      lines.push(`  - [${d.kind}] ${d.content.slice(0, 150)}`);
    }
  }

  if (state.pending_approvals_count > 0) {
    lines.push(`PENDING APPROVALS already in owner's queue: ${state.pending_approvals_count}`);
  }

  if (state.last_owner_interaction_at) {
    const ago = Math.floor((Date.now() - new Date(state.last_owner_interaction_at).getTime()) / (60 * 1000));
    const phrase = ago < 60 ? `${ago}m ago` : ago < 60 * 24 ? `${Math.floor(ago / 60)}h ago` : `${Math.floor(ago / (60 * 24))}d ago`;
    lines.push(`LAST OWNER ACTIVITY: ${phrase}`);
  }

  if (lines.length === 0) return '';

  const header = opts.forOrchestrator
    ? 'TENANT SYSTEM STATE (you are the triage gate — review agent escalations against this before forwarding to the owner)'
    : 'TENANT SYSTEM STATE (read-only context — use to avoid escalating things that are KNOWN gaps)';

  const triageDirective = opts.forOrchestrator
    ? [
        '',
        'TRIAGE RULES FOR YOU (orchestrator):',
        '- BEFORE you escalate any agent\'s high-priority observation to the owner, cross-reference against state above.',
        '- If an agent is complaining about a project that is "(none yet)" in CONNECTED PROJECTS — that\'s a known gap. SUPPRESS the escalation, do not surface to owner. Notify the originating agent: "this is a known gap, sit tight."',
        '- If an agent is asking for data from a service that is NOT in CONNECTED SERVICES — same. Suppress + notify.',
        '- If the concern is a duplicate of something already in PENDING APPROVALS — suppress.',
        '- ONLY escalate things that are NOT known gaps and NOT already pending.',
        '- When suppressing, briefly note the reason in your observation so the owner can review the audit log if they want.',
      ].join('\n')
    : [
        '',
        'SELF-CHECK BEFORE YOU ESCALATE:',
        '- Is your concern about a project / service that is "(none yet)" above? If yes, that\'s a KNOWN GAP — do NOT escalate. Note it as observed and stop.',
        '- Is your concern already in PENDING APPROVALS? If yes, don\'t double-surface — note it briefly and stop.',
        '- Only escalate things that represent NEW signal not covered by the state above.',
      ].join('\n');

  return ['', header, ...lines, triageDirective].join('\n');
}

/**
 * Phase 1B — Team capability map.
 *
 * For each agent on a tenant, derive a short capability profile (their
 * lane, role, tools, connected services, assigned projects) so every
 * other agent knows who to consult on what.
 *
 * Derived at tick time from existing data (agent_configs, agent_instances,
 * oauth_connections, project_connections) — no separate capability table.
 * Refresh is implicit on every tick; no syncing needed.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

export interface TeammateCapability {
  agent_instance_id: string;
  agent_name: string;
  agent_role: string;
  lane: string | null;
  status: string;
  domain?: string | null;
  output_channels: string[];
  connected_services: string[];
  assigned_projects: string[];
  /** A 1-sentence "ask this agent when..." hint for other agents */
  ask_when: string;
}

export async function loadTeamCapabilities(tenantPhone: string): Promise<TeammateCapability[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];

  const [configRows, instanceRows, oauthRows, projectRows] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/agent_configs?tenant_phone=eq.${tenantPhone}&select=id,agent_name,agent_role,output_channels,config`, { headers: headers() }).then((r) => r.ok ? r.json() : []),
    fetch(`${SUPABASE_URL}/rest/v1/agent_instances?tenant_phone=eq.${tenantPhone}&select=id,agent_config_id,status`, { headers: headers() }).then((r) => r.ok ? r.json() : []),
    fetch(`${SUPABASE_URL}/rest/v1/oauth_connections?phone_number=eq.${tenantPhone}&status=eq.active&select=provider,service`, { headers: headers() }).then((r) => r.ok ? r.json() : []),
    fetch(`${SUPABASE_URL}/rest/v1/project_connections?tenant_phone=eq.${tenantPhone}&status=eq.active&select=project_name,agent_config_id,provider`, { headers: headers() }).then((r) => r.ok ? r.json() : []),
  ]);

  const instanceByConfigId = new Map<string, any>();
  for (const i of instanceRows) instanceByConfigId.set(i.agent_config_id, i);

  const projectsByConfigId = new Map<string, string[]>();
  for (const p of projectRows) {
    if (!p.agent_config_id) continue;
    const list = projectsByConfigId.get(p.agent_config_id) ?? [];
    list.push(p.project_name);
    projectsByConfigId.set(p.agent_config_id, list);
  }

  // OAuth connections are tenant-wide, not agent-specific — every agent
  // can see them, but the "owner" agent for each service is contextual.
  // For the capability map we list all connections under each agent that
  // matches the service's natural lane (e.g. email → personal assistant/exec coordinator).
  const allServices = oauthRows.map((o: any) => `${o.provider}/${o.service}`);

  return configRows.map((cfg: any) => {
    const inst = instanceByConfigId.get(cfg.id);
    const cat = cfg.config ?? {};
    const lane: string | null = cat.category ?? null;
    const askWhen = buildAskWhen(cfg, lane, projectsByConfigId.get(cfg.id) ?? [], allServices);

    return {
      agent_instance_id: inst?.id ?? cfg.id,
      agent_name: cfg.agent_name,
      agent_role: cfg.agent_role,
      lane,
      status: inst?.status ?? 'unknown',
      domain: cat.category_domain ?? null,
      output_channels: cfg.output_channels ?? [],
      connected_services: serviceForAgent(cfg, lane, allServices),
      assigned_projects: projectsByConfigId.get(cfg.id) ?? [],
      ask_when: askWhen,
    };
  });
}

/** Services the agent meaningfully interacts with — coarse rules based on lane. */
function serviceForAgent(cfg: any, lane: string | null, allServices: string[]): string[] {
  // Orchestrator + executive coordinator see everything
  if (lane === 'orchestrator' || /coordinator|executive|chief/i.test(cfg.agent_role ?? '')) {
    return allServices;
  }
  // Lane-specific
  const matches = allServices.filter((s) => {
    if (lane === 'operations' && /email|calendar/.test(s)) return true;
    if (lane === 'marketing' && /instagram|email/.test(s)) return true;
    if (lane === 'sales' && /email/.test(s)) return true;
    if (lane === 'finance' && /email/.test(s)) return true;
    return false;
  });
  return matches;
}

/** One-line "ask <agent> when..." hint other agents read in their prompt. */
function buildAskWhen(cfg: any, lane: string | null, projects: string[], allServices: string[]): string {
  const parts: string[] = [];
  const role = cfg.agent_role ?? '';
  const cat = cfg.config ?? {};
  if (cat.category_domain) parts.push(cat.category_domain);

  // Heuristic role-derived asks
  if (/orchestrator|personal assistant|chief of staff/i.test(role)) {
    parts.push("anything cross-lane, owner's preferences/goals, scheduling priorities");
  }
  if (/coordinator|executive/i.test(role)) {
    parts.push("the owner's calendar, email triage, daily activity priorities");
  }
  if (/operations|ops/i.test(role)) {
    parts.push('vendor accounts, tool configuration, platform-wide operational state');
  }
  if (/marketing|brand|content/i.test(role)) {
    parts.push('positioning, customer-facing messaging, channel-specific outreach');
  }
  if (/sales|biz dev|account/i.test(role)) {
    parts.push('pipeline, deals, customer follow-ups');
  }
  if (/finance|accounting|book/i.test(role)) {
    parts.push('revenue, expenses, billing, invoicing');
  }
  if (/legal|compliance/i.test(role)) {
    parts.push('contracts, terms, compliance');
  }
  if (/director|product/i.test(role) && projects.length > 0) {
    parts.push(`the project(s) they own: ${projects.join(', ')}`);
  }
  if (parts.length === 0) {
    parts.push(role);
  }
  return parts.slice(0, 2).join('; ');
}

/** Render the team capability map for inclusion in an agent's prompt.
 * `selfAgentName` is excluded so the agent doesn't see themselves in the list. */
export function renderCapabilityMapForPrompt(team: TeammateCapability[], selfAgentName: string): string {
  const others = team.filter((t) => t.agent_name !== selfAgentName);
  if (others.length === 0) return '';

  const lines = others.map((t) => {
    const projects = t.assigned_projects.length > 0 ? ` · owns: ${t.assigned_projects.join(', ')}` : '';
    const services = t.connected_services.length > 0 ? ` · uses: ${t.connected_services.slice(0, 3).join(', ')}` : '';
    return `  - ${t.agent_name} (${t.agent_role}${t.status === 'paused' ? ', PAUSED' : ''}) — ask when: ${t.ask_when}${projects}${services}`;
  });

  return [
    '',
    'TEAM CAPABILITY MAP (your teammates and what they know — use consult_peer when your work crosses into their domain):',
    ...lines,
    '',
    'CONSULT RULES:',
    '- BEFORE you set escalation_priority="high", consult ONE relevant peer if their domain meaningfully overlaps with your concern. They answer on their next tick (~5 min); you incorporate the answer on the tick after.',
    '- Skip the consult if the issue is fully within your lane and well-understood.',
    '- Never consult the agent who just consulted you (loop).',
    '- Max 1 peer consult per tick. Pick the most relevant.',
  ].join('\n');
}

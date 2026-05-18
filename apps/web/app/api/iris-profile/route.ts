/**
 * GET /api/iris-profile?phone=<tenant>
 *
 * Powers the "What Iris Has Learned About You" deck page (Package 1
 * of the unified-trust-model build — see project_unified_trust_model.md).
 *
 * Returns a snapshot of everything the system has learned about this
 * owner + their team, structured for owner-facing presentation:
 *
 *   - disposition: grouped active disposition rules per kind
 *   - agents:      per-agent SOPs (structured mode, not the narrative
 *                  Sonnet pass — that's owner-on-demand only)
 *   - learning_stats: top-level counters so the page can render
 *                     "Iris has learned 17 rules about you over 23 days"
 *
 * Auth: same session-cookie pattern as /api/dashboard. Phone in query
 * must match the cookie's claim.
 *
 * Read-only — no mutation surface here. Dismissal happens via the
 * existing `forget_disposition_rule` Iris tool path (which the deck
 * page can also call via /api/whatsapp or a dedicated dismiss endpoint
 * — TODO when the page actually ships).
 */

import { verifySessionToken } from '../_lib/api-auth';
import { listActiveDispositionRules, type DispositionRule } from '../_lib/disposition-mining';
import { buildAgentSop, type AgentSop } from '../_lib/agent-sop';

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

interface DispositionGroup {
  kind: DispositionRule['kind'];
  label: string;
  rules: Array<{
    id: string;
    rule_text: string;
    why?: string;
    evidence?: string;
    scope: string;
    confidence: number;
    applied_count: number;
    last_applied_at?: string | null;
    created_at: string;
  }>;
}

interface AgentSopSummary {
  agent_name: string;
  agent_role: string;
  lane?: string;
  description?: string;
  recent_activity: AgentSop['recent_activity'];
  capabilities: string[];
  proven_techniques: AgentSop['proven_techniques'];
  guardrails: AgentSop['guardrails'];
  domain_facts: AgentSop['domain_facts'];
  /** Package 2 — per-agent owner praise summary. */
  owner_affirmations: AgentSop['owner_affirmations'];
  /** True when the agent has no activity in the 14-day window — UI
   *  renders the "idle" placeholder instead of an outcome breakdown. */
  idle?: boolean;
}

interface IrisProfile {
  tenant_phone: string;
  computed_at: string;
  learning_stats: {
    total_rules: number;
    rules_by_kind: Record<string, number>;
    agents_with_skills: number;
    total_skills: number;
    earliest_rule_created_at: string | null;
    most_recent_rule_at: string | null;
  };
  disposition: DispositionGroup[];
  agents: AgentSopSummary[];
}

const KIND_LABELS: Record<DispositionRule['kind'], string> = {
  preference: 'How you like things done',
  correction: 'Things you\'ve corrected',
  approval: 'Approaches you\'ve approved',
  frustration_trigger: 'Things that frustrate you',
  communication_style: 'How you communicate',
};

const KIND_ORDER: DispositionRule['kind'][] = [
  'preference',
  'frustration_trigger',
  'communication_style',
  'correction',
  'approval',
];

export async function GET(request: Request) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return Response.json({ error: 'supabase not configured' }, { status: 500 });
  }

  const url = new URL(request.url);
  const phone = url.searchParams.get('phone');
  if (!phone) {
    return Response.json({ error: 'phone query param required' }, { status: 400 });
  }
  const cleanRequested = phone.replace(/[\s\-+()]/g, '');

  // Auth — session cookie must match the requested phone (or owner-token
  // admin override).
  const auth = request.headers.get('authorization');
  const ownerToken = process.env.OWNER_API_TOKEN;
  const isOwnerToken = ownerToken && auth === `Bearer ${ownerToken}`;
  if (!isOwnerToken) {
    const cookieHeader = request.headers.get('cookie') ?? '';
    const sessionMatch = cookieHeader.match(/(?:^|;\s*)ww_session=([^;]+)/);
    if (!sessionMatch) return Response.json({ error: 'no session' }, { status: 401 });
    const verified = await verifySessionToken(decodeURIComponent(sessionMatch[1]!));
    if (!verified) return Response.json({ error: 'invalid session' }, { status: 401 });
    const cookiePhone = verified.phone.replace(/[\s\-+()]/g, '');
    if (cookiePhone !== cleanRequested) {
      return Response.json({ error: 'phone mismatch' }, { status: 403 });
    }
  }

  // ─── Disposition: group active rules by kind ─────────────────────────
  const rules = await listActiveDispositionRules(cleanRequested);
  const dispositionByKind = new Map<DispositionRule['kind'], DispositionGroup>();
  for (const kind of KIND_ORDER) {
    dispositionByKind.set(kind, { kind, label: KIND_LABELS[kind], rules: [] });
  }
  let earliestCreated: string | null = null;
  let mostRecentRule: string | null = null;
  const rulesByKindCount: Record<string, number> = {};
  for (const r of rules) {
    const group = dispositionByKind.get(r.kind);
    if (group) {
      group.rules.push({
        id: r.id,
        rule_text: r.rule_text,
        why: r.why,
        evidence: r.evidence,
        scope: r.scope,
        confidence: r.confidence,
        applied_count: r.applied_count,
        last_applied_at: r.last_applied_at,
        created_at: r.created_at,
      });
    }
    rulesByKindCount[r.kind] = (rulesByKindCount[r.kind] ?? 0) + 1;
    if (!earliestCreated || r.created_at < earliestCreated) earliestCreated = r.created_at;
    if (!mostRecentRule || r.created_at > mostRecentRule) mostRecentRule = r.created_at;
  }

  // ─── Agents: per-agent SOPs ─────────────────────────────────────────
  // Source set: union of agent_configs rows AND user.profile.team
  // entries. The chat-side team profile sometimes has agents that
  // were added before the 2026-05-15 fix that started writing
  // add_agent_to_team into agent_configs — those agents would
  // otherwise be invisible here. We backfill them as minimal SOPs
  // so the owner sees the full team they think they have.
  const [agentsRes, ctxRes] = await Promise.all([
    fetch(
      `${SUPABASE_URL}/rest/v1/agent_configs?tenant_phone=eq.${cleanRequested}&status=neq.removed&select=agent_name&order=created_at.asc`,
      { headers: headers() },
    ),
    fetch(
      `${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${cleanRequested}&select=profile&limit=1`,
      { headers: headers() },
    ),
  ]);
  const agentRows: Array<{ agent_name: string }> = agentsRes.ok ? await agentsRes.json() : [];
  const knownNames = new Set(agentRows.map((a) => a.agent_name.toLowerCase()));

  // Pull team-profile agents (including sub-team agents) that aren't
  // already in agent_configs.
  let extraTeamAgents: Array<{ name: string; role: string; description?: string }> = [];
  if (ctxRes.ok) {
    const ctxRows = await ctxRes.json();
    const team = ctxRows?.[0]?.profile?.team ?? [];
    const collect = (entry: any) => {
      if (!entry?.name) return;
      if (knownNames.has(String(entry.name).toLowerCase())) return;
      extraTeamAgents.push({
        name: entry.name,
        role: entry.role ?? 'Team member',
        description: entry.description,
      });
      knownNames.add(String(entry.name).toLowerCase());
    };
    for (const top of team) {
      collect(top);
      for (const sub of top.subTeam?.agents ?? []) collect(sub);
    }
  }

  // Parallelize SOP builds — each one runs ~3-5 DB queries.
  const sops = await Promise.all(
    agentRows.map(async (a) => {
      const sop = await buildAgentSop(cleanRequested, a.agent_name, { mode: 'structured' });
      if (!sop) return null;
      const summary: AgentSopSummary = {
        agent_name: sop.agent_name,
        agent_role: sop.agent_role,
        lane: sop.lane,
        description: sop.description,
        recent_activity: sop.recent_activity,
        capabilities: sop.capabilities,
        proven_techniques: sop.proven_techniques,
        guardrails: sop.guardrails,
        domain_facts: sop.domain_facts,
        owner_affirmations: sop.owner_affirmations,
        idle: sop.idle,
      };
      return summary;
    }),
  );
  const agents = sops.filter((s): s is AgentSopSummary => s !== null);

  // Append team-profile-only agents as minimal SOPs (no recent_activity
  // — they don't have agent_configs/agent_instances rows yet so there's
  // nothing to query). Marked idle so the UI can render the placeholder.
  for (const t of extraTeamAgents) {
    agents.push({
      agent_name: t.name,
      agent_role: t.role,
      description: t.description ?? 'On the team — no operational rows yet (this agent was added before the agent_configs backfill landed; their behavior is captured in the chat profile but not yet promoted to a runtime instance).',
      recent_activity: { total_ticks: 0, by_outcome: {}, sample_outputs: [], last_acted_at: null },
      capabilities: [],
      proven_techniques: [],
      guardrails: [],
      domain_facts: [],
      owner_affirmations: { net_score: 0, last_affirmed_at: null, recent_affirmations: [], by_kind: {} },
      idle: true,
    });
  }

  // ─── Skill totals across all agents (page-level counter) ──────────────
  let totalSkills = 0;
  let agentsWithSkills = 0;
  for (const a of agents) {
    if (a.proven_techniques.length > 0) {
      agentsWithSkills++;
      totalSkills += a.proven_techniques.length;
    }
  }

  const profile: IrisProfile = {
    tenant_phone: cleanRequested,
    computed_at: new Date().toISOString(),
    learning_stats: {
      total_rules: rules.length,
      rules_by_kind: rulesByKindCount,
      agents_with_skills: agentsWithSkills,
      total_skills: totalSkills,
      earliest_rule_created_at: earliestCreated,
      most_recent_rule_at: mostRecentRule,
    },
    disposition: KIND_ORDER.map((k) => dispositionByKind.get(k)!).filter((g) => g.rules.length > 0),
    agents,
  };

  return Response.json(profile);
}

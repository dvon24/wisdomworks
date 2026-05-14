/**
 * Story 2.1 (foundation) — Agent Execution Runtime.
 *
 * The full vision is each agent_instance running as a LangGraph state
 * machine in its own service process. This file is the FOUNDATION:
 *
 *   - Lifecycle helpers (startTenantAgents / stopTenantAgents) that flip
 *     agent_instances.status between ready / running / paused / stopped.
 *   - tickAgent(): wakes one agent, respects its operating_protocol, runs
 *     its primary loop placeholder, logs the run to agent_runs.
 *   - tickRunningAgents(): the cron entry point — finds every agent_instance
 *     with status='running' for any tenant and fires tickAgent on each.
 *
 * The "primary loop placeholder" is intentionally minimal: it logs that the
 * agent woke up. Real BMAD reasoning + tool invocation lands in 2.1b/2.4
 * once the signal layer exists.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

interface AgentInstanceRow {
  id: string;
  tenant_phone: string;
  agent_config_id: string;
  status: string;
  metadata: any;
}

interface AgentConfigRow {
  id: string;
  agent_name: string;
  agent_role: string;
  model_routing: any;
  output_channels: string[];
  config?: {
    category?: string;
    category_label?: string;
    category_emoji?: string;
    category_domain?: string;
    description?: string;
    [key: string]: unknown;
  };
}

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

async function setInstanceStatus(instanceId: string, status: 'ready' | 'running' | 'paused' | 'stopped' | 'error') {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  await fetch(`${SUPABASE_URL}/rest/v1/agent_instances?id=eq.${instanceId}`, {
    method: 'PATCH',
    headers: { ...headers(), Prefer: 'return=minimal' },
    body: JSON.stringify({ status }),
  });
}

async function logRun(row: {
  tenant_phone: string;
  agent_instance_id: string;
  trigger: 'tick' | 'signal' | 'manual' | 'startup';
  outcome: 'no_op' | 'observed' | 'acted' | 'proposed' | 'escalated' | 'failed' | 'blocked_by_governance';
  phase?: string;
  model_used?: string;
  input_summary?: string;
  output_summary?: string;
  duration_ms?: number;
  tokens_in?: number;
  tokens_out?: number;
  error?: string;
  metadata?: Record<string, unknown>;
  delegated_to_lane?: string | null;
  delegation_reason?: string | null;
  delegation_status?: 'pending' | 'claimed' | 'done' | 'declined' | null;
}, returnId = false): Promise<string | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/agent_runs`, {
    method: 'POST',
    headers: { ...headers(), Prefer: returnId ? 'return=representation' : 'return=minimal' },
    body: JSON.stringify(row),
  });
  if (returnId && res.ok) {
    try {
      const rows = await res.json();
      return rows?.[0]?.id ?? null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Start every ready agent for a tenant — flips ready → running */
export async function startTenantAgents(tenantPhone: string): Promise<{ started: number; alreadyRunning: number }> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { started: 0, alreadyRunning: 0 };
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/agent_instances?tenant_phone=eq.${cleanPhone}&status=in.(ready,running)&select=id,status`,
    { headers: headers() },
  );
  if (!res.ok) return { started: 0, alreadyRunning: 0 };
  const rows = await res.json() as { id: string; status: string }[];
  let started = 0;
  let alreadyRunning = 0;
  for (const row of rows) {
    if (row.status === 'running') {
      alreadyRunning++;
      continue;
    }
    await setInstanceStatus(row.id, 'running');
    await logRun({
      tenant_phone: cleanPhone,
      agent_instance_id: row.id,
      trigger: 'startup',
      outcome: 'observed',
      output_summary: 'Agent started — entering observation loop.',
    });
    started++;
  }
  return { started, alreadyRunning };
}

/** Stop every running agent for a tenant — flips running → paused */
export async function stopTenantAgents(tenantPhone: string): Promise<{ stopped: number; snapshots: number }> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { stopped: 0, snapshots: 0 };
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  // Pull the full state row so we can snapshot before flipping to paused —
  // Story 2.10 'shutdown' reason. If we crash between snapshot and the
  // status flip, worst case we have an extra snapshot the user can recover
  // from. Cheap insurance against losing state on a forced pause.
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/agent_instances?tenant_phone=eq.${cleanPhone}&status=eq.running&select=id,tenant_phone,state_data,metadata,nats_subjects,signal_connections`,
    { headers: headers() },
  );
  if (!res.ok) return { stopped: 0, snapshots: 0 };
  const rows = await res.json() as any[];
  let snapshots = 0;
  for (const row of rows) {
    try {
      const { saveSnapshot } = await import('./state-recovery');
      const id = await saveSnapshot(row, 'shutdown');
      if (id) snapshots++;
    } catch (err) {
      console.warn('[stopTenantAgents] shutdown snapshot failed:', err);
    }
    await setInstanceStatus(row.id, 'paused');
  }
  return { stopped: rows.length, snapshots };
}

// ─── Adaptive tick cadence ────────────────────────────────────────────────
// Cron fires every 5 min, but each tenant has its own target cadence based
// on how recently the user has been engaging. Active users get fast ticks
// so agents feel responsive; sleeping users get slow ticks so we don't burn
// tokens on dead air.

interface TickCadence {
  minutes: number;
  band: 'active' | 'recent' | 'normal' | 'quiet' | 'asleep';
  lastUserActivityMinAgo: number;
}

/** Compute when the last meaningful user signal happened across all sources. */
async function lastUserActivity(tenantPhone: string): Promise<Date | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  // Pull the freshest of: last_seen on whatsapp_contexts, profile.lastDeckVisit
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${tenantPhone}&select=last_seen,profile`,
    { headers: headers() },
  );
  if (!res.ok) return null;
  const rows = await res.json();
  const r = rows[0];
  if (!r) return null;
  const candidates: number[] = [];
  if (r.last_seen) candidates.push(new Date(r.last_seen).getTime());
  if (r.profile?.lastDeckVisit) candidates.push(new Date(r.profile.lastDeckVisit).getTime());
  if (r.profile?.lastWhatsAppActivity) candidates.push(new Date(r.profile.lastWhatsAppActivity).getTime());
  if (candidates.length === 0) return null;
  return new Date(Math.max(...candidates));
}

export async function computeCadence(tenantPhone: string): Promise<TickCadence> {
  const last = await lastUserActivity(tenantPhone);
  if (!last) return { minutes: 60, band: 'quiet', lastUserActivityMinAgo: -1 };
  const minAgo = (Date.now() - last.getTime()) / 60_000;
  if (minAgo < 30) return { minutes: 5, band: 'active', lastUserActivityMinAgo: minAgo };
  if (minAgo < 120) return { minutes: 10, band: 'recent', lastUserActivityMinAgo: minAgo };
  if (minAgo < 360) return { minutes: 15, band: 'normal', lastUserActivityMinAgo: minAgo };
  if (minAgo < 1440) return { minutes: 60, band: 'quiet', lastUserActivityMinAgo: minAgo };
  return { minutes: 240, band: 'asleep', lastUserActivityMinAgo: minAgo };
}

/**
 * Has enough time passed since the last tick for this tenant to fire again,
 * given their adaptive cadence?
 */
async function shouldTickTenant(tenantPhone: string): Promise<{ should: boolean; cadence: TickCadence; minSinceLastTick: number }> {
  const cadence = await computeCadence(tenantPhone);
  if (!SUPABASE_URL || !SUPABASE_KEY) return { should: true, cadence, minSinceLastTick: 0 };
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${tenantPhone}&select=profile`,
    { headers: headers() },
  );
  const rows = res.ok ? await res.json() : [];
  const last = rows[0]?.profile?.lastTickAt;
  const minSince = last ? (Date.now() - new Date(last).getTime()) / 60_000 : Infinity;
  return { should: minSince >= cadence.minutes, cadence, minSinceLastTick: minSince };
}

async function recordTickAt(tenantPhone: string, cadence: TickCadence): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  // Read-modify-write profile so we don't clobber other keys
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${tenantPhone}&select=profile`,
    { headers: headers() },
  );
  if (!res.ok) return;
  const rows = await res.json();
  const profile = rows[0]?.profile ?? {};
  profile.lastTickAt = new Date().toISOString();
  profile.tickCadenceMinutes = cadence.minutes;
  profile.tickBand = cadence.band;
  await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${tenantPhone}`, {
    method: 'PATCH',
    headers: { ...headers(), Prefer: 'return=minimal' },
    body: JSON.stringify({ profile }),
  });
}

// ─── Story 2.1b — real reasoning helpers ─────────────────────────────────

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const WHATSAPP_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const GRAPH_API = 'https://graph.facebook.com/v25.0';

interface TickContext {
  orgName: string;
  orgIndustry: string;
  documentationText: string;
  connections: { provider: string; service: string; account_email?: string }[];
  recentRunsForAgent: { outcome: string; output_summary?: string; started_at: string }[];
  cadence: TickCadence;
  /** Story 2.4 — pending delegations targeted at THIS agent's lane */
  pendingDelegations: PendingDelegation[];
  /** Story 2.15 — proven techniques the lane has learned */
  appliedSkills: AppliedSkill[];
  /** Au7o-style project connections this agent owns + their latest snapshot summaries */
  projects: AssignedProject[];
  /** Real humans the owner has told us about + auto-mined from email signatures */
  knownPeople: KnownPerson[];
  /** Names of every agent on this tenant's team — used to disambiguate "Alex the agent" vs "Alex the person" */
  teammateNames: string[];
  /** Phase 1A — atoms mined from the owner's WhatsApp messages */
  knowledgeAtoms: KnowledgeAtom[];
  /** Phase 1C — tenant system state for triage (what's connected, known gaps, recent directives) */
  systemState: TenantSystemState;
  /** Phase 1B — team capability map (other agents' domains) for cross-lane consultation */
  teamCapabilities: TeammateCapability[];
  /** Phase 1B — pending consults TO this agent (they need to answer one) */
  consultInbox: InboxConsult[];
  /** Phase 1B — answers FROM peers waiting to be folded into this agent's reasoning */
  consultOutbox: OutboxConsult[];
  /** Lane routing — pending email drafts assigned to this agent's lane */
  laneInbox: LaneInboxItem[];
}

export interface LaneInboxItem {
  id: string;
  from: string;
  subject: string;
  classification: string;
  draftReply?: string;
  lane: string;
}

interface AssignedProject {
  connection_id: string;
  project_name: string;
  provider: string;
  capability_tier: number;
  deploy_url?: string;
  repo_url?: string;
  summary?: string;
  diff_summary?: string;
  taken_at?: string;
  /** Number of ticks since the agent was assigned this project — drives the
   * "first 3 ticks = investigate" guidance in the prompt. */
  ticks_since_assignment?: number;
}

// Story 2.10 — periodic snapshots after each successful tick.
import { saveSnapshot } from './state-recovery';
// DND / mute — proactive pushes are silenced when the user said "talk later"
import { isMuted } from './mute-state';
// Notification queue — bundle all proactive items into scheduled digests
import { enqueueNotification } from './notifications';
// Project connections — agents see the latest snapshot of their assigned projects
import { loadConnectionsForAgent, loadLatestSnapshot } from './project-sync';
// Known people registry — disambiguates "Ron the attorney" from "Alex the agent"
import { listKnownPeople, renderKnownPeopleForPrompt, type KnownPerson } from './known-people';
// Phase 1A — conversation atoms mined from owner's WhatsApp messages
import { recentAtomsForPrompt, renderAtomsForPrompt, type KnowledgeAtom } from './knowledge-atoms';
// Phase 1C — tenant system state for orchestrator triage
import { computeTenantSystemState, renderSystemStateForPrompt, type TenantSystemState } from './tenant-system-state';
// Phase 1B — peer consultations + capability map
import { loadTeamCapabilities, renderCapabilityMapForPrompt, type TeammateCapability } from './capability-map';
import { consultInboxForAgent, consultOutboxForAgent, markConsultsFolded, askPeer, answerConsult, type InboxConsult, type OutboxConsult } from './consultations';
// Story 2.15 — skill formation + cross-agent learning.
import {
  topSkillsForLane,
  upsertSkill,
  recordSkillOutcome,
  extractSkillFromRun,
  renderSkillsForPrompt,
  type AppliedSkill,
} from './skill-formation';

// ─── Story 2.4 — Signal layer (delegation pickup) ─────────────────────────
// Agents read pending delegations targeting their lane on each tick and
// claim them. Postgres serves as the bus — no NATS required for now.

interface PendingDelegation {
  id: string;
  delegated_to_lane: string;
  delegation_reason: string;
  output_summary: string;
  metadata: any;
  started_at: string;
}

async function fetchPendingDelegationsForLane(tenantPhone: string, lane: string): Promise<PendingDelegation[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/agent_runs?tenant_phone=eq.${tenantPhone}&delegated_to_lane=eq.${lane}&delegation_status=eq.pending&order=started_at.asc&limit=5&select=id,delegated_to_lane,delegation_reason,output_summary,metadata,started_at`,
    { headers: headers() },
  );
  return res.ok ? await res.json() : [];
}

async function markDelegationsDone(ids: string[]): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY || ids.length === 0) return;
  await fetch(
    `${SUPABASE_URL}/rest/v1/agent_runs?id=in.(${ids.join(',')})`,
    {
      method: 'PATCH',
      headers: { ...headers(), Prefer: 'return=minimal' },
      body: JSON.stringify({ delegation_status: 'done' }),
    },
  );
}

/** Pull pending email drafts whose `lane` matches the agent's lane. Drafts
 *  are written into whatsapp_contexts.profile.pendingEmailDrafts by the
 *  email-sift cron. */
async function loadLaneInbox(tenantPhone: string, ownLane?: string): Promise<LaneInboxItem[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY || !ownLane) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${tenantPhone}&select=profile`,
      { headers: headers() },
    );
    if (!res.ok) return [];
    const rows = await res.json();
    const drafts: any[] = rows[0]?.profile?.pendingEmailDrafts ?? [];
    return drafts
      .filter((d: any) => (d.lane ?? 'orchestrator') === ownLane)
      .map((d: any) => ({
        id: d.id,
        from: d.from,
        subject: d.subject,
        classification: d.classification ?? 'informational',
        draftReply: d.draftReply,
        lane: d.lane ?? 'orchestrator',
      }));
  } catch {
    return [];
  }
}

async function loadTickContext(tenantPhone: string, instanceId: string, ownLane?: string, agentConfigId?: string): Promise<TickContext> {
  const cadence = await computeCadence(tenantPhone);
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return { orgName: '', orgIndustry: '', documentationText: '', connections: [], recentRunsForAgent: [], cadence, pendingDelegations: [], appliedSkills: [], projects: [], knownPeople: [], teammateNames: [], knowledgeAtoms: [], systemState: { connected_projects: [], connected_services: [], team: [], recent_owner_directives: [], pending_approvals_count: 0, last_owner_interaction_at: null }, teamCapabilities: [], consultInbox: [], consultOutbox: [], laneInbox: [] };
  }

  // Three small queries in parallel — context tab kept tight on purpose.
  const [ctxRes, docRes, connRes, runsRes] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${tenantPhone}&select=business_name,business_type`, { headers: headers() }),
    fetch(`${SUPABASE_URL}/rest/v1/ontology_entities?tenant_phone=eq.${tenantPhone}&entity_type=eq.documentation&select=metadata&order=updated_at.desc&limit=1`, { headers: headers() }),
    fetch(`${SUPABASE_URL}/rest/v1/oauth_connections?phone_number=eq.${tenantPhone}&status=eq.active&select=provider,service,account_email`, { headers: headers() }),
    fetch(`${SUPABASE_URL}/rest/v1/agent_runs?agent_instance_id=eq.${instanceId}&order=started_at.desc&limit=3&select=outcome,output_summary,started_at`, { headers: headers() }),
  ]);

  const ctxRows = ctxRes.ok ? await ctxRes.json() : [];
  const docRows = docRes.ok ? await docRes.json() : [];
  const connRows = connRes.ok ? await connRes.json() : [];
  const runRows = runsRes.ok ? await runsRes.json() : [];

  // Story 2.4 — pull pending delegations targeting THIS agent's lane.
  // Caller passes ownLane so we don't have to look up the config again.
  const pendingDelegations = ownLane ? await fetchPendingDelegationsForLane(tenantPhone, ownLane) : [];

  // Story 2.15 — pull the lane's top proven techniques. Cap at 5 to keep
  // the prompt tight; the RPC ranks new skills first to give them a shot.
  const appliedSkills = ownLane ? await topSkillsForLane(tenantPhone, ownLane, 5) : [];

  // Au7o / project-connections — if this agent owns any external projects
  // (Vercel + GitHub, Wix, etc.), pull the latest snapshot summary for each.
  // For "ticks_since_assignment" we use the count of recent ticks since the
  // connection was created (approximate — drives first-3-ticks investigation).
  let projects: AssignedProject[] = [];
  if (agentConfigId) {
    try {
      const conns = await loadConnectionsForAgent(agentConfigId);
      for (const c of conns) {
        const snap = await loadLatestSnapshot(c.id);
        projects.push({
          connection_id: c.id,
          project_name: c.project_name,
          provider: c.provider,
          capability_tier: c.capability_tier,
          deploy_url: c.metadata?.deploy_url,
          repo_url: c.metadata?.repo_url,
          summary: snap?.summary,
          diff_summary: snap?.diff_summary,
          taken_at: snap?.taken_at,
        });
      }
    } catch (err) {
      console.warn('[agent-runtime] project context fetch failed:', err);
    }
  }

  // Known people registry + teammate names — disambiguation context for
  // every agent's tick prompt. Plus Phase 1A atoms mined from owner chat.
  // Plus Phase 1C system state for triage. Plus Phase 1B consult inbox/outbox.
  const [knownPeople, teammates, knowledgeAtoms, systemState, teamCapabilities, consultInbox, consultOutbox, laneInbox] = await Promise.all([
    listKnownPeople(tenantPhone),
    fetch(
      `${SUPABASE_URL}/rest/v1/agent_configs?tenant_phone=eq.${tenantPhone}&select=agent_name`,
      { headers: headers() },
    ).then((r) => r.ok ? r.json() : []).catch(() => []),
    recentAtomsForPrompt(tenantPhone, ownLane, 15),
    computeTenantSystemState(tenantPhone),
    loadTeamCapabilities(tenantPhone),
    consultInboxForAgent(instanceId),
    consultOutboxForAgent(instanceId, 30),
    loadLaneInbox(tenantPhone, ownLane),
  ]);
  const teammateNames: string[] = (teammates ?? []).map((t: any) => t.agent_name).filter(Boolean);

  return {
    orgName: ctxRows[0]?.business_name ?? '',
    orgIndustry: ctxRows[0]?.business_type ?? '',
    documentationText: docRows[0]?.metadata?.text ?? '',
    connections: connRows ?? [],
    recentRunsForAgent: runRows ?? [],
    cadence,
    pendingDelegations,
    appliedSkills,
    projects,
    knownPeople,
    teammateNames,
    knowledgeAtoms,
    systemState,
    teamCapabilities,
    consultInbox,
    consultOutbox,
    laneInbox,
  };
}

type LaneId = 'orchestrator' | 'operations' | 'sales' | 'marketing' | 'support' | 'finance' | 'analytics' | 'creative' | 'people' | 'technical' | 'legal' | 'specialist';

interface ReasoningResult {
  observation: string;
  recommendation: string;
  requires_action: boolean;
  escalation_priority: 'none' | 'low' | 'medium' | 'high';
  proposed_action?: string;
  /** Specialist agents: if observed work belongs to another lane, name it. */
  delegate_to_lane?: LaneId | null;
  /** Why this should be delegated (one short sentence). */
  delegation_reason?: string;
  /** Orchestrator only: fan out to multiple lanes when work needs multi-input. */
  delegations?: { lane: LaneId; reason: string }[];
  /** Story 2.11 — BMAD: when an agent spots a recurring pattern or systemic
   *  improvement, it returns a solution brief. Optional, sparing. */
  solution_brief?: {
    problem: string;
    proposed_solution: string;
    expected_impact: string;
    confidence: number; // 0-1
    risk: 'low' | 'medium' | 'high';
  } | null;
  /** Story 2.15 — if the agent applied a learned technique this tick,
   *  echo back its signature so we can record success/failure. */
  applied_skill_signature?: string | null;
  /** Phase 1B — if the agent decided to consult a peer this tick, name them + the question */
  consult?: { peer_name: string; question: string; reason?: string } | null;
  /** Phase 1B — if the agent received a consult and is answering, populate */
  answer_to_consult?: { consult_id: string; answer: string } | null;
}

function buildAgentSystemPrompt(config: AgentConfigRow, autonomy: string, ctx: TickContext): string {
  const tools = (config.output_channels ?? []).join(', ');
  const connList = ctx.connections.map((c) => `${c.provider}/${c.service}`).join(', ') || 'none';
  const recentRuns = ctx.recentRunsForAgent.length
    ? ctx.recentRunsForAgent.map((r) => `  - [${r.outcome}] ${r.output_summary?.slice(0, 100) ?? ''}`).join('\n')
    : '  (none)';
  const cat = config.config ?? {};
  const categoryHeader = cat.category_label
    ? `${cat.category_emoji ?? ''} ${cat.category_label}`.trim()
    : '';
  const categoryDomain = cat.category_domain ? `Your category covers: ${cat.category_domain}.` : '';

  const isOrchestrator = cat.category === 'orchestrator';
  const laneRule = isOrchestrator
    ? `YOU ARE THE ORCHESTRATOR\nYou span all lanes by design. Your job is to spot work that needs multiple specialists and fan it out. When something needs multi-lane input, populate the "delegations" array (plural) with one entry per lane that should weigh in. When something is straightforward and belongs to a single lane, use "delegate_to_lane" (singular). When you can answer it yourself, do.`
    : `STAY IN YOUR LANE\nYou only own work that fits the category above. If you observe something that belongs to a different lane (sales/marketing/operations/finance/support/technical/etc), set "delegate_to_lane" to that lane and explain in "delegation_reason". Do NOT claim other domains' work. Do NOT use the "delegations" plural array — that's only for the orchestrator.`;

  // Lane-specific template workflows — each lane gets canonical tool
  // sequences baked into the prompt so agents reach for the right tools
  // in the right order rather than improvising every time.
  let templateWorkflow = '';
  if (cat.category === 'marketing') {
    templateWorkflow = `\n\nCANONICAL MARKETING WORKFLOW (video reel pipeline):
When the owner asks for marketing content (a reel, video, post about X), follow this sequence:
  1. estimate_video_cost(quality) → surface the cost up front (third-party cost transparency)
  2. Check for a saved style if relevant — list_marketing_styles or use style_name on generate
  3. generate_marketing_video(prompt, quality, style_name?) → produces an MP4 URL via Replicate
  4. send_video_preview(video_url, caption) → drops the video into the owner's WhatsApp
  5. Wait for explicit approval. If approved: publish_instagram_reel(video_url, caption). Optionally cross-post via publish_facebook_post.
  6. If the owner asks to regenerate or change tone: loop back to step 3 with adjusted prompt.

STYLE MEMORY:
- When the owner describes a "look" they want repeated, offer to save_marketing_style so it's reusable.
- When asked for a reel about X, ALWAYS check if a saved style applies — brand consistency matters.

PROACTIVE DRAFTS (L3):
- On L3 autonomy, the marketing-loop cron proposes drafts on cadence and queues them for the owner's digest. They show up via list_marketing_drafts.
- When the owner replies with an approval/dismiss intent on a short id ("approve 7f3a9b1c", "dismiss the salon one"), call approve_marketing_draft / dismiss_marketing_draft.
- approve_marketing_draft defaults to preview-only — it generates the video AND sends a WhatsApp preview but does NOT publish until owner replies "publish <id>". Only pass auto_publish=true after the owner has confirmed THIS specific video.
- If owner asks to change autonomy level, use set_marketing_autonomy. L4 (autonomous publish) requires explicit channels and a daily cap — never enable silently. Always confirm tradeoffs before raising autonomy.

PERFORMANCE FEEDBACK LOOP:
- Use marketing_performance_summary when the owner asks how posts are doing or when picking what to draft next — recent performance informs concept selection.

This is the L2 (draft + approve) flow. Never publish without explicit approval. Always quote the AI generation cost before firing generate_marketing_video.`;
  } else if (cat.category === 'scheduler') {
    templateWorkflow = `\n\nCANONICAL SCHEDULER WORKFLOW (booking pipeline):
When someone wants to book an appointment, service, or class:
  1. find_booking_availability(date_range) → surface open slots from the connected booking system. If multiple booking systems are connected, prefer the one matching the service.
  2. find_calendar_conflicts(start, end) → check the slot against the owner's personal calendar BEFORE confirming. Cross-source conflicts are easy to miss.
  3. Confirm the slot with the requester (or the owner if booking on their behalf). Pending-action safety: NEVER fire schedule_event until the slot is explicitly confirmed in the current conversation.
  4. schedule_event(slot, customer, service) → create the booking on the source-of-truth system.
  5. record_client_visit(client, visit_details) + add_or_update_client_profile if new → so the agent has memory next time.

RESCHEDULES + CANCELS:
- cancel_event before re-booking. Never silently overwrite an existing booking — bookings are hard to undo.
- When cancelling close to the appointment time, surface a notification so the owner sees the gap and can re-fill it.

CONFLICTS:
- If find_calendar_conflicts returns anything, surface it FIRST. Don't paper over conflicts — the owner needs to choose.`;
  } else if (cat.category === 'finance') {
    templateWorkflow = `\n\nCANONICAL FINANCE WORKFLOW (payment-link pipeline):
When the owner wants to bill a client or send a payment link:
  1. Confirm: amount + currency + what it's for + recipient. Money is pending-action safety territory — NEVER call create_payment_link from a vague request.
  2. create_payment_link(amount, currency, description) → Stripe-hosted, shareable URL.
  3. Surface the processor fee in the same response so the owner sees the net. Third-party cost transparency rule.
  4. send_email OR drop the link in chat — depending on whether the owner asked you to email the client or just wants the link.
  5. list_recent_payments later to reconcile when the charge lands. record_client_visit to mark the invoice paid in the visit log.

REFUNDS + DISPUTES:
- Refunds and disputes ALWAYS need owner approval. Surface them; don't act.

OVERDUE INVOICES:
- For unpaid balances, list_recent_payments first to verify nothing came in via another channel. Draft a polite follow-up, surface for owner approval, then send.`;
  } else if (cat.category === 'customer_service' || cat.category === 'operations') {
    templateWorkflow = `\n\nCANONICAL CUSTOMER-SERVICE WORKFLOW (reply pipeline):
When a customer message or social comment needs a response:
  1. Pull context: list_client_history for known clients, knowledge atoms for prior interactions.
  2. Draft a reply in the owner's voice. Use list_pending_followups if it ties to an existing thread.
  3. Pending-action safety: surface the draft, wait for explicit owner approval. NEVER auto-send replies that mention pricing, scheduling commitments, refunds, medical/legal claims, or anything binding.
  4. After approval: reply_to_instagram_comment (for IG) or send_email (for email threads). approve_followup if it was a queued draft.

ESCALATION:
- If the message expresses anger, mentions a complaint, or names a competitor, mark it high-severity and surface immediately — don't bury it in the digest.`;
  }

  // Adaptive cadence guidance — agents change tone based on whether the
  // user is engaged right now or sleeping.
  const cadenceGuide = (() => {
    switch (ctx.cadence.band) {
      case 'active':
        return `USER STATE: actively engaged right now. Be ready — they may text or visit the deck momentarily. Surface anything that needs their immediate attention.`;
      case 'recent':
        return `USER STATE: was active in the last 2 hours. They're around. Surface medium+ priority items.`;
      case 'normal':
        return `USER STATE: idle but awake. Default tone. Only surface items that are genuinely worth their time.`;
      case 'quiet':
        return `USER STATE: hasn't engaged in 6+ hours — likely heads-down on something else or sleeping. Only flag HIGH-priority items. Sit on routine observations.`;
      case 'asleep':
        return `USER STATE: silent for 24+ hours. Treat as off-hours. Only flag genuine emergencies. Otherwise observe and wait.`;
    }
  })();

  // Story 2.4 — inbox of pending delegations targeting this agent's lane
  const inbox = ctx.pendingDelegations.length > 0
    ? `\n\nINCOMING DELEGATIONS (signals from other agents that landed in your inbox — process them this tick):\n` +
      ctx.pendingDelegations.map((d, i) =>
        `  ${i + 1}. ${d.delegation_reason || '(no reason)'} | context: ${(d.output_summary || '').slice(0, 140)}`,
      ).join('\n')
    : '';

  // Lane-routed email drafts — every business mail Iris (or sift) classified
  // into THIS agent's lane shows up here so this agent can draft / approve /
  // act on it. The actual draft was already written by the classifier; this
  // agent reviews it for accuracy + decides to surface it for owner approval.
  const laneInboxBlock = ctx.laneInbox.length > 0
    ? `\n\nYOUR LANE INBOX (${ctx.laneInbox.length} email${ctx.laneInbox.length === 1 ? '' : 's'} routed to you):\n` +
      ctx.laneInbox.slice(0, 8).map((d, i) => {
        const draftLine = d.draftReply ? ` | DRAFT: ${d.draftReply.slice(0, 120)}` : '';
        return `  ${i + 1}. [${d.classification}] From ${d.from} — "${d.subject.slice(0, 80)}"${draftLine}`;
      }).join('\n') +
      `\n\nFor each item: review the draft (if any), refine if needed, and surface it for owner approval if the action requires their sign-off. If a draft is already accurate and the action is within your autonomy, queue it for send. Do NOT silently send mail — every outbound goes through owner approval until autonomy_level says otherwise.`
    : '';

  // Story 2.15 — proven techniques the lane has learned
  const skillsBlock = renderSkillsForPrompt(ctx.appliedSkills);

  // Phase 1A — atoms mined from owner's WhatsApp messages (competitors,
  // goals, preferences, constraints, etc.) so every agent has the owner's
  // perspective without re-reading the chat history.
  const atomsBlock = renderAtomsForPrompt(ctx.knowledgeAtoms);

  // Phase 1C — tenant system state. Orchestrator (Iris) gets the full
  // triage directive ("you are the last gate before owner"); other agents
  // get a lighter "self-suppress known gaps" version.
  const systemStateBlock = renderSystemStateForPrompt(ctx.systemState, {
    forOrchestrator: isOrchestrator,
  });

  // Phase 1B — team capability map (who to consult for what)
  const capabilityMapBlock = renderCapabilityMapForPrompt(ctx.teamCapabilities, config.agent_name);

  // Phase 1B — incoming consult requests this agent should answer
  const consultInboxBlock = ctx.consultInbox.length > 0
    ? [
        '',
        'PEER CONSULTS WAITING FOR YOU TO ANSWER (answer ONE this tick by populating answer_to_consult in your response):',
        ...ctx.consultInbox.slice(0, 3).map((c, i) =>
          `  ${i + 1}. [${c.id.slice(0, 8)}] from ${c.from_agent_name} (${c.trigger_kind}): "${c.question.slice(0, 200)}"${c.reason ? ` — context: ${c.reason.slice(0, 100)}` : ''}`,
        ),
        'Answer concisely (1-3 sentences). If outside your domain, set answer_to_consult.answer = "outside my domain — try X" and we\'ll mark it declined.',
      ].join('\n')
    : '';

  // Phase 1B — answers from peers this agent should incorporate
  const consultOutboxBlock = ctx.consultOutbox.length > 0
    ? [
        '',
        'PEER ANSWERS YOU RECEIVED (incorporate into your observation; don\'t ignore):',
        ...ctx.consultOutbox.slice(0, 3).map((c) =>
          c.status === 'answered'
            ? `  - ${c.to_agent_name} answered "${c.question.slice(0, 100)}": ${c.answer ?? '(no answer)'}`
            : `  - ${c.to_agent_name} timed out on "${c.question.slice(0, 100)}" — proceed without their input`,
        ),
      ].join('\n')
    : '';

  // Entity disambiguation — list of agent teammates (so we don't confuse
  // "Alex the agent" with "Alex the human") + known people in the owner's
  // network (attorney, accountant, clients, etc.)
  const peopleBlock = (() => {
    const blocks: string[] = [];
    if (ctx.teammateNames.length > 0) {
      blocks.push(
        '',
        'YOUR TEAMMATES (these are AGENTS, not humans — never assume the owner is talking about one of these when a name comes up in their email or messages):',
        `  ${ctx.teammateNames.join(', ')}`,
      );
    }
    const peopleText = renderKnownPeopleForPrompt(ctx.knownPeople);
    if (peopleText) blocks.push(peopleText);
    if (blocks.length === 0) return '';
    return blocks.join('\n') + '\n\nWHEN A NAME APPEARS: check the YOUR TEAMMATES list first — if it matches, it\'s a teammate. Otherwise check PEOPLE YOU KNOW. If neither matches, treat it as an unknown human and ask the owner who they are (use define_person to remember after they tell you).';
  })();

  // Au7o / project-connections — the agent's assigned external projects.
  // Substantive baseline so the agent talks about what's actually happening
  // on the project instead of asking for context every tick.
  const projectsBlock = (() => {
    if (!ctx.projects || ctx.projects.length === 0) return '';
    const lines: string[] = ['', 'YOUR ASSIGNED PROJECT(S)'];
    for (const p of ctx.projects) {
      lines.push(`  ▸ ${p.project_name} (${p.provider}, tier ${p.capability_tier})`);
      if (p.deploy_url) lines.push(`    Production: ${p.deploy_url}`);
      if (p.repo_url) lines.push(`    Repo: ${p.repo_url}`);
      if (p.summary) lines.push(`    Status: ${p.summary}`);
      if (p.diff_summary) lines.push(`    Change since last sync: ${p.diff_summary}`);
      if (p.taken_at) lines.push(`    Snapshot taken: ${new Date(p.taken_at).toISOString().slice(0, 16).replace('T', ' ')} UTC`);
    }
    lines.push('');
    lines.push('DISCOVERY MODE');
    lines.push('You have on-demand tools to investigate the project beyond the summary above: get_project_status, list_recent_commits, list_open_issues, read_repo_file, list_repo_tree, fetch_deployed_page. Use them to actually look at the code, the deployed site, the issues. Do not speculate about the project — read it.');
    lines.push('On your first 1-3 ticks after being assigned, prioritize INVESTIGATION: read the README, scan recent commits, hit the deployed site, identify the design system and obvious gaps. After that, transition to monitoring + targeted improvement proposals.');
    return lines.join('\n');
  })();

  // Don't-repeat-yourself guard. If the agent's last 3 ticks all surfaced
  // the same kind of observation (e.g. Alex flagging "no Au7o baseline"
  // every single tick), call it out so it either escalates to a SOLUTION
  // brief or stays silent (no_op).
  const repeatBlock = (() => {
    const recents = ctx.recentRunsForAgent.slice(0, 3);
    if (recents.length < 2) return '';
    // Crude but effective: normalize each summary and check if 2+ overlap
    const norm = (s: string) => (s || '').toLowerCase().replace(/[0-9]+/g, 'N').replace(/\s+/g, ' ').trim().slice(0, 80);
    const sigs = recents.map((r) => norm(r.output_summary ?? ''));
    const counts = new Map<string, number>();
    for (const s of sigs) counts.set(s, (counts.get(s) ?? 0) + 1);
    const repeating = Array.from(counts.entries()).find(([sig, n]) => sig.length > 10 && n >= 2);
    if (!repeating) return '';
    return [
      '',
      'STOP REPEATING YOURSELF',
      `You have raised this exact observation in ${repeating[1]} of your last ${recents.length} ticks: "${recents[0]?.output_summary?.slice(0, 120) ?? ''}".`,
      'The owner has heard it. The DEFAULT response is now option (c) — silence. Do ONE of the following:',
      '  (a) ONLY if you have NEW evidence since last tick AND a specific concrete solution backed by data, you may emit a solution_brief. This is rare — re-read the BMAD SOLUTION BRIEF rules below; if you don\'t cleanly pass ALL six conditions, skip to (b).',
      '  (b) Return a TERSE one-sentence observation that acknowledges no change ("still blocked on Au7o baseline, no new info") with escalation_priority "none" and requires_action=false. Do NOT re-explain the situation.',
      '  (c) DEFAULT — if absolutely nothing new happened, return a near-empty observation ("no change") with escalation_priority "none" and requires_action=false. The owner will appreciate the silence over filler.',
    ].join('\n');
  })();

  return `You are ${config.agent_name}, the ${config.agent_role} for ${ctx.orgName} (${ctx.orgIndustry}).
${categoryHeader ? `Lane: ${categoryHeader}` : ''}

YOUR DOMAIN
${categoryDomain ? `${categoryDomain}\n\n` : ''}${ctx.documentationText.slice(0, 1500)}

YOUR CHANNELS: ${tools || '(none configured)'}
CONNECTED SERVICES: ${connList}

PLATFORM-CONNECTION RULE (critical):
Only propose actions on platforms that appear in CONNECTED SERVICES. If the tenant hasn't connected Instagram, do not propose "post to IG"; if no Stripe, do not propose "send a payment link". The orchestrator will surface offer_missing_connections when the right move is to ask the owner to connect something. Inventing platform-specific actions makes the team look broken.
YOUR RECENT TICKS:
${recentRuns}${inbox}${laneInboxBlock}${skillsBlock}${repeatBlock}${peopleBlock}${atomsBlock}${systemStateBlock}${capabilityMapBlock}${consultInboxBlock}${consultOutboxBlock}${projectsBlock}

${cadenceGuide}

${laneRule}

YOUR AUTONOMY LEVEL: ${autonomy}
${autonomy === 'L1' ? '→ You may PROPOSE actions but NEVER act without owner approval.' : ''}
${autonomy === 'L2' ? '→ You may act and notify the owner after.' : ''}
${autonomy === 'L3' ? '→ You may act autonomously; report weekly.' : ''}
${autonomy === 'L4' ? '→ Fully autonomous; escalate only on errors or novel situations.' : ''}

THIS IS A SCHEDULED TICK. Spend it as if you'd just looked up from your work. Look at YOUR domain only — do NOT speculate about things outside your role. Be honest if there's nothing meaningful to report this tick.

Respond with ONLY a JSON object, no other text:
{
  "observation": "1-2 sentences on what you observed in your domain since your last tick",
  "recommendation": "1-2 sentences on what you'd do or what the owner should know — keep it concrete",
  "requires_action": true|false,
  "escalation_priority": "none" | "low" | "medium" | "high",
  "proposed_action": "if requires_action, the specific next step (1 sentence). Omit otherwise.",
  "delegate_to_lane": "operations" | "sales" | "marketing" | "support" | "finance" | "analytics" | "creative" | "people" | "technical" | "legal" | null,
  "delegation_reason": "if delegate_to_lane is set, one sentence on why this work belongs to that lane. Omit otherwise.",
  "delegations": [{ "lane": "marketing", "reason": "..." }, { "lane": "operations", "reason": "..." }],
  "solution_brief": { "problem": "...", "proposed_solution": "...", "expected_impact": "...", "confidence": 0..1, "risk": "low" | "medium" | "high" } OR null,
  "applied_skill_signature": "snake_case_signature_from_proven_techniques_block_if_you_used_one_or_null",
  "consult": { "peer_name": "Marcus", "question": "specific question for them", "reason": "why you're asking" } OR null,
  "answer_to_consult": { "consult_id": "8-char-prefix", "answer": "1-3 sentence answer to a consult in your inbox" } OR null
}

PRIORITY GUIDE:
- "none" → routine, no signal
- "low" → minor, can wait days
- "medium" → owner should review this week
- "high" → owner needs to know now (use sparingly)

DELEGATION RULES:
- Specialists: use the SINGULAR delegate_to_lane when work clearly belongs elsewhere. Skip the delegations array.
- Orchestrator: use the PLURAL delegations array (1+ entries) when work needs multi-lane input. Use the singular when it's a clean single-lane handoff. Use neither when you can resolve it yourself.
- Either way: do NOT delegate to your own lane.

BMAD SOLUTION BRIEF — HARD RULES (default: solution_brief = null):
Producing a solution_brief is the EXCEPTION, not the rule. A real brief takes the owner ~5 minutes to read; a sloppy one wastes their attention. Hold to this bar.

You may ONLY emit a non-null solution_brief when ALL of these are true:
  1. You have CONCRETE EVIDENCE from your own recent ticks, connections, or assigned project — at least one specific observation you can quote (a commit, an email pattern, a deploy error, a metric). No evidence = no brief.
  2. The pattern is RECURRING (seen at minimum twice in your tick history) or it's a meaningful one-shot that demands a structured proposal (e.g. a deploy is failing repeatedly, a client has gone silent across 3+ threads).
  3. You have a SPECIFIC proposed solution — concrete steps, not a directional suggestion. "Improve X" doesn't count. "Add retry logic to /api/foo with exponential backoff 1s/2s/4s" counts.
  4. expected_impact is MEASURABLE with a number ("+€500/mo", "30% fewer support tickets", "deploy time -2 min"). "Improved efficiency" fails this rule.
  5. confidence >= 0.7. If you're guessing, set it null instead.
  6. You have NOT emitted a brief in your last 3 ticks. Owners shouldn't get back-to-back briefs from the same agent.

If ANY of these fail, return solution_brief: null. The owner is FAR more annoyed by spam briefs than by missing one — defaulting to null is the safer choice.

When starved (no external connections, no project, no delegations in your inbox), solution_brief is BANNED. You don't have enough information to propose anything structured. Stay in observation mode.`;
}

async function callAnthropicForTick(model: string, systemPrompt: string): Promise<{ result: ReasoningResult; tokensIn: number; tokensOut: number; raw: string }> {
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 400,
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: 'Run your scheduled tick.' }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.content?.[0]?.text ?? '';
  const match = text.match(/\{[\s\S]*\}/);
  let parsed: ReasoningResult = { observation: '', recommendation: '', requires_action: false, escalation_priority: 'none' };
  if (match) {
    try { parsed = { ...parsed, ...JSON.parse(match[0]) }; } catch {}
  }
  return {
    result: parsed,
    tokensIn: data.usage?.input_tokens ?? 0,
    tokensOut: data.usage?.output_tokens ?? 0,
    raw: text,
  };
}

async function pushEscalationToOwner(tenantPhone: string, agentName: string, agentRole: string, observation: string, recommendation: string): Promise<void> {
  // Escalations now flow into the notification queue and surface in the
  // next scheduled digest (morning/lunch/afternoon). No more individual
  // texts every time an agent flags something.
  await enqueueNotification({
    tenantPhone,
    kind: 'escalation',
    severity: 'high',
    title: `${agentName} (${agentRole}) flagged: ${observation.slice(0, 100)}`,
    body: `What I'd do: ${recommendation.slice(0, 200)}`,
    sourceAgent: agentName,
    metadata: { observation, recommendation, agent_role: agentRole },
  });
}

/**
 * Tick a single agent. Real reasoning loop:
 *   1. Cost guard — skip if no real work to do
 *   2. Build agent-specific system prompt from config + protocol + context
 *   3. Call the agent's configured primary model (cheap if Haiku-tiered)
 *   4. Parse structured response, apply autonomy gate
 *   5. Log to agent_runs with proper outcome
 *   6. If escalation_priority='high', push to WhatsApp via owner
 */
export async function tickAgent(instance: AgentInstanceRow, config: AgentConfigRow): Promise<void> {
  const start = Date.now();
  const protocol = instance.metadata?.operating_protocol ?? {};
  const autonomy = protocol.autonomyLevel ?? 'L1';
  const primaryModel = config.model_routing?.primary?.model ?? 'claude-haiku-4-5-20251001';

  try {
    const ownLaneForCtx = config.config?.category;
    const ctx = await loadTickContext(instance.tenant_phone, instance.id, ownLaneForCtx, config.id);

    // COST GUARD — only EXTERNAL signal counts. Previously an agent's own
    // past escalations passed this check, creating a self-fueling feedback
    // loop where a single "I see no progress" observation kept that agent
    // reasoning forever even with zero real input (Alex/Au7o was the
    // canonical example: escalated once with no data, then re-escalated
    // every tick thereafter).
    const isOrchestrator = /orchestrat|coordinator|personal/i.test(config.agent_role);
    const hasExternalSignal = ctx.connections.length > 0
      || ctx.pendingDelegations.length > 0
      || ctx.projects.length > 0;
    const hasSignal = hasExternalSignal;
    if (!isOrchestrator && !hasSignal) {
      await logRun({
        tenant_phone: instance.tenant_phone,
        agent_instance_id: instance.id,
        trigger: 'tick',
        phase: 'observe',
        outcome: 'no_op',
        duration_ms: Date.now() - start,
        output_summary: `${config.agent_name} is waiting on a data source — no connected services, no assigned project, no incoming delegations. Will stay quiet until something to work with arrives.`,
        metadata: { autonomy, cost_guard: 'starved' },
      });
      return;
    }

    if (!ANTHROPIC_API_KEY) {
      await logRun({
        tenant_phone: instance.tenant_phone,
        agent_instance_id: instance.id,
        trigger: 'tick',
        outcome: 'failed',
        error: 'ANTHROPIC_API_KEY not set',
      });
      return;
    }

    // Owner-disposition rules render as the operating manual for this
    // tenant. Lane-scoped + 'everywhere' scoped rules. Lane agents
    // re-read these every tick so corrections compound across the team
    // (not just Iris).
    const baseSystemPrompt = buildAgentSystemPrompt(config, autonomy, ctx);
    const { buildDispositionContext } = await import('./disposition-mining');
    const dispositionBlock = await buildDispositionContext(instance.tenant_phone, {
      lane: config.config?.category,
      limit: 10,
    });
    const systemPrompt = baseSystemPrompt + dispositionBlock;
    const { result, tokensIn, tokensOut, raw } = await callAnthropicForTick(primaryModel, systemPrompt);

    // Autonomy gate — at L1 we never claim 'acted', only 'proposed' or 'observed'
    let outcome: 'observed' | 'proposed' | 'acted' | 'escalated' = 'observed';
    if (result.escalation_priority === 'high') outcome = 'escalated';
    else if (result.requires_action) outcome = autonomy === 'L1' ? 'proposed' : 'acted';

    // Story 2.1c — sanitize delegation. Don't accept "delegate to my own
    // lane" — that would be the agent passing the buck to itself.
    const ownLane = config.config?.category;
    const delegateTo = result.delegate_to_lane && result.delegate_to_lane !== ownLane
      ? result.delegate_to_lane
      : null;

    // Server-side guard on solution_brief — agents had been producing them
    // at ~28% of all ticks despite the prompt saying "rare". Enforce the
    // hard rules here so even a verbose model can't flood the field:
    //   - confidence >= 0.7 (else null)
    //   - all four fields populated (problem/proposed_solution/expected_impact + risk)
    //   - banned when agent has no external signal (starvation)
    //   - cooldown: if any of the last 3 runs already had a brief, drop this one
    let sanitizedBrief: any = null;
    const brief = result.solution_brief;
    if (brief && typeof brief === 'object') {
      const recentBriefCount = ctx.recentRunsForAgent.slice(0, 3)
        .filter((r: any) => r?.metadata?.solution_brief != null).length;
      const passes =
        typeof brief.confidence === 'number' && brief.confidence >= 0.7 &&
        typeof brief.problem === 'string' && brief.problem.length > 20 &&
        typeof brief.proposed_solution === 'string' && brief.proposed_solution.length > 20 &&
        typeof brief.expected_impact === 'string' && /[0-9%€$+\-]/.test(brief.expected_impact) &&
        ['low', 'medium', 'high'].includes(brief.risk) &&
        hasExternalSignal &&
        recentBriefCount === 0;
      if (passes) {
        sanitizedBrief = brief;
      } else {
        console.log(`[agent-runtime] dropped solution_brief from ${config.agent_name}: failed guard (recent=${recentBriefCount}, ext=${hasExternalSignal}, conf=${brief.confidence})`);
      }
    }

    // Phase 1B — process consults this tick:
    //   1. If the agent answered a consult in their inbox, write the answer
    //   2. If the agent asked a new consult, write it (with depth check)
    //   3. Mark outbox entries the agent saw as 'folded_in' so they don't re-appear
    try {
      if (result.answer_to_consult?.consult_id && result.answer_to_consult?.answer) {
        const consultIdShort = result.answer_to_consult.consult_id.toLowerCase();
        const match = ctx.consultInbox.find((c) => c.id.startsWith(consultIdShort) || c.id === consultIdShort);
        if (match) {
          const declined = /outside my domain|can'?t help|wrong agent/i.test(result.answer_to_consult.answer);
          await answerConsult({
            consultationId: match.id,
            answer: result.answer_to_consult.answer,
            declined,
          });
        }
      }

      if (result.consult?.peer_name && result.consult?.question) {
        const peer = ctx.teamCapabilities.find(
          (t) => t.agent_name.toLowerCase() === result.consult!.peer_name.toLowerCase(),
        );
        if (peer && peer.agent_instance_id !== instance.id) {
          const ask = await askPeer({
            tenantPhone: instance.tenant_phone,
            fromAgentInstanceId: instance.id,
            fromAgentName: config.agent_name,
            toAgentInstanceId: peer.agent_instance_id,
            toAgentName: peer.agent_name,
            question: result.consult.question,
            reason: result.consult.reason,
            triggerKind: 'pre_escalation',
          });
          if (ask.rejected) {
            console.log(`[consult] ${config.agent_name} → ${peer.agent_name} rejected: ${ask.rejected}`);
          }
        }
      }

      if (ctx.consultOutbox.length > 0) {
        await markConsultsFolded(ctx.consultOutbox.map((c) => c.id));
      }
    } catch (err) {
      console.warn('[consult] processing failed:', err);
    }

    const runId = await logRun({
      tenant_phone: instance.tenant_phone,
      agent_instance_id: instance.id,
      trigger: ctx.pendingDelegations.length > 0 ? 'signal' : 'tick',
      phase: 'observe',
      model_used: primaryModel,
      outcome,
      duration_ms: Date.now() - start,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      input_summary: ctx.pendingDelegations.length > 0
        ? `Tick + ${ctx.pendingDelegations.length} delegation(s) for ${config.agent_name} (${config.agent_role}).`
        : `Scheduled tick for ${config.agent_name} (${config.agent_role}).`,
      output_summary: result.observation || raw.slice(0, 200),
      delegated_to_lane: delegateTo,
      delegation_reason: delegateTo ? (result.delegation_reason ?? null) : null,
      delegation_status: delegateTo ? 'pending' : null,
      metadata: {
        autonomy,
        category: ownLane,
        recommendation: result.recommendation,
        requires_action: result.requires_action,
        escalation_priority: result.escalation_priority,
        proposed_action: result.proposed_action,
        delegations_handled: ctx.pendingDelegations.map((d) => d.id),
        // Story 2.11 — keep BMAD solution briefs as a structured payload.
        // Only stored if the brief passed the hard rules above; otherwise null.
        solution_brief: sanitizedBrief,
        applied_skill_signature: result.applied_skill_signature ?? null,
      },
    }, true);

    // Story 2.4 — mark the inbox-claimed delegations as done so we don't
    // re-process them next tick.
    if (ctx.pendingDelegations.length > 0) {
      await markDelegationsDone(ctx.pendingDelegations.map((d) => d.id));
    }

    // Phase 2 — Iris (orchestrator) processes pending research requests
    // on her tick. Other agents request research; Iris executes. Cap to
    // 2 per tick so a backlog doesn't blow the cost budget.
    if (ownLane === 'orchestrator') {
      try {
        const { loadPendingResearch, processResearchRequest } = await import('./research');
        const pending = await loadPendingResearch(instance.tenant_phone, 2);
        for (const req of pending) {
          const result = await processResearchRequest(req);
          if (result.ok) {
            console.log(`[research] Iris completed "${req.topic.slice(0, 60)}" for ${instance.tenant_phone}`);
          } else {
            console.warn(`[research] Iris failed on "${req.topic.slice(0, 60)}": ${result.error}`);
          }
        }
      } catch (err) {
        console.warn('[research] orchestrator pickup failed:', err);
      }
    }

    // Story 2.15 — skill formation + cross-agent learning.
    //   1. If the agent applied one of the lane's proven techniques, record
    //      success/failure on that skill (success = acted/proposed, failure
    //      = no_op/failed/blocked, neutral = observed).
    //   2. If the run was a substantive success (acted/proposed) AND no
    //      skill was applied, mine it for a NEW technique that peers can
    //      reuse next tick.
    if (ownLane && ownLane !== 'specialist') {
      try {
        const appliedSig = result.applied_skill_signature?.toLowerCase().trim();
        if (appliedSig && ctx.appliedSkills.length > 0) {
          const matched = ctx.appliedSkills.find((s) => s.technique_signature === appliedSig);
          if (matched) {
            const skillOutcome: 'success' | 'failure' | 'neutral' =
              outcome === 'acted' || outcome === 'proposed' || outcome === 'escalated'
                ? 'success'
                : outcome === 'observed' ? 'neutral' : 'failure';
            await recordSkillOutcome({
              skillId: matched.id,
              agentInstanceId: instance.id,
              agentRunId: runId ?? undefined,
              outcome: skillOutcome,
              notes: result.recommendation?.slice(0, 200),
            });
          }
        } else if ((outcome === 'acted' || outcome === 'proposed') && (result.observation?.length ?? 0) > 30) {
          // Mine for a new technique — only on substantive successful runs
          // and only if the agent didn't already cite an existing skill.
          const skill = await extractSkillFromRun({
            agentName: config.agent_name,
            agentRole: config.agent_role,
            lane: ownLane,
            observation: result.observation,
            recommendation: result.recommendation,
            outputSummary: raw.slice(0, 400),
            proposedAction: result.proposed_action,
          });
          if (skill) {
            await upsertSkill({
              tenantPhone: instance.tenant_phone,
              lane: ownLane,
              signature: skill.signature,
              description: skill.description,
              payload: skill.payload,
              discoveredByInstanceId: instance.id,
              discoveredFromRunId: runId ?? undefined,
              metadata: { agent_role: config.agent_role, agent_name: config.agent_name },
            });
          }
        }
      } catch (err) {
        console.warn('[skill-formation] tick hook failed:', err);
      }
    }

    // Story 2.10 — periodic snapshot after a successful tick. Stores the
    // current state_data + protocol + wiring so a recovery has a known
    // good point to restore from.
    await saveSnapshot(instance as any, 'periodic');

    // Orchestrator multi-fan-out: write one extra delegation row per lane.
    // Specialists get this filtered out — only orchestrator's prompt was
    // told about the plural array, but we belt-and-suspenders here too.
    if (ownLane === 'orchestrator' && Array.isArray(result.delegations)) {
      for (const d of result.delegations) {
        if (!d?.lane || d.lane === ownLane) continue;
        await logRun({
          tenant_phone: instance.tenant_phone,
          agent_instance_id: instance.id,
          trigger: 'tick',
          phase: 'plan',
          outcome: 'proposed',
          input_summary: `Multi-lane delegation from ${config.agent_name}.`,
          output_summary: d.reason ?? `Routed work to the ${d.lane} lane.`,
          delegated_to_lane: d.lane,
          delegation_reason: d.reason ?? null,
          delegation_status: 'pending',
          metadata: {
            autonomy,
            category: ownLane,
            spawned_by: 'orchestrator_multi_delegation',
            parent_observation: result.observation?.slice(0, 200),
          },
        });
      }
    }

    // Push high-priority escalations straight to the owner's WhatsApp.
    if (outcome === 'escalated' && result.observation) {
      await pushEscalationToOwner(
        instance.tenant_phone,
        config.agent_name,
        config.agent_role,
        result.observation,
        result.recommendation || '(no recommendation)',
      );
    }
  } catch (err: any) {
    await logRun({
      tenant_phone: instance.tenant_phone,
      agent_instance_id: instance.id,
      trigger: 'tick',
      outcome: 'failed',
      duration_ms: Date.now() - start,
      error: err?.message ?? String(err),
      metadata: { autonomy, model_attempted: primaryModel },
    });
  }
}

// ─── Story 2.1d — Iris team digest ─────────────────────────────────────
// After a tick batch, Iris/orchestrator synthesizes what the team has
// been up to and sends ONE WhatsApp message — but only if there's actually
// signal worth surfacing. Silent when nothing meaningful happened.

/** Min minutes between digests, by activity band. Quiet/asleep rely on the morning briefing. */
const DIGEST_THROTTLE_MIN: Record<TickCadence['band'], number | null> = {
  active: 60,
  recent: 120,
  normal: 240,
  quiet: null,
  asleep: null,
};

async function loadOrchestratorName(tenantPhone: string): Promise<string> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return 'Iris';
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/agent_configs?tenant_phone=eq.${tenantPhone}&select=agent_name,config&order=created_at.asc`,
    { headers: headers() },
  );
  if (!res.ok) return 'Iris';
  const rows = await res.json();
  // Prefer the agent whose category=orchestrator
  const orch = rows.find((r: any) => r.config?.category === 'orchestrator');
  return orch?.agent_name ?? rows[0]?.agent_name ?? 'Iris';
}

interface DigestResult {
  hasSignal: boolean;
  message: string;
}

async function synthesizeDigest(orchestratorName: string, runs: any[]): Promise<DigestResult> {
  if (!ANTHROPIC_API_KEY) return { hasSignal: false, message: '' };
  if (runs.length === 0) return { hasSignal: false, message: '' };

  const lines = runs.slice(0, 30).map((r) =>
    `- ${r.agent_name} (${r.outcome}${r.delegated_to_lane ? ` → ${r.delegated_to_lane}` : ''}): ${(r.output_summary || '').slice(0, 140)}`,
  ).join('\n');

  const system = `You are ${orchestratorName}, the user's personal orchestrator. Your team just finished a round of work. Synthesize what's worth telling the user — keep it tight, no fluff.

Rules:
- If there's nothing meaningful (only routine observations, no escalations or proposals or delegations), respond with EXACTLY: NO_SIGNAL
- Otherwise: write a 1-3 line WhatsApp message in your voice. Lead with the most important thing. Mention agents by name. No emoji unless the situation warrants. No greeting/sign-off.
- Don't list every routine tick. Group + summarize.
- If escalations exist, lead with them.`;

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 220,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: `Recent team runs:\n${lines}` }],
      }),
    });
    if (!res.ok) return { hasSignal: false, message: '' };
    const data = await res.json();
    const text = (data.content?.[0]?.text ?? '').trim();
    if (!text || /^NO_SIGNAL\b/i.test(text)) return { hasSignal: false, message: '' };
    return { hasSignal: true, message: text };
  } catch {
    return { hasSignal: false, message: '' };
  }
}

async function pushDigestToOwner(tenantPhone: string, message: string): Promise<void> {
  const mute = await isMuted(tenantPhone);
  if (mute.muted) {
    console.log(`[digest] suppressed (muted${mute.reason ? `: ${mute.reason}` : ''})`);
    return;
  }
  const { sendOwnerMessage } = await import('./owner-message');
  await sendOwnerMessage({ tenantPhone, body: message, source: 'agent-tick' });
}

/**
 * Maybe send a Iris-led digest of recent team activity to the owner.
 * Throttled per cadence band; silent if nothing meaningful happened.
 */
export async function maybeSendTeamDigest(tenantPhone: string, cadence: TickCadence): Promise<{ sent: boolean; reason?: string }> {
  const throttle = DIGEST_THROTTLE_MIN[cadence.band];
  if (throttle === null) return { sent: false, reason: 'band_disabled' };
  if (!SUPABASE_URL || !SUPABASE_KEY) return { sent: false, reason: 'no_supabase' };

  // Throttle: skip if last digest was too recent
  const profileRes = await fetch(
    `${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${tenantPhone}&select=profile`,
    { headers: headers() },
  );
  const profileRows = profileRes.ok ? await profileRes.json() : [];
  const profile = profileRows[0]?.profile ?? {};
  const lastDigestAt = profile.lastDigestAt ? new Date(profile.lastDigestAt).getTime() : 0;
  const minSinceDigest = (Date.now() - lastDigestAt) / 60_000;
  if (minSinceDigest < throttle) return { sent: false, reason: 'throttled' };

  // Pull meaningful runs since last digest. Skip no_op rows (cost-guard noise).
  const sinceIso = new Date(Math.max(lastDigestAt, Date.now() - throttle * 60_000)).toISOString();
  const runsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/agent_runs?tenant_phone=eq.${tenantPhone}&started_at=gte.${sinceIso}&outcome=neq.no_op&order=started_at.desc&limit=30&select=outcome,output_summary,delegated_to_lane,agent_instance_id,started_at`,
    { headers: headers() },
  );
  const runs = runsRes.ok ? await runsRes.json() : [];
  if (runs.length === 0) return { sent: false, reason: 'no_signal' };

  // Hydrate agent names from instance → config join
  const instIds = Array.from(new Set(runs.map((r: any) => r.agent_instance_id).filter(Boolean))) as string[];
  let nameByInstance = new Map<string, string>();
  if (instIds.length > 0) {
    const instRes = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_instances?id=in.(${instIds.join(',')})&select=id,agent_config_id`,
      { headers: headers() },
    );
    const instRows = instRes.ok ? await instRes.json() : [];
    const cfgIds = Array.from(new Set(instRows.map((i: any) => i.agent_config_id))) as string[];
    if (cfgIds.length > 0) {
      const cfgRes = await fetch(
        `${SUPABASE_URL}/rest/v1/agent_configs?id=in.(${cfgIds.join(',')})&select=id,agent_name`,
        { headers: headers() },
      );
      const cfgRows = cfgRes.ok ? await cfgRes.json() : [];
      const nameByCfg = new Map<string, string>();
      for (const c of cfgRows) nameByCfg.set(c.id as string, c.agent_name as string);
      for (const i of instRows) nameByInstance.set(i.id as string, nameByCfg.get(i.agent_config_id) ?? '?');
    }
  }
  const enriched = runs.map((r: any) => ({ ...r, agent_name: nameByInstance.get(r.agent_instance_id) ?? '?' }));

  // Tick-driven digests no longer push directly. Each meaningful run with
  // a non-routine outcome becomes a queued notification, drained later by
  // the scheduled digest crons (morning/lunch/afternoon).
  let queued = 0;
  for (const r of enriched) {
    if (r.outcome === 'observed' || r.outcome === 'no_op') continue;
    const sev = r.outcome === 'escalated' ? 'high'
      : r.outcome === 'failed' ? 'high'
      : r.outcome === 'acted' ? 'low'
      : 'medium';
    const verb = r.outcome === 'escalated' ? 'flagged'
      : r.outcome === 'failed' ? 'failed'
      : r.outcome === 'acted' ? 'did'
      : 'proposed';
    await enqueueNotification({
      tenantPhone,
      kind: 'agent_observation',
      severity: sev,
      title: `${r.agent_name} ${verb}: ${(r.output_summary ?? '').slice(0, 100)}`,
      body: r.delegated_to_lane ? `→ delegated to ${r.delegated_to_lane}` : undefined,
      sourceAgent: r.agent_name,
      sourceId: r.agent_instance_id,
      metadata: { outcome: r.outcome, started_at: r.started_at },
    });
    queued++;
  }

  // Mark lastDigestAt to keep the throttle behavior (skip if already evaluated recently)
  profile.lastDigestAt = new Date().toISOString();
  await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${tenantPhone}`, {
    method: 'PATCH',
    headers: { ...headers(), Prefer: 'return=minimal' },
    body: JSON.stringify({ profile }),
  });

  console.log(`[digest] Queued ${queued} items for ${tenantPhone} (band=${cadence.band}, drained at next scheduled digest)`);
  return { sent: queued > 0, reason: queued === 0 ? 'no_actionable_runs' : undefined };
}

/** Cron entry point — tick every running agent across every tenant */
export async function tickRunningAgents(): Promise<{ tenants: number; ticked: number; failed: number; skipped: number }> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { tenants: 0, ticked: 0, failed: 0, skipped: 0 };

  const instRes = await fetch(
    `${SUPABASE_URL}/rest/v1/agent_instances?status=eq.running&select=id,tenant_phone,agent_config_id,status,metadata`,
    { headers: headers() },
  );
  if (!instRes.ok) return { tenants: 0, ticked: 0, failed: 0, skipped: 0 };
  const instances = await instRes.json() as AgentInstanceRow[];
  if (instances.length === 0) return { tenants: 0, ticked: 0, failed: 0, skipped: 0 };

  const cfgIds = Array.from(new Set(instances.map((i) => i.agent_config_id)));
  const cfgRes = await fetch(
    `${SUPABASE_URL}/rest/v1/agent_configs?id=in.(${cfgIds.join(',')})&select=id,agent_name,agent_role,model_routing,output_channels,config`,
    { headers: headers() },
  );
  if (!cfgRes.ok) return { tenants: 0, ticked: 0, failed: 0, skipped: 0 };
  const cfgs = await cfgRes.json() as AgentConfigRow[];
  const cfgById = new Map(cfgs.map((c) => [c.id, c] as const));

  // Adaptive cadence: cron fires every 5 min, but each tenant has their own
  // target cadence based on recent user activity. Skip a tenant entirely if
  // not enough time has passed since their last tick.
  const tenants = Array.from(new Set(instances.map((i) => i.tenant_phone)));
  const dueTenants = new Set<string>();
  for (const t of tenants) {
    const { should, cadence, minSinceLastTick } = await shouldTickTenant(t);
    if (should) {
      dueTenants.add(t);
      // Record now so concurrent ticks don't double-fire
      await recordTickAt(t, cadence);
      console.log(`[agent-tick] ${t} due (${cadence.band}, ${cadence.minutes}min cadence, ${minSinceLastTick === Infinity ? 'first' : Math.round(minSinceLastTick) + 'm'} since last)`);
    } else {
      console.log(`[agent-tick] ${t} skipped (${cadence.band}, ${cadence.minutes}min cadence, ${Math.round(minSinceLastTick)}m since last)`);
    }
  }

  let ticked = 0;
  let failed = 0;
  let skipped = 0;
  // Track which tenants got at least one tick so we know who to digest
  const tickedTenants = new Set<string>();
  for (const inst of instances) {
    if (!dueTenants.has(inst.tenant_phone)) {
      skipped++;
      continue;
    }
    const cfg = cfgById.get(inst.agent_config_id);
    if (!cfg) {
      failed++;
      continue;
    }
    try {
      await tickAgent(inst, cfg);
      ticked++;
      tickedTenants.add(inst.tenant_phone);
    } catch {
      failed++;
    }
  }

  // After the tick batch: maybe send Iris's team digest. Throttled per
  // band; silent if nothing meaningful happened.
  let digestsSent = 0;
  for (const t of tickedTenants) {
    const cadence = await computeCadence(t);
    const result = await maybeSendTeamDigest(t, cadence);
    if (result.sent) digestsSent++;
  }

  return { tenants: tenants.length, ticked, failed, skipped, digestsSent } as any;
}

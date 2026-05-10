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
export async function stopTenantAgents(tenantPhone: string): Promise<{ stopped: number }> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { stopped: 0 };
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/agent_instances?tenant_phone=eq.${cleanPhone}&status=eq.running&select=id`,
    { headers: headers() },
  );
  if (!res.ok) return { stopped: 0 };
  const rows = await res.json() as { id: string }[];
  for (const row of rows) {
    await setInstanceStatus(row.id, 'paused');
  }
  return { stopped: rows.length };
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
}

// Story 2.10 — periodic snapshots after each successful tick.
import { saveSnapshot } from './state-recovery';
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

async function loadTickContext(tenantPhone: string, instanceId: string, ownLane?: string): Promise<TickContext> {
  const cadence = await computeCadence(tenantPhone);
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return { orgName: '', orgIndustry: '', documentationText: '', connections: [], recentRunsForAgent: [], cadence, pendingDelegations: [], appliedSkills: [] };
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

  return {
    orgName: ctxRows[0]?.business_name ?? '',
    orgIndustry: ctxRows[0]?.business_type ?? '',
    documentationText: docRows[0]?.metadata?.text ?? '',
    connections: connRows ?? [],
    recentRunsForAgent: runRows ?? [],
    cadence,
    pendingDelegations,
    appliedSkills,
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

  // Story 2.15 — proven techniques the lane has learned
  const skillsBlock = renderSkillsForPrompt(ctx.appliedSkills);

  return `You are ${config.agent_name}, the ${config.agent_role} for ${ctx.orgName} (${ctx.orgIndustry}).
${categoryHeader ? `Lane: ${categoryHeader}` : ''}

YOUR DOMAIN
${categoryDomain ? `${categoryDomain}\n\n` : ''}${ctx.documentationText.slice(0, 1500)}

YOUR CHANNELS: ${tools || '(none configured)'}
CONNECTED SERVICES: ${connList}
YOUR RECENT TICKS:
${recentRuns}${inbox}${skillsBlock}

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
  "applied_skill_signature": "snake_case_signature_from_proven_techniques_block_if_you_used_one_or_null"
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

BMAD SOLUTION BRIEF (rare — only when justified):
If you spot a RECURRING pattern, anomaly, or systemic improvement opportunity in your domain (NOT a one-off issue), populate solution_brief with: the problem, your proposed solution, expected impact (concrete metric), your confidence 0-1, and risk level. Otherwise leave solution_brief null. Don't generate one every tick — only when you see something actually worth surfacing as a structured proposal for the owner.`;
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
  if (!WHATSAPP_PHONE_ID || !WHATSAPP_TOKEN) return;
  const message = [
    `⚡ ${agentName} (${agentRole}) flagged something:`,
    ``,
    `What I noticed: ${observation}`,
    `What I'd do: ${recommendation}`,
    ``,
    `Reply "approve" to proceed, "skip" to dismiss, or chat to ask why.`,
  ].join('\n');
  try {
    await fetch(`${GRAPH_API}/${WHATSAPP_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: tenantPhone,
        type: 'text',
        text: { body: message },
      }),
    });
  } catch (err) {
    console.warn('[agent-runtime] escalation push failed:', err);
  }
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
    const ctx = await loadTickContext(instance.tenant_phone, instance.id, ownLaneForCtx);

    // COST GUARD — if the agent has no connected services to observe AND
    // no recent activity AND no pending delegations, log a no_op instead
    // of burning tokens. Pending delegations always justify a tick. The
    // orchestrator (Iris) is exempt because she always has signal from
    // the conversation history.
    const isOrchestrator = /orchestrat|coordinator|personal/i.test(config.agent_role);
    const hasSignal = ctx.connections.length > 0
      || ctx.recentRunsForAgent.some((r) => r.outcome !== 'no_op')
      || ctx.pendingDelegations.length > 0;
    if (!isOrchestrator && !hasSignal) {
      await logRun({
        tenant_phone: instance.tenant_phone,
        agent_instance_id: instance.id,
        trigger: 'tick',
        phase: 'observe',
        outcome: 'no_op',
        duration_ms: Date.now() - start,
        output_summary: `Skipped reasoning — no connected services or recent activity in ${config.agent_name}'s domain yet.`,
        metadata: { autonomy, cost_guard: 'no_signal' },
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

    const systemPrompt = buildAgentSystemPrompt(config, autonomy, ctx);
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
        // Story 2.11 — keep BMAD solution briefs as a structured payload
        solution_brief: result.solution_brief ?? null,
        applied_skill_signature: result.applied_skill_signature ?? null,
      },
    }, true);

    // Story 2.4 — mark the inbox-claimed delegations as done so we don't
    // re-process them next tick.
    if (ctx.pendingDelegations.length > 0) {
      await markDelegationsDone(ctx.pendingDelegations.map((d) => d.id));
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

// ─── Story 2.1d — Sophia team digest ─────────────────────────────────────
// After a tick batch, Sophia/orchestrator synthesizes what the team has
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
  if (!SUPABASE_URL || !SUPABASE_KEY) return 'Sophia';
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/agent_configs?tenant_phone=eq.${tenantPhone}&select=agent_name,config&order=created_at.asc`,
    { headers: headers() },
  );
  if (!res.ok) return 'Sophia';
  const rows = await res.json();
  // Prefer the agent whose category=orchestrator
  const orch = rows.find((r: any) => r.config?.category === 'orchestrator');
  return orch?.agent_name ?? rows[0]?.agent_name ?? 'Sophia';
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
        model: 'claude-sonnet-4-20250514',
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
  if (!WHATSAPP_PHONE_ID || !WHATSAPP_TOKEN) return;
  try {
    await fetch(`${GRAPH_API}/${WHATSAPP_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: tenantPhone,
        type: 'text',
        text: { body: message },
      }),
    });
  } catch (err) {
    console.warn('[digest] push failed:', err);
  }
}

/**
 * Maybe send a Sophia-led digest of recent team activity to the owner.
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

  const orchestratorName = await loadOrchestratorName(tenantPhone);
  const digest = await synthesizeDigest(orchestratorName, enriched);
  if (!digest.hasSignal) return { sent: false, reason: 'no_signal_per_orchestrator' };

  await pushDigestToOwner(tenantPhone, digest.message);

  // Mark lastDigestAt
  profile.lastDigestAt = new Date().toISOString();
  await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${tenantPhone}`, {
    method: 'PATCH',
    headers: { ...headers(), Prefer: 'return=minimal' },
    body: JSON.stringify({ profile }),
  });

  console.log(`[digest] Sent for ${tenantPhone} (band=${cadence.band}, ${runs.length} runs)`);
  return { sent: true };
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

  // After the tick batch: maybe send Sophia's team digest. Throttled per
  // band; silent if nothing meaningful happened.
  let digestsSent = 0;
  for (const t of tickedTenants) {
    const cadence = await computeCadence(t);
    const result = await maybeSendTeamDigest(t, cadence);
    if (result.sent) digestsSent++;
  }

  return { tenants: tenants.length, ticked, failed, skipped, digestsSent } as any;
}

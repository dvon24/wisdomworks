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
}) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  await fetch(`${SUPABASE_URL}/rest/v1/agent_runs`, {
    method: 'POST',
    headers: { ...headers(), Prefer: 'return=minimal' },
    body: JSON.stringify(row),
  });
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
}

async function loadTickContext(tenantPhone: string, instanceId: string): Promise<TickContext> {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return { orgName: '', orgIndustry: '', documentationText: '', connections: [], recentRunsForAgent: [] };
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

  return {
    orgName: ctxRows[0]?.business_name ?? '',
    orgIndustry: ctxRows[0]?.business_type ?? '',
    documentationText: docRows[0]?.metadata?.text ?? '',
    connections: connRows ?? [],
    recentRunsForAgent: runRows ?? [],
  };
}

interface ReasoningResult {
  observation: string;
  recommendation: string;
  requires_action: boolean;
  escalation_priority: 'none' | 'low' | 'medium' | 'high';
  proposed_action?: string;
}

function buildAgentSystemPrompt(config: AgentConfigRow, autonomy: string, ctx: TickContext): string {
  const tools = (config.output_channels ?? []).join(', ');
  const connList = ctx.connections.map((c) => `${c.provider}/${c.service}`).join(', ') || 'none';
  const recentRuns = ctx.recentRunsForAgent.length
    ? ctx.recentRunsForAgent.map((r) => `  - [${r.outcome}] ${r.output_summary?.slice(0, 100) ?? ''}`).join('\n')
    : '  (none)';

  return `You are ${config.agent_name}, the ${config.agent_role} for ${ctx.orgName} (${ctx.orgIndustry}).

YOUR DOMAIN
${ctx.documentationText.slice(0, 1500)}

YOUR CHANNELS: ${tools || '(none configured)'}
CONNECTED SERVICES: ${connList}
YOUR RECENT TICKS:
${recentRuns}

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
  "proposed_action": "if requires_action, the specific next step (1 sentence). Omit otherwise."
}

PRIORITY GUIDE:
- "none" → routine, no signal
- "low" → minor, can wait days
- "medium" → owner should review this week
- "high" → owner needs to know now (use sparingly)`;
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
    const ctx = await loadTickContext(instance.tenant_phone, instance.id);

    // COST GUARD — if the agent has no connected services to observe AND
    // no recent activity, log a no_op instead of burning tokens. The
    // orchestrator (Iris) is exempt because she always has signal from
    // the conversation history.
    const isOrchestrator = /orchestrat|coordinator|personal/i.test(config.agent_role);
    const hasSignal = ctx.connections.length > 0 || ctx.recentRunsForAgent.some((r) => r.outcome !== 'no_op');
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

    await logRun({
      tenant_phone: instance.tenant_phone,
      agent_instance_id: instance.id,
      trigger: 'tick',
      phase: 'observe',
      model_used: primaryModel,
      outcome,
      duration_ms: Date.now() - start,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      input_summary: `Scheduled tick for ${config.agent_name} (${config.agent_role}).`,
      output_summary: result.observation || raw.slice(0, 200),
      metadata: {
        autonomy,
        recommendation: result.recommendation,
        requires_action: result.requires_action,
        escalation_priority: result.escalation_priority,
        proposed_action: result.proposed_action,
      },
    });

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

/** Cron entry point — tick every running agent across every tenant */
export async function tickRunningAgents(): Promise<{ tenants: number; ticked: number; failed: number }> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { tenants: 0, ticked: 0, failed: 0 };

  // Fetch all running instances + their configs in two queries
  const instRes = await fetch(
    `${SUPABASE_URL}/rest/v1/agent_instances?status=eq.running&select=id,tenant_phone,agent_config_id,status,metadata`,
    { headers: headers() },
  );
  if (!instRes.ok) return { tenants: 0, ticked: 0, failed: 0 };
  const instances = await instRes.json() as AgentInstanceRow[];
  if (instances.length === 0) return { tenants: 0, ticked: 0, failed: 0 };

  const cfgIds = Array.from(new Set(instances.map((i) => i.agent_config_id)));
  const cfgRes = await fetch(
    `${SUPABASE_URL}/rest/v1/agent_configs?id=in.(${cfgIds.join(',')})&select=id,agent_name,agent_role,model_routing,output_channels`,
    { headers: headers() },
  );
  if (!cfgRes.ok) return { tenants: 0, ticked: 0, failed: 0 };
  const cfgs = await cfgRes.json() as AgentConfigRow[];
  const cfgById = new Map(cfgs.map((c) => [c.id, c] as const));

  const tenants = new Set(instances.map((i) => i.tenant_phone));
  let ticked = 0;
  let failed = 0;
  for (const inst of instances) {
    const cfg = cfgById.get(inst.agent_config_id);
    if (!cfg) {
      failed++;
      continue;
    }
    try {
      await tickAgent(inst, cfg);
      ticked++;
    } catch {
      failed++;
    }
  }
  return { tenants: tenants.size, ticked, failed };
}

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

/**
 * Tick a single agent. Foundation behaviour:
 *   1. Read its config + protocol
 *   2. Run its primary loop placeholder (currently a no-op observation)
 *   3. Log the run to agent_runs
 *
 * Real BMAD reasoning + tool calls + escalation lands in 2.1b once the
 * signal layer is online and agents can talk to each other.
 */
export async function tickAgent(instance: AgentInstanceRow, config: AgentConfigRow): Promise<void> {
  const start = Date.now();
  try {
    const protocol = instance.metadata?.operating_protocol ?? {};
    const autonomy = protocol.autonomyLevel ?? 'L1';
    const primaryModel = config.model_routing?.primary?.model ?? 'unknown';

    // PLACEHOLDER primary loop — just an observation log for now.
    // 2.1b will dispatch to a LangGraph state machine here, gate actions
    // behind autonomy level (L1 → propose-only, L2+ → act-and-notify).
    const wouldAct = autonomy !== 'L1';

    await logRun({
      tenant_phone: instance.tenant_phone,
      agent_instance_id: instance.id,
      trigger: 'tick',
      phase: 'observe',
      model_used: primaryModel,
      outcome: 'observed',
      duration_ms: Date.now() - start,
      input_summary: `Scheduled tick for ${config.agent_name} (${config.agent_role}).`,
      output_summary: wouldAct
        ? `Tick complete. Autonomy ${autonomy} would allow autonomous action.`
        : `Tick complete. Autonomy L1 — any action would require user approval.`,
      metadata: { autonomy, channels: config.output_channels },
    });
  } catch (err: any) {
    await logRun({
      tenant_phone: instance.tenant_phone,
      agent_instance_id: instance.id,
      trigger: 'tick',
      outcome: 'failed',
      duration_ms: Date.now() - start,
      error: err?.message ?? String(err),
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

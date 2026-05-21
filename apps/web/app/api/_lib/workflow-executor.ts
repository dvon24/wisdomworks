/**
 * Workflow executor — runs a user-defined workflow's steps[] array.
 *
 * Sequential MVP per project_workflow_engine_mvp_scope.md:
 *   • Walk steps in order
 *   • Resolve each step's tool from the tenant's available catalog
 *   • Invoke via the existing executeTool() so workflow tool calls share
 *     all of Iris's plumbing (destructive snapshots, lessons-learned
 *     pre-flight, cost tracking, audit logging)
 *   • Template-substitute {previous} / {previous.field} in args
 *   • Stop on first failure, return per-step outcomes
 *
 * Deliberately NOT supported in MVP: parallel steps, conditional
 * branching, retries beyond what the underlying tool does, state across
 * runs ("wait 3 days and check"). Add those after the first paying
 * customer requests them.
 */

import { executeTool, type ToolCall, type ToolResult } from '../webhooks/whatsapp/agent-tools';
import { loadUserContext } from '../webhooks/whatsapp/context-store';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

export interface WorkflowStep {
  /** Optional agent name — for attribution only; doesn't gate tool access.
   *  All tools are tenant-scoped and available to any step.  */
  agent?: string;
  /** The Iris tool name to invoke (must exist in the tool catalog). */
  tool: string;
  /** Tool arguments. Strings may contain template references like
   *  {previous} or {previous.field}; resolved before tool invocation. */
  args?: Record<string, any>;
}

export interface StepOutcome {
  step_index: number;
  agent?: string;
  tool: string;
  success: boolean;
  /** Truncated to 500 chars for storage; full output stays in agent_runs. */
  output_preview: string;
  error?: string;
}

export interface WorkflowExecutionResult {
  ok: boolean;
  workflow_id: string;
  tenant_phone: string;
  outcome: 'success' | 'partial' | 'failed';
  steps_completed: number;
  steps_total: number;
  step_outcomes: StepOutcome[];
  duration_ms: number;
  error?: string;
}

/**
 * Recursively walk args and replace template references.
 * Supports:
 *   "{previous}"          → entire prior step's output string
 *   "{previous.field}"    → JSON-parsed prior output's named field, or
 *                          empty string if not parseable / field missing
 *   "literal {previous} more" → string substitution within larger strings
 */
function substituteTemplates(args: any, priorOutput: string | null): any {
  if (args === null || args === undefined) return args;
  if (typeof args === 'string') {
    if (priorOutput === null) return args.replace(/\{previous(\.[^}]+)?\}/g, '');
    // Try JSON-parsing prior output once; fall back to string substitution.
    let priorJson: any = null;
    try {
      priorJson = JSON.parse(priorOutput);
    } catch {
      priorJson = null;
    }
    return args.replace(/\{previous(\.[^}]+)?\}/g, (_match, fieldPath) => {
      if (!fieldPath) return priorOutput;
      const path = fieldPath.slice(1).split('.');
      let cursor = priorJson;
      for (const p of path) {
        if (cursor == null) return '';
        cursor = cursor[p];
      }
      return cursor == null ? '' : typeof cursor === 'string' ? cursor : JSON.stringify(cursor);
    });
  }
  if (Array.isArray(args)) {
    return args.map(a => substituteTemplates(a, priorOutput));
  }
  if (typeof args === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(args)) {
      out[k] = substituteTemplates(v, priorOutput);
    }
    return out;
  }
  return args;
}

async function loadOAuthConnections(cleanPhone: string): Promise<any[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/oauth_connections?phone_number=eq.${cleanPhone}&status=eq.active&select=*`,
      { headers: headers() },
    );
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

/**
 * Run a single workflow. Loads tenant context, walks steps, returns
 * structured outcomes. Doesn't update user_workflows itself — caller
 * (dispatcher cron) owns the run-bookkeeping (last_run_at, next_run_at).
 */
export async function executeWorkflow(args: {
  workflowId: string;
  tenantPhone: string;
  steps: WorkflowStep[];
  workflowName?: string;
}): Promise<WorkflowExecutionResult> {
  const start = Date.now();
  const cleanPhone = args.tenantPhone.replace(/[\s\-+()]/g, '');
  const stepOutcomes: StepOutcome[] = [];

  if (!Array.isArray(args.steps) || args.steps.length === 0) {
    return {
      ok: false,
      workflow_id: args.workflowId,
      tenant_phone: cleanPhone,
      outcome: 'failed',
      steps_completed: 0,
      steps_total: 0,
      step_outcomes: [],
      duration_ms: Date.now() - start,
      error: 'Workflow has no steps to execute.',
    };
  }

  // Load tenant context + connections once for the whole run.
  // loadUserContext takes (phoneNumber, name) — the name is only used on
  // first-message bootstrap to seed an empty context. For workflow runs
  // the context always exists (owner can't create a workflow without
  // having gone through onboarding), so any name string works.
  const user = await loadUserContext(cleanPhone, 'workflow-runner');
  if (!user) {
    return {
      ok: false,
      workflow_id: args.workflowId,
      tenant_phone: cleanPhone,
      outcome: 'failed',
      steps_completed: 0,
      steps_total: args.steps.length,
      step_outcomes: [],
      duration_ms: Date.now() - start,
      error: 'No tenant context found — workflow tenant may have been deleted.',
    };
  }

  const connections = await loadOAuthConnections(cleanPhone);

  let priorOutput: string | null = null;
  let stepsCompleted = 0;

  for (let i = 0; i < args.steps.length; i++) {
    const step = args.steps[i]!;
    if (!step.tool) {
      stepOutcomes.push({
        step_index: i,
        agent: step.agent,
        tool: '(missing)',
        success: false,
        output_preview: '',
        error: 'Step has no tool name.',
      });
      break;
    }

    const resolvedArgs = substituteTemplates(step.args ?? {}, priorOutput);
    const call: ToolCall = { name: step.tool, input: resolvedArgs };

    let result: ToolResult;
    try {
      result = await executeTool(call, connections, user);
    } catch (err: any) {
      stepOutcomes.push({
        step_index: i,
        agent: step.agent,
        tool: step.tool,
        success: false,
        output_preview: '',
        error: err?.message ?? String(err),
      });
      break;
    }

    stepOutcomes.push({
      step_index: i,
      agent: step.agent,
      tool: step.tool,
      success: result.success,
      output_preview: (result.content ?? '').slice(0, 500),
      error: result.success ? undefined : (result.content ?? '').slice(0, 500),
    });

    if (!result.success) break;
    stepsCompleted++;
    priorOutput = result.content;
  }

  const outcome: WorkflowExecutionResult['outcome'] =
    stepsCompleted === args.steps.length ? 'success'
    : stepsCompleted === 0 ? 'failed'
    : 'partial';

  return {
    ok: outcome === 'success',
    workflow_id: args.workflowId,
    tenant_phone: cleanPhone,
    outcome,
    steps_completed: stepsCompleted,
    steps_total: args.steps.length,
    step_outcomes: stepOutcomes,
    duration_ms: Date.now() - start,
  };
}

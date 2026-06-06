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
  /** Truncated to 500 chars for STORAGE/observability only — NEVER deliver this
   *  to the owner (2026-06-06: the 500-char preview shipped a worker's truncated
   *  reasoning scratchpad as the "workout"). */
  output_preview: string;
  /** Full untruncated tool output — THE deliverable. The dispatcher delivers
   *  full_content, not output_preview. Set on successful steps only. */
  full_content?: string;
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
 *   "{previous}"          → entire prior step's content string
 *   "{previous.field}"    → field from prior step's structured `data`
 *                          (preferred), with JSON-parse-of-content fallback
 *   "literal {previous} more" → string substitution within larger strings
 *
 * Resolution priority for "{previous.field}":
 *   1. priorData[field]                       — preferred, fed by tool's
 *                                               explicit ToolResult.data
 *   2. JSON.parse(priorContent)[field]        — legacy fallback for tools
 *                                               that returned JSON in content
 *   3. ''                                      — empty string (logged)
 *
 * The data path was added 2026-05-22 after the first real workflow test
 * (Marcus → Mira → email PDF) failed because create_document's content
 * was human-readable prose, not JSON, so {previous.storage_url} resolved
 * to empty string and the email had no attachment.
 */
function substituteTemplates(
  args: any,
  priorContent: string | null,
  priorData: Record<string, any> | undefined,
): any {
  if (args === null || args === undefined) return args;
  if (typeof args === 'string') {
    if (priorContent === null && !priorData) {
      return args.replace(/\{previous(\.[^}]+)?\}/g, '');
    }
    // Resolve field lookup against data first, JSON-parsed content second.
    let priorJson: any = null;
    if (priorContent) {
      try {
        priorJson = JSON.parse(priorContent);
      } catch {
        priorJson = null;
      }
    }
    return args.replace(/\{previous(\.[^}]+)?\}/g, (_match, fieldPath) => {
      if (!fieldPath) return priorContent ?? '';
      const path = fieldPath.slice(1).split('.');
      // Try data first.
      let cursor: any = priorData;
      for (const p of path) {
        if (cursor == null) { cursor = undefined; break; }
        cursor = cursor[p];
      }
      if (cursor != null) {
        return typeof cursor === 'string' ? cursor : JSON.stringify(cursor);
      }
      // Fall back to JSON-parsed content.
      cursor = priorJson;
      for (const p of path) {
        if (cursor == null) return '';
        cursor = cursor[p];
      }
      return cursor == null ? '' : typeof cursor === 'string' ? cursor : JSON.stringify(cursor);
    });
  }
  if (Array.isArray(args)) {
    return args.map(a => substituteTemplates(a, priorContent, priorData));
  }
  if (typeof args === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(args)) {
      out[k] = substituteTemplates(v, priorContent, priorData);
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

  let priorContent: string | null = null;
  let priorData: Record<string, any> | undefined = undefined;
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

    const resolvedArgs = substituteTemplates(step.args ?? {}, priorContent, priorData);
    // Scheduled output is delivered to the owner VERBATIM — make delegated
    // workers lead with the finished artifact, never their reasoning scratchpad
    // (2026-06-06: a Coach workflow shipped "I have enough. Key facts
    // confirmed…" instead of the workout).
    if (step.tool === 'delegate_to_agent' && resolvedArgs && typeof (resolvedArgs as any).task === 'string') {
      (resolvedArgs as any).task += '\n\nIMPORTANT: Your response is delivered to the owner verbatim. Begin with the finished result itself (e.g. the workout). Do NOT include reasoning, planning notes, or phrases like "I have enough" or "Key facts confirmed".';
    }
    const call: ToolCall = { name: step.tool, input: resolvedArgs };

    let result: ToolResult;
    try {
      result = await executeTool(call, connections, user);
    } catch (err: any) {
      // 2026-05-27 — enrich common errors with which arg likely caused
      // them so the owner can debug from the auto-pause notification.
      // The most common silent failure is a tool calling
      // `new Date(input).toISOString()` on an empty string that came
      // from an unresolved {previous.field} — surface that pattern
      // clearly instead of just "Invalid time value".
      const rawErr = err?.message ?? String(err);
      let enriched = rawErr;
      if (/invalid time value/i.test(rawErr)) {
        const dateLikeKeys = Object.entries(resolvedArgs ?? {})
          .filter(([k, v]) => /(_at|_date|date|time|from|to|start|end)$/i.test(k) && (v === '' || v == null))
          .map(([k]) => k);
        if (dateLikeKeys.length > 0) {
          enriched = `Invalid date — args ${JSON.stringify(dateLikeKeys)} resolved to empty (likely an unresolved {previous.${dateLikeKeys[0]}} from prior step). Fix the workflow step to either supply a default or check the prior step's actual output fields.`;
        } else {
          enriched = `Invalid date in tool ${step.tool} — check this step's args.`;
        }
      }
      stepOutcomes.push({
        step_index: i,
        agent: step.agent,
        tool: step.tool,
        success: false,
        output_preview: '',
        error: enriched,
      });
      break;
    }

    stepOutcomes.push({
      step_index: i,
      agent: step.agent,
      tool: step.tool,
      success: result.success,
      output_preview: (result.content ?? '').slice(0, 500),
      full_content: result.success ? (result.content ?? '') : undefined,
      error: result.success ? undefined : (result.content ?? '').slice(0, 500),
    });

    if (!result.success) break;
    stepsCompleted++;
    priorContent = result.content;
    priorData = result.data;
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

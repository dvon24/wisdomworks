/**
 * Story 2.12 — Workflow Execution.
 *
 * A workflow is a sequence of typed steps with conditionals + retries.
 * Each step references one of the existing agent tools or a built-in
 * primitive. Workflow runs land in agent_runs (trigger='manual',
 * phase='build') so they show up in the activity feed alongside ticks.
 *
 * Step types:
 *   - tool: invoke an agent tool by name with input args
 *   - if:   conditional branch on the previous step's output
 *   - parallel: run children in parallel
 *   - delay: pause N seconds (rare; sleep limits in Vercel functions)
 *
 * Variables: each step's output is stored under its `id`. Subsequent
 * steps can reference {{stepId.field}} in their args.
 */

import { executeTool, type ToolCall, type ToolResult, type AnthropicTool } from '../webhooks/whatsapp/agent-tools';
import { loadConnectionsForPhone, type OAuthConnection } from '@wisdomworks/shared';
import { loadUserContext, type UserContext } from '../webhooks/whatsapp/context-store';

export type WorkflowStep =
  | { id: string; type: 'tool'; tool: string; input: any; retries?: number }
  | { id: string; type: 'if'; condition: { fromStep: string; field?: string; equals?: any; truthy?: boolean }; then: WorkflowStep[]; else?: WorkflowStep[] }
  | { id: string; type: 'parallel'; steps: WorkflowStep[] }
  | { id: string; type: 'delay'; ms: number };

export interface WorkflowDefinition {
  name: string;
  description?: string;
  steps: WorkflowStep[];
}

export interface StepResult {
  id: string;
  type: string;
  success: boolean;
  output?: any;
  error?: string;
  durationMs: number;
}

export interface WorkflowResult {
  ok: boolean;
  totalDurationMs: number;
  steps: StepResult[];
}

function resolveTemplate(value: any, context: Record<string, any>): any {
  if (typeof value === 'string') {
    return value.replace(/\{\{([^}]+)\}\}/g, (_, expr) => {
      const path = expr.trim().split('.');
      let cur: any = context;
      for (const p of path) {
        if (cur == null) return '';
        cur = cur[p];
      }
      return cur == null ? '' : String(cur);
    });
  }
  if (Array.isArray(value)) return value.map((v) => resolveTemplate(v, context));
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveTemplate(v, context);
    return out;
  }
  return value;
}

function evalCondition(
  condition: { fromStep: string; field?: string; equals?: any; truthy?: boolean },
  context: Record<string, any>,
): boolean {
  const stepOut = context[condition.fromStep];
  const value = condition.field ? stepOut?.[condition.field] : stepOut;
  if (condition.equals !== undefined) return value === condition.equals;
  if (condition.truthy === true) return !!value;
  if (condition.truthy === false) return !value;
  return !!value;
}

async function runStep(
  step: WorkflowStep,
  context: Record<string, any>,
  connections: OAuthConnection[],
  user: UserContext,
): Promise<StepResult> {
  const start = Date.now();
  try {
    if (step.type === 'tool') {
      const resolvedInput = resolveTemplate(step.input ?? {}, context);
      const call: ToolCall = { name: step.tool, input: resolvedInput };
      let lastErr: string | undefined;
      const maxAttempts = (step.retries ?? 0) + 1;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const result: ToolResult = await executeTool(call, connections, user);
        if (result.success) {
          context[step.id] = result;
          return { id: step.id, type: 'tool', success: true, output: result, durationMs: Date.now() - start };
        }
        lastErr = result.content;
        // Brief backoff
        if (attempt < maxAttempts - 1) await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
      }
      return { id: step.id, type: 'tool', success: false, error: lastErr, durationMs: Date.now() - start };
    }

    if (step.type === 'if') {
      const branch = evalCondition(step.condition, context) ? step.then : (step.else ?? []);
      const branchResults: StepResult[] = [];
      for (const child of branch) {
        const r = await runStep(child, context, connections, user);
        branchResults.push(r);
        if (!r.success) {
          return {
            id: step.id, type: 'if', success: false,
            error: `branch step ${r.id} failed: ${r.error}`,
            output: { branchResults },
            durationMs: Date.now() - start,
          };
        }
      }
      return { id: step.id, type: 'if', success: true, output: { branchResults }, durationMs: Date.now() - start };
    }

    if (step.type === 'parallel') {
      const results = await Promise.all(step.steps.map((s) => runStep(s, context, connections, user)));
      const allOk = results.every((r) => r.success);
      return {
        id: step.id, type: 'parallel', success: allOk,
        output: { childResults: results },
        error: allOk ? undefined : results.filter((r) => !r.success).map((r) => `${r.id}: ${r.error}`).join('; '),
        durationMs: Date.now() - start,
      };
    }

    if (step.type === 'delay') {
      // Cap to 10s to stay well under Vercel function limits
      const ms = Math.min(step.ms, 10_000);
      await new Promise((r) => setTimeout(r, ms));
      return { id: step.id, type: 'delay', success: true, durationMs: Date.now() - start };
    }

    return { id: (step as any).id, type: 'unknown', success: false, error: `unknown step type`, durationMs: Date.now() - start };
  } catch (err) {
    return { id: step.id, type: step.type, success: false, error: String(err), durationMs: Date.now() - start };
  }
}

/**
 * Run a workflow definition end-to-end. Loads the user's connections +
 * context once at the top so every step shares them. Stops on the first
 * failure (workflows are typically dependent chains).
 */
export async function runWorkflow(
  tenantPhone: string,
  workflow: WorkflowDefinition,
): Promise<WorkflowResult> {
  const totalStart = Date.now();
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  const user = await loadUserContext(cleanPhone, 'workflow-runner');
  const connections = await loadConnectionsForPhone(cleanPhone);
  const context: Record<string, any> = {};

  const results: StepResult[] = [];
  for (const step of workflow.steps) {
    const r = await runStep(step, context, connections, user);
    results.push(r);
    if (!r.success) break;
  }

  const ok = results.every((r) => r.success);
  return { ok, totalDurationMs: Date.now() - totalStart, steps: results };
}

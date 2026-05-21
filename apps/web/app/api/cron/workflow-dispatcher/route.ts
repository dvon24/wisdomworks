/**
 * Workflow dispatcher cron — runs every minute, fires due user-defined
 * workflows.
 *
 * Reads from `user_workflows` (introduced in 2026-05-21b migration), runs
 * each one whose `next_run_at` is in the past via the executor, and
 * updates the bookkeeping columns (last_run_at, last_run_outcome,
 * last_run_error, next_run_at).
 *
 * Output of a successful run gets enqueued via the outbound queue so the
 * owner sees it the next time their chat is idle — never interrupts an
 * active conversation. Failures route through Axis (when she's
 * provisioned for the tenant) so the audit story stays consistent.
 *
 * Auth: shares the dual-auth pattern with other crons — accepts either
 * Vercel's auto-generated CRON_SECRET or the OWNER_API_TOKEN for manual
 * invocation during debugging.
 */

import { NextResponse } from 'next/server';
import { executeWorkflow } from '../../_lib/workflow-executor';
import { nextRunAfter } from '../../_lib/cron-next';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supaHeaders = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

function authorized(request: Request): boolean {
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return false;
  const token = auth.slice(7);
  if (process.env.CRON_SECRET && token === process.env.CRON_SECRET) return true;
  if (process.env.OWNER_API_TOKEN && token === process.env.OWNER_API_TOKEN) return true;
  return false;
}

interface DueWorkflow {
  id: string;
  tenant_phone: string;
  name: string;
  cron_expr: string | null;
  steps: any[];
}

async function fetchDueWorkflows(now: Date): Promise<DueWorkflow[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/user_workflows?status=eq.active&next_run_at=lte.${encodeURIComponent(now.toISOString())}&select=id,tenant_phone,name,cron_expr,steps`,
      { headers: supaHeaders() },
    );
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

async function recordRun(
  workflowId: string,
  outcome: 'success' | 'partial' | 'failed',
  error: string | undefined,
  nextRunAt: Date | null,
): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/user_workflows?id=eq.${workflowId}`, {
      method: 'PATCH',
      headers: { ...supaHeaders(), Prefer: 'return=minimal' },
      body: JSON.stringify({
        last_run_at: new Date().toISOString(),
        last_run_outcome: outcome,
        last_run_error: error ?? null,
        next_run_at: nextRunAt?.toISOString() ?? null,
        updated_at: new Date().toISOString(),
      }),
    });
  } catch (err) {
    console.warn(`[workflow-dispatcher] recordRun failed for ${workflowId}:`, err);
  }
}

async function enqueueResult(
  tenantPhone: string,
  workflowName: string,
  outcome: 'success' | 'partial' | 'failed',
  summary: string,
): Promise<void> {
  try {
    const { enqueueOutboundMessage } = await import('../../_lib/owner-message');
    const badge = outcome === 'success' ? '✓' : outcome === 'partial' ? '⚠' : '✗';
    await enqueueOutboundMessage({
      tenantPhone,
      body: `${badge} *${workflowName}* — ${summary}`,
      source: 'workflow',
      priority: 'digest',
    });
  } catch (err) {
    console.warn('[workflow-dispatcher] enqueue failed (workflow ran, owner just won\'t see it):', err);
  }
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const dueWorkflows = await fetchDueWorkflows(now);

  if (dueWorkflows.length === 0) {
    return NextResponse.json({ ok: true, processed: 0 });
  }

  const results: Array<{
    workflow_id: string;
    workflow_name: string;
    outcome: string;
    steps_completed: number;
    steps_total: number;
    error?: string;
  }> = [];

  for (const wf of dueWorkflows) {
    try {
      const execResult = await executeWorkflow({
        workflowId: wf.id,
        tenantPhone: wf.tenant_phone,
        steps: Array.isArray(wf.steps) ? wf.steps : [],
        workflowName: wf.name,
      });

      // Compute next run from cron expression (or null for on-demand).
      const next = wf.cron_expr ? nextRunAfter(wf.cron_expr, new Date()) : null;

      await recordRun(wf.id, execResult.outcome, execResult.error, next);

      const summary = execResult.outcome === 'success'
        ? `${execResult.steps_completed}/${execResult.steps_total} steps in ${Math.round(execResult.duration_ms / 100) / 10}s`
        : execResult.outcome === 'partial'
          ? `partial — ${execResult.steps_completed}/${execResult.steps_total} steps before failure: ${execResult.step_outcomes[execResult.steps_completed]?.error ?? 'unknown'}`
          : `failed at step 1: ${execResult.step_outcomes[0]?.error ?? execResult.error ?? 'unknown'}`;
      await enqueueResult(wf.tenant_phone, wf.name, execResult.outcome, summary);

      results.push({
        workflow_id: wf.id,
        workflow_name: wf.name,
        outcome: execResult.outcome,
        steps_completed: execResult.steps_completed,
        steps_total: execResult.steps_total,
        error: execResult.error,
      });
    } catch (err: any) {
      console.error(`[workflow-dispatcher] uncaught error on ${wf.id}:`, err);
      await recordRun(wf.id, 'failed', err?.message ?? String(err), wf.cron_expr ? nextRunAfter(wf.cron_expr, new Date()) : null);
      results.push({
        workflow_id: wf.id,
        workflow_name: wf.name,
        outcome: 'failed',
        steps_completed: 0,
        steps_total: Array.isArray(wf.steps) ? wf.steps.length : 0,
        error: err?.message ?? String(err),
      });
    }
  }

  return NextResponse.json({ ok: true, processed: dueWorkflows.length, results });
}

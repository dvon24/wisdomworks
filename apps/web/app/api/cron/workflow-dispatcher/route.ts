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
  consecutive_failures: number;
}

// Auto-pause workflows after this many consecutive failures so a
// workflow with lapsed auth (lost OAuth token, e.g. Graph 401)
// doesn't spam the owner with "✗ failed" every cron tick.
const AUTO_PAUSE_FAILURE_THRESHOLD = 3;

async function fetchDueWorkflows(now: Date): Promise<DueWorkflow[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/user_workflows?status=eq.active&next_run_at=lte.${encodeURIComponent(now.toISOString())}&select=id,tenant_phone,name,cron_expr,steps,consecutive_failures`,
      { headers: supaHeaders() },
    );
    if (!res.ok) return [];
    const rows = await res.json();
    // Defensive default — column was added 2026-05-27 via
    // db/migrations/2026-05-27-workflow-failure-counter.sql. If the
    // migration hasn't been applied yet, treat as 0 so the dispatcher
    // still functions; auto-pause just won't fire.
    return rows.map((r: any) => ({ ...r, consecutive_failures: r.consecutive_failures ?? 0 }));
  } catch {
    return [];
  }
}

async function recordRun(
  workflowId: string,
  outcome: 'success' | 'partial' | 'failed',
  error: string | undefined,
  nextRunAt: Date | null,
  consecutiveFailures: number,
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
        consecutive_failures: consecutiveFailures,
        updated_at: new Date().toISOString(),
      }),
    });
  } catch (err) {
    console.warn(`[workflow-dispatcher] recordRun failed for ${workflowId}:`, err);
  }
}

async function autoPauseWorkflow(
  workflowId: string,
  reason: string,
): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/user_workflows?id=eq.${workflowId}`, {
      method: 'PATCH',
      headers: { ...supaHeaders(), Prefer: 'return=minimal' },
      body: JSON.stringify({
        status: 'paused',
        last_run_error: `auto-paused: ${reason}`,
        // 2026-05-27 — audit columns added in
        // db/migrations/2026-05-27-workflow-consecutive-failures.sql.
        // Lets owner queries / dashboards show WHEN + WHY without
        // parsing last_run_error text.
        auto_paused_at: new Date().toISOString(),
        auto_paused_reason: reason.slice(0, 300),
        updated_at: new Date().toISOString(),
      }),
    });
  } catch (err) {
    console.warn(`[workflow-dispatcher] auto-pause failed for ${workflowId}:`, err);
  }
}

/**
 * Deliver the substantive content produced by a successful workflow,
 * with NO plumbing prefix. For coaching/briefing workflows the owner
 * wants the content (workout, weather, project status), not the
 * workflow plumbing — they didn't ask for "✓ ran in 0.4s, here's the
 * content," they asked for the content.
 */
async function enqueueWorkflowContent(tenantPhone: string, content: string): Promise<void> {
  try {
    const { enqueueOutboundMessage } = await import('../../_lib/owner-message');
    await enqueueOutboundMessage({
      tenantPhone,
      body: content,
      source: 'workflow',
      priority: 'digest',
    });
  } catch (err) {
    console.warn('[workflow-dispatcher] content enqueue failed:', err);
  }
}

/**
 * Owner-facing notice for workflow lifecycle events (auto-pause, etc.).
 * Includes the workflow name + status badge so the owner knows which
 * workflow needs attention and can identify it by name.
 */
async function enqueueWorkflowNotice(
  tenantPhone: string,
  workflowName: string,
  badge: '✓' | '⚠' | '✗',
  body: string,
): Promise<void> {
  try {
    const { enqueueOutboundMessage } = await import('../../_lib/owner-message');
    await enqueueOutboundMessage({
      tenantPhone,
      body: `${badge} *${workflowName}* — ${body}`,
      source: 'workflow',
      priority: 'digest',
    });
  } catch (err) {
    console.warn('[workflow-dispatcher] notice enqueue failed:', err);
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

      // Track consecutive failures so we can auto-pause workflows that
      // are failing chronically (e.g. lost OAuth token). Resets on
      // success/partial-with-content, increments on full failure.
      const isFailure = execResult.outcome === 'failed';
      const newFailureCount = isFailure ? (wf.consecutive_failures ?? 0) + 1 : 0;
      await recordRun(wf.id, execResult.outcome, execResult.error, next, newFailureCount);

      // ──────────────────────────────────────────────────────────────────
      // OWNER-FACING DELIVERY GATE
      // 2026-05-27 — Devon's morning transcript showed workflow execution
      // telemetry leaking to WhatsApp ("✗ coach-morning-workout-prompt —
      // failed at step 1: Could not fetch calendar: 401" every morning).
      // Owner should ONLY see workflow output when it's substantive:
      //   - success + step output > 50 chars of useful content
      //   - AND the last meaningful step was NOT a meta-tool (remember_this
      //     leaks internal atom IDs)
      // Failures, partial outcomes, and bare success-no-content all go to
      // logs. Repeated failures trigger auto-pause + single notification.
      // ──────────────────────────────────────────────────────────────────
      // 2026-05-28 — added the recall_* + show_* tools after seeing axis_critiques
      // rows 18-20: a coach-morning-workout workflow was surfacing recall_atoms
      // output verbatim ("68 remembered (preference): ✓ [6c1d54f3] preference: ...")
      // to the owner via WhatsApp. These tools produce internal IDs and meta-
      // information meant for Iris's reasoning, not owner-facing prose. Workflows
      // that need to USE this data should have a synthesis step after; raw recall
      // output should never be the final owner-visible step.
      const META_TOOLS = new Set([
        'remember_this',
        'set_canonical_role',
        'enable_mcp_server',
        'recall_atoms',
        'recall_recent_documents',
        'recall_behavioral_rag',
        'show_disposition_profile',
        'show_agent_sop',
        'show_axis_audit_summary',
        'list_agent_tool_requests',
      ]);
      const lastOk = execResult.step_outcomes
        .slice()
        .reverse()
        .find((o: any) => o.success && (o.output_preview ?? '').length > 50 && !META_TOOLS.has(o.tool ?? ''));

      if (execResult.outcome === 'success' && lastOk?.output_preview) {
        // Real content to deliver. NO plumbing prefix — owner wants
        // the workout/briefing/recommendation, not "✓ workflow_name —".
        // ──────────────────────────────────────────────────────────────
        // AXIS AUDIT — workflow content surface
        // 2026-05-27 — workflow-generated content (Coach's workout,
        // Marcus's briefing, etc.) goes through the same Generator-
        // Critic loop as iris-chat replies. Catches the case where a
        // workflow's tool output violates a disposition rule (e.g.
        // Coach recommending heavy chest the week the owner explicitly
        // told us to stay light). Persists hits to axis_critiques for
        // the learning loop. Non-blocking — ships original on critic
        // failure.
        // ──────────────────────────────────────────────────────────────
        let auditedContent = lastOk.output_preview;
        try {
          const { critiqueResponse, persistCritique } = await import('../../_lib/axis-critic');
          const critique = await critiqueResponse({
            surface: 'iris-chat', // Reuse iris-chat rule sheet — workflow
            // content goes to the owner the same way Iris does. Workflow-
            // specific rule sheet can be added later if patterns diverge.
            ownerMessage: `Workflow "${wf.name}" content (proactive cron — no specific owner question this turn).`,
            draft: lastOk.output_preview,
            recentTurns: [],
            toolsUsedThisTurn: execResult.step_outcomes.map((o: any) => o.tool).filter(Boolean),
            tenantPhone: wf.tenant_phone,
          });
          void persistCritique({
            tenantPhone: wf.tenant_phone,
            surface: 'iris-chat',
            critique,
            sourceMessage: `workflow:${wf.name}`,
            draft: lastOk.output_preview,
            revisionAttempted: false, // Workflow content revision needs
            // re-running the underlying tool — too expensive for
            // surface gain. Log + ship + tune the workflow's prompt.
          });
          if (!critique.passes) {
            const highCount = critique.violations.filter((v: any) => v.severity === 'high').length;
            console.warn(`[workflow-dispatcher] Axis flagged ${critique.violations.length} (${highCount} high) on ${wf.name}: ${JSON.stringify(critique.violations.map((v: any) => `${v.severity}:${v.rule}`))}`);
          }
        } catch (err: any) {
          console.warn(`[workflow-dispatcher] Axis audit failed (non-blocking): ${err?.message ?? String(err)}`);
        }
        await enqueueWorkflowContent(wf.tenant_phone, auditedContent);
      } else if (isFailure && newFailureCount === AUTO_PAUSE_FAILURE_THRESHOLD) {
        // First time hitting the threshold — pause + send single notice.
        await autoPauseWorkflow(wf.id, execResult.error ?? execResult.step_outcomes[0]?.error ?? 'unknown');
        const errBlurb = (execResult.error ?? execResult.step_outcomes[0]?.error ?? 'unknown').slice(0, 200);
        await enqueueWorkflowNotice(
          wf.tenant_phone,
          wf.name,
          '✗',
          `Paused after ${AUTO_PAUSE_FAILURE_THRESHOLD} consecutive failures.\n\nLast error: ${errBlurb}\n\nFix the underlying issue (often an expired OAuth connection in the deck) and reply "activate ${wf.name}" to resume.`,
        );
        console.warn(`[workflow-dispatcher] AUTO-PAUSED ${wf.name} (${wf.id}) after ${AUTO_PAUSE_FAILURE_THRESHOLD} failures: ${errBlurb}`);
      } else if (isFailure) {
        // Pre-threshold failure — log only, no owner spam.
        console.log(`[workflow-dispatcher] ${wf.name} failed (${newFailureCount}/${AUTO_PAUSE_FAILURE_THRESHOLD}): ${(execResult.error ?? execResult.step_outcomes[0]?.error ?? 'unknown').slice(0, 200)}`);
      } else if (execResult.outcome === 'partial') {
        // Partial — log only. If the part that ran produced content, the
        // success branch above would have caught it.
        console.log(`[workflow-dispatcher] ${wf.name} partial: ${execResult.steps_completed}/${execResult.steps_total} — ${(execResult.step_outcomes[execResult.steps_completed]?.error ?? 'unknown').slice(0, 200)}`);
      } else {
        // Success but no substantive content (or final step was a meta-
        // tool). Log so we can see it ran, don't bother the owner.
        console.log(`[workflow-dispatcher] ${wf.name} succeeded silently (${execResult.steps_completed}/${execResult.steps_total} steps, ${Math.round(execResult.duration_ms / 100) / 10}s)`);
      }

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
      // Increment failure counter on uncaught errors too — they still
      // count toward auto-pause.
      const newCount = (wf.consecutive_failures ?? 0) + 1;
      await recordRun(wf.id, 'failed', err?.message ?? String(err), wf.cron_expr ? nextRunAfter(wf.cron_expr, new Date()) : null, newCount);
      if (newCount === AUTO_PAUSE_FAILURE_THRESHOLD) {
        await autoPauseWorkflow(wf.id, err?.message ?? String(err));
        await enqueueWorkflowNotice(
          wf.tenant_phone,
          wf.name,
          '✗',
          `Paused after ${AUTO_PAUSE_FAILURE_THRESHOLD} consecutive failures.\n\nLast error: ${(err?.message ?? String(err)).slice(0, 200)}\n\nReply "activate ${wf.name}" to resume.`,
        );
      }
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

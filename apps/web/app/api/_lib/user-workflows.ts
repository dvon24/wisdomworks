/**
 * User-defined workflow CRUD — backs the create_workflow / list_workflows /
 * pause_workflow / delete_workflow / run_workflow_now Iris tools.
 *
 * Storage in user_workflows (2026-05-21b migration). Every new workflow
 * lands in status='pending_approval' — the dispatcher cron only fires
 * status='active', so the owner has to approve once before the workflow
 * starts running automatically. That gate uses the existing pending-action
 * pattern, not a new approval-queue table.
 */

import { nextRunAfter, parseCronExpression, cronsOverlap } from './cron-next';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

export interface WorkflowStep {
  agent?: string;
  tool: string;
  args?: Record<string, any>;
}

export interface UserWorkflow {
  id: string;
  tenant_phone: string;
  name: string;
  description: string | null;
  cron_expr: string | null;
  steps: WorkflowStep[];
  status: 'pending_approval' | 'active' | 'paused' | 'removed';
  last_run_at: string | null;
  last_run_outcome: 'success' | 'partial' | 'failed' | null;
  last_run_error: string | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateWorkflowResult {
  ok: boolean;
  workflow?: UserWorkflow;
  reason?: string;
  /** True when an equivalent workflow already existed and we returned it
   *  instead of inserting a duplicate (same schedule + same agent→tool steps). */
  duplicate?: boolean;
  proposal_summary: string;
}

/** Ordered agent→tool step sequence (arg VALUES ignored, so two genuinely-
 *  distinct flows that merely share a time still differ on steps). */
function stepSignature(steps: WorkflowStep[]): string {
  return (steps ?? [])
    .map((s) => `${(s.agent ?? '').trim().toLowerCase()}→${(s.tool ?? '').trim().toLowerCase()}`)
    .join('|');
}

/**
 * A new workflow is a REDUNDANT duplicate of an existing one when they run the
 * SAME steps AND their schedules collide — either the exact same cron string OR
 * a schedule overlap (daily vs weekday at the same time). Exact-string matching
 * alone missed the real bug: `coach-daily-workout-3pm-cet` ('0 14 * * *') and
 * `weekday-workout-delivery` ('0 14 * * 1-5') have identical steps and both fire
 * Mon–Fri at 3pm, but different cron strings AND different names — so neither the
 * signature dedup here nor the name dedup in the seeder caught them, and the
 * owner got stacked workouts. Returns the conflicting existing workflow, if any.
 */
export function findRedundantWorkflow(
  existing: Pick<UserWorkflow, 'name' | 'status' | 'cron_expr' | 'steps'>[],
  cronExpr: string | null | undefined,
  steps: WorkflowStep[],
): Pick<UserWorkflow, 'name' | 'status' | 'cron_expr' | 'steps'> | undefined {
  const sig = stepSignature(steps);
  const normCron = (cronExpr ?? '').trim();
  return existing.find((w) => {
    if (stepSignature(w.steps ?? []) !== sig) return false;
    const wCron = (w.cron_expr ?? '').trim();
    // same exact schedule (incl. both on-demand) OR overlapping cron schedules
    if (normCron === wCron) return true;
    return cronsOverlap(cronExpr ?? null, w.cron_expr ?? null);
  });
}

/**
 * Create a workflow in pending_approval state. Owner has to approve once
 * (via the standard pending-action pattern in this conversation) before
 * the dispatcher starts firing it.
 */
export async function createUserWorkflow(args: {
  tenantPhone: string;
  name: string;
  description?: string;
  cronExpr?: string | null;
  steps: WorkflowStep[];
  /** When true, create the workflow ACTIVE immediately — for when the OWNER
   *  directly asked for it ("I want my workout at 7am"); their request IS the
   *  approval. When false/omitted, lands in pending_approval for an explicit
   *  approve step (use for workflows an AGENT proposed, not owner-stated). */
  activate?: boolean;
}): Promise<CreateWorkflowResult> {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return { ok: false, reason: 'supabase_not_configured', proposal_summary: '' };
  }
  const cleanPhone = args.tenantPhone.replace(/[\s\-+()]/g, '');
  const name = (args.name ?? '').trim();
  if (!name) return { ok: false, reason: 'empty_name', proposal_summary: '' };
  if (!Array.isArray(args.steps) || args.steps.length === 0) {
    return { ok: false, reason: 'empty_steps', proposal_summary: '' };
  }
  for (let i = 0; i < args.steps.length; i++) {
    if (!args.steps[i]?.tool) {
      return { ok: false, reason: `step_${i}_missing_tool`, proposal_summary: '' };
    }
  }

  // Validate cron expression if provided. Reject upfront — better than the
  // dispatcher silently never firing because it can't compute next_run_at.
  if (args.cronExpr && !parseCronExpression(args.cronExpr)) {
    return { ok: false, reason: 'invalid_cron_expression', proposal_summary: '' };
  }

  // Dedup (2026-06-01): createUserWorkflow used to insert unconditionally, so
  // near-identical workflows piled up (e.g. two "Coach → delegate_to_agent @
  // 13:00 UTC" workouts created across two turns). Bail if a non-removed
  // workflow already has the SAME schedule + SAME agent→tool step sequence;
  // return the existing one so the caller can tell the owner instead of
  // silently creating a twin.
  try {
    const existingRes = await fetch(
      `${SUPABASE_URL}/rest/v1/user_workflows?tenant_phone=eq.${cleanPhone}&status=neq.removed&select=id,name,status,cron_expr,steps`,
      { headers: headers() },
    );
    if (existingRes.ok) {
      const existing: UserWorkflow[] = await existingRes.json();
      const dup = findRedundantWorkflow(existing, args.cronExpr ?? null, args.steps);
      if (dup) {
        return {
          ok: true,
          duplicate: true,
          workflow: dup as UserWorkflow,
          proposal_summary: `You already have "${dup.name}" [${dup.status}] running the same steps on an overlapping schedule (it: ${dup.cron_expr ?? 'on-demand'}; requested: ${args.cronExpr ?? 'on-demand'}) — not creating a duplicate. Reply "tweak ${dup.name}" to change it, or "remove ${dup.name}" first if you want to recreate it.`,
        };
      }
    }
  } catch (err) {
    console.warn('[user-workflows] dedup pre-check failed (proceeding with create):', err);
  }

  const nextRun = args.cronExpr ? nextRunAfter(args.cronExpr, new Date()) : null;

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/user_workflows`, {
      method: 'POST',
      headers: { ...headers(), Prefer: 'return=representation' },
      body: JSON.stringify({
        tenant_phone: cleanPhone,
        name,
        description: args.description ?? null,
        cron_expr: args.cronExpr ?? null,
        steps: args.steps,
        status: args.activate ? 'active' : 'pending_approval',
        next_run_at: nextRun?.toISOString() ?? null,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, reason: `${res.status}: ${text.slice(0, 200)}`, proposal_summary: '' };
    }
    const rows = await res.json();
    const created = (Array.isArray(rows) ? rows[0] : rows) as UserWorkflow;

    const stepsDesc = args.steps
      .map((s, i) => `${i + 1}. ${s.agent ? s.agent + ' → ' : ''}${s.tool}${s.args && Object.keys(s.args).length ? ` (${Object.keys(s.args).join(', ')})` : ''}`)
      .join('  ');
    const scheduleDesc = args.cronExpr
      ? `every "${args.cronExpr}"${nextRun ? `, first run ${nextRun.toISOString().slice(0, 16).replace('T', ' ')} UTC` : ''}`
      : 'on-demand only (no schedule)';

    const summary = args.activate
      ? `Workflow "${name}" is set up and ACTIVE — it'll run automatically. Schedule: ${scheduleDesc}. Steps: ${stepsDesc}. Say "pause ${name}" or "delete ${name}" anytime to stop it.`
      : `Workflow "${name}" created in pending_approval state. Schedule: ${scheduleDesc}. Steps: ${stepsDesc}. Reply "approve ${name}" to activate, or "tweak ${name}" to adjust.`;
    return {
      ok: true,
      workflow: created,
      proposal_summary: summary,
    };
  } catch (err: any) {
    return { ok: false, reason: err?.message ?? String(err), proposal_summary: '' };
  }
}

export async function listUserWorkflows(tenantPhone: string): Promise<UserWorkflow[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/user_workflows?tenant_phone=eq.${cleanPhone}&status=neq.removed&select=*&order=created_at.desc`,
      { headers: headers() },
    );
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export async function setWorkflowStatus(args: {
  tenantPhone: string;
  name: string;
  status: 'active' | 'paused' | 'removed';
}): Promise<{ ok: boolean; workflow?: UserWorkflow; reason?: string }> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { ok: false, reason: 'supabase_not_configured' };
  const cleanPhone = args.tenantPhone.replace(/[\s\-+()]/g, '');
  const name = (args.name ?? '').trim();
  if (!name) return { ok: false, reason: 'empty_name' };
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/user_workflows?tenant_phone=eq.${cleanPhone}&name=eq.${encodeURIComponent(name)}`,
      {
        method: 'PATCH',
        headers: { ...headers(), Prefer: 'return=representation' },
        body: JSON.stringify({ status: args.status, updated_at: new Date().toISOString() }),
      },
    );
    if (!res.ok) return { ok: false, reason: `${res.status}` };
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) return { ok: false, reason: 'workflow_not_found' };
    return { ok: true, workflow: rows[0] };
  } catch (err: any) {
    return { ok: false, reason: err?.message ?? String(err) };
  }
}

/** Bulk-handle every pending_approval workflow at once. For 'active', each
 *  workflow's next_run_at is recomputed to its NEXT future slot so bulk-approval
 *  doesn't fire a pile of stale-pending workflows all at once. */
export async function setAllPendingWorkflows(
  tenantPhone: string,
  status: 'active' | 'removed',
): Promise<{ ok: boolean; count: number; names: string[]; reason?: string }> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { ok: false, count: 0, names: [], reason: 'supabase_not_configured' };
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  try {
    const listRes = await fetch(
      `${SUPABASE_URL}/rest/v1/user_workflows?tenant_phone=eq.${cleanPhone}&status=eq.pending_approval&select=id,name,cron_expr`,
      { headers: headers() },
    );
    if (!listRes.ok) return { ok: false, count: 0, names: [], reason: `${listRes.status}` };
    const pending: Array<{ id: string; name: string; cron_expr: string | null }> = await listRes.json();
    if (pending.length === 0) return { ok: true, count: 0, names: [] };

    if (status === 'removed') {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/user_workflows?tenant_phone=eq.${cleanPhone}&status=eq.pending_approval`,
        { method: 'PATCH', headers: { ...headers(), Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'removed', updated_at: new Date().toISOString() }) },
      );
      if (!res.ok) return { ok: false, count: 0, names: [], reason: `${res.status}` };
      return { ok: true, count: pending.length, names: pending.map((w) => w.name) };
    }

    // Activate one-by-one so each gets a fresh next_run_at (not an immediate
    // catch-up fire on a stale pending row).
    let count = 0;
    const names: string[] = [];
    for (const w of pending) {
      const next = w.cron_expr ? nextRunAfter(w.cron_expr, new Date()) : null;
      const res = await fetch(`${SUPABASE_URL}/rest/v1/user_workflows?id=eq.${w.id}`, {
        method: 'PATCH',
        headers: { ...headers(), Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'active', next_run_at: next?.toISOString() ?? null, updated_at: new Date().toISOString() }),
      });
      if (res.ok) { count++; names.push(w.name); }
    }
    return { ok: true, count, names };
  } catch (err: any) {
    return { ok: false, count: 0, names: [], reason: err?.message ?? String(err) };
  }
}

export async function getWorkflowByName(args: {
  tenantPhone: string;
  name: string;
}): Promise<UserWorkflow | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const cleanPhone = args.tenantPhone.replace(/[\s\-+()]/g, '');
  const name = (args.name ?? '').trim();
  if (!name) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/user_workflows?tenant_phone=eq.${cleanPhone}&name=eq.${encodeURIComponent(name)}&select=*&limit=1`,
      { headers: headers() },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  } catch {
    return null;
  }
}

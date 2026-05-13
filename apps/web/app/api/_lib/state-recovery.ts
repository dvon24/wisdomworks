/**
 * Story 2.10 — Agent state snapshots + recovery.
 *
 * Two layers of durability:
 *   1. APP LAYER (this file) — periodic + pre_action snapshots into
 *      agent_state_snapshots. Fast recovery (sub-second) via the
 *      recover_agent_state RPC. Covers normal failure modes (bad action,
 *      logic error, regression on a deploy).
 *   2. INFRASTRUCTURE LAYER (Supabase Pro PITR) — daily backups + 24h
 *      point-in-time recovery for the disaster scenario (DB corruption,
 *      accidental TRUNCATE, dropped table). Toggled in the Supabase
 *      project dashboard, NOT in this file.
 *
 * Snapshot triggers:
 *   - 'periodic'    after every successful tick (cheap, captures drift)
 *   - 'pre_action'  before destructive tool calls (send_email,
 *                   create_calendar_event, add_agent_to_team, etc)
 *   - 'shutdown'    when stopTenantAgents flips to paused
 *   - 'manual'      user-triggered via /api/agents/lifecycle action='snapshot'
 *   - 'pre_recover' captured automatically by recover_agent_state RPC
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

interface InstanceForSnapshot {
  id: string;
  tenant_phone: string;
  state_data?: any;
  metadata?: any;
  nats_subjects?: any;
  signal_connections?: any;
}

export type SnapshotReason = 'periodic' | 'pre_action' | 'shutdown' | 'manual' | 'recovery_test';

export async function saveSnapshot(
  instance: InstanceForSnapshot,
  reason: SnapshotReason,
  triggeringRunId?: string,
): Promise<string | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/agent_state_snapshots`, {
      method: 'POST',
      headers: { ...headers(), Prefer: 'return=representation' },
      body: JSON.stringify({
        tenant_phone: instance.tenant_phone,
        agent_instance_id: instance.id,
        state_data: instance.state_data ?? {},
        operating_protocol: instance.metadata?.operating_protocol ?? null,
        wiring: {
          nats_subjects: instance.nats_subjects ?? [],
          signal_connections: instance.signal_connections ?? [],
        },
        reason,
        triggering_run_id: triggeringRunId ?? null,
      }),
    });
    if (!res.ok) {
      console.warn('[state-recovery] saveSnapshot failed:', res.status, await res.text());
      return null;
    }
    const rows = await res.json();
    return rows[0]?.id ?? null;
  } catch (err) {
    console.warn('[state-recovery] saveSnapshot error:', err);
    return null;
  }
}

export interface RecoveryResult {
  ok: boolean;
  recoveredSnapshotId?: string;
  recoveredAt?: string;
  preRecoverSnapshotId?: string;
  durationMs: number;
  error?: string;
}

/**
 * Recover an agent_instance to its state at a given point in time.
 * Defaults to 'now' which restores the most recent pre-corruption snapshot.
 */
export async function recoverFromSnapshot(
  instanceId: string,
  pointInTime?: Date,
): Promise<RecoveryResult> {
  const start = Date.now();
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return { ok: false, durationMs: 0, error: 'Supabase not configured' };
  }
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/recover_agent_state`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        p_instance_id: instanceId,
        p_point_in_time: (pointInTime ?? new Date()).toISOString(),
      }),
    });
    if (!res.ok) {
      return { ok: false, durationMs: Date.now() - start, error: `${res.status}: ${await res.text()}` };
    }
    const rows = await res.json();
    const row = rows[0];
    return {
      ok: true,
      recoveredSnapshotId: row?.recovered_snapshot_id,
      recoveredAt: row?.recovered_at,
      preRecoverSnapshotId: row?.pre_recover_snapshot_id,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return { ok: false, durationMs: Date.now() - start, error: String(err) };
  }
}

/**
 * Pre-action snapshot helper — call before a destructive tool fires.
 * Snapshots every agent_instance for the tenant. Best-effort; never
 * blocks the tool call on snapshot failure (we'd rather take a small
 * recoverability hit than refuse a real user action).
 *
 * Tools that should call this first: send_email, create_calendar_event,
 * schedule_event, qbo_create_invoice, create_payment_link,
 * publish_instagram_* / publish_facebook_post, approve_marketing_draft
 * with auto_publish=true, add_agent_to_team, remove_agent_from_team,
 * move_agent_under_manager, retire_skill.
 */
export async function snapshotBeforeAction(
  tenantPhone: string,
  actionName: string,
  triggeringRunId?: string,
): Promise<number> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return 0;
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  try {
    const instRes = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_instances?tenant_phone=eq.${cleanPhone}&status=eq.running&select=id,tenant_phone,state_data,metadata,nats_subjects,signal_connections`,
      { headers: headers() },
    );
    if (!instRes.ok) return 0;
    const instances = await instRes.json() as InstanceForSnapshot[];
    let count = 0;
    for (const inst of instances) {
      // Stamp the action name in state_data so the snapshot row can be
      // identified later ("snapshot from before send_email at 14:32").
      const stampedInstance = {
        ...inst,
        state_data: { ...(inst.state_data ?? {}), __pre_action__: actionName },
      };
      const id = await saveSnapshot(stampedInstance, 'pre_action', triggeringRunId);
      if (id) count++;
    }
    return count;
  } catch (err) {
    console.warn('[state-recovery] snapshotBeforeAction failed:', err);
    return 0;
  }
}

/** List recent snapshots for a tenant — surfaced via the rollback tool. */
export async function listRecentSnapshots(
  tenantPhone: string,
  limit = 10,
): Promise<Array<{
  id: string;
  agent_instance_id: string;
  reason: SnapshotReason;
  created_at: string;
  action_name?: string;
}>> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_state_snapshots?tenant_phone=eq.${cleanPhone}&order=created_at.desc&limit=${limit}&select=id,agent_instance_id,reason,created_at,state_data`,
      { headers: headers() },
    );
    if (!res.ok) return [];
    const rows = await res.json();
    return rows.map((r: any) => ({
      id: r.id,
      agent_instance_id: r.agent_instance_id,
      reason: r.reason,
      created_at: r.created_at,
      action_name: r.state_data?.__pre_action__,
    }));
  } catch {
    return [];
  }
}

/**
 * Story 2.10 — recovery test: snapshot → corrupt → recover → measure.
 * Asserts the 2-min SLA from NFR34.
 */
export async function recoveryTest(instanceId: string): Promise<{
  ok: boolean;
  totalMs: number;
  underSla: boolean;
  steps: Record<string, number>;
  error?: string;
}> {
  const totalStart = Date.now();
  const steps: Record<string, number> = {};
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return { ok: false, totalMs: 0, underSla: false, steps, error: 'Supabase not configured' };
  }

  try {
    // 1. Snapshot the current state
    const t0 = Date.now();
    const instRes = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_instances?id=eq.${instanceId}&select=id,tenant_phone,state_data,metadata,nats_subjects,signal_connections`,
      { headers: headers() },
    );
    const insts = instRes.ok ? await instRes.json() : [];
    const instance = insts[0];
    if (!instance) return { ok: false, totalMs: Date.now() - totalStart, underSla: false, steps, error: 'instance not found' };
    const snapId = await saveSnapshot(instance, 'recovery_test');
    steps.snapshot_ms = Date.now() - t0;

    // 2. Corrupt: write known-bad state_data
    const t1 = Date.now();
    await fetch(`${SUPABASE_URL}/rest/v1/agent_instances?id=eq.${instanceId}`, {
      method: 'PATCH',
      headers: { ...headers(), Prefer: 'return=minimal' },
      body: JSON.stringify({ state_data: { __recovery_test_corruption__: true, when: new Date().toISOString() } }),
    });
    steps.corrupt_ms = Date.now() - t1;

    // 3. Recover
    const t2 = Date.now();
    const recovery = await recoverFromSnapshot(instanceId);
    steps.recover_ms = Date.now() - t2;
    if (!recovery.ok) {
      return { ok: false, totalMs: Date.now() - totalStart, underSla: false, steps, error: `recover failed: ${recovery.error}` };
    }

    // 4. Verify the corruption is gone
    const t3 = Date.now();
    const verifyRes = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_instances?id=eq.${instanceId}&select=state_data`,
      { headers: headers() },
    );
    const verifyRows = verifyRes.ok ? await verifyRes.json() : [];
    const stillCorrupted = verifyRows[0]?.state_data?.__recovery_test_corruption__ === true;
    steps.verify_ms = Date.now() - t3;
    if (stillCorrupted) {
      return { ok: false, totalMs: Date.now() - totalStart, underSla: false, steps, error: 'corruption remained after recovery' };
    }

    const totalMs = Date.now() - totalStart;
    const SLA_MS = 2 * 60 * 1000; // NFR34 — 2 minutes
    return { ok: true, totalMs, underSla: totalMs < SLA_MS, steps };
  } catch (err) {
    return { ok: false, totalMs: Date.now() - totalStart, underSla: false, steps, error: String(err) };
  }
}

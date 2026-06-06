/**
 * Deferred delegations — the spend-cap recovery "door".
 *
 * When a tenant is over the daily spend cap, delegate_to_agent is withheld from
 * Iris. Instead of a dead-end (or the fabricated "passing to Coach now" that the
 * fabrication guard now blocks), Iris QUEUES the delegation here via the
 * queue_delegation tool. The per-minute drain cron runs each pending row the
 * moment the tenant is back under cap and notifies the owner with the result;
 * the owner can also override ("run it now") to execute immediately.
 *
 * Pure DB ops + a runner that takes executeTool INJECTED — so this module never
 * imports agent-tools (which imports this), avoiding a cycle.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

export type DeferredStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';

export interface DeferredDelegation {
  id: string;
  tenant_phone: string;
  target_agent: string;
  task: string;
  reason: string | null;
  source_message_id: string | null;
  status: DeferredStatus;
  attempts: number;
  result_preview: string | null;
  error: string | null;
  created_at: string;
}

/** Queue a delegation to run when the tenant is back under the spend cap.
 *  Returns the new id + how many are now pending for this tenant (for the
 *  owner-facing "you have N queued" line). */
export async function enqueueDeferredDelegation(args: {
  tenantPhone: string;
  targetAgent: string;
  task: string;
  reason?: string;
  sourceMessageId?: string;
}): Promise<{ id: string | null; pendingCount: number }> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { id: null, pendingCount: 0 };
  const cleanPhone = args.tenantPhone.replace(/[\s\-+()]/g, '');
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/deferred_delegations`, {
      method: 'POST',
      headers: { ...headers(), Prefer: 'return=representation' },
      body: JSON.stringify({
        tenant_phone: cleanPhone,
        target_agent: args.targetAgent,
        task: args.task.slice(0, 4000),
        reason: args.reason?.slice(0, 500) ?? null,
        source_message_id: args.sourceMessageId ?? null,
        status: 'pending',
      }),
    });
    if (!res.ok) {
      console.warn('[deferred] enqueue failed:', res.status, (await res.text()).slice(0, 200));
      return { id: null, pendingCount: 0 };
    }
    const rows = await res.json();
    const id = rows[0]?.id ?? null;
    const pendingCount = await countPending(cleanPhone);
    return { id, pendingCount };
  } catch (err) {
    console.warn('[deferred] enqueue exception:', err);
    return { id: null, pendingCount: 0 };
  }
}

async function countPending(cleanPhone: string): Promise<number> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/deferred_delegations?tenant_phone=eq.${cleanPhone}&status=eq.pending&select=id`,
      { headers: { ...headers(), Prefer: 'count=exact' } },
    );
    if (!res.ok) return 0;
    const rows = await res.json();
    return Array.isArray(rows) ? rows.length : 0;
  } catch {
    return 0;
  }
}

/** Pending rows. Omit tenantPhone to load across all tenants (the drain cron). */
export async function loadPendingDeferred(tenantPhone?: string, limit = 50): Promise<DeferredDelegation[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const tenantFilter = tenantPhone ? `&tenant_phone=eq.${tenantPhone.replace(/[\s\-+()]/g, '')}` : '';
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/deferred_delegations?status=eq.pending${tenantFilter}&order=created_at.asc&limit=${limit}&select=*`,
      { headers: headers() },
    );
    return res.ok ? await res.json() : [];
  } catch {
    return [];
  }
}

export async function markDeferred(id: string, fields: Partial<{
  status: DeferredStatus;
  attempts: number;
  result_preview: string;
  error: string;
  ran_at: string;
}>): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/deferred_delegations?id=eq.${id}`, {
      method: 'PATCH',
      headers: { ...headers(), Prefer: 'return=minimal' },
      body: JSON.stringify({ ...fields, updated_at: new Date().toISOString() }),
    });
  } catch (err) {
    console.warn('[deferred] markDeferred failed:', err);
  }
}

/** Tool runner signature — matches executeTool's shape without importing it. */
type ExecuteToolFn = (
  call: { name: string; input: Record<string, any> },
  connections: any[],
  user: any,
) => Promise<{ content: string; success?: boolean }>;

/**
 * Run one queued delegation through the real delegate_to_agent path (executeTool
 * INJECTED to avoid an import cycle). Marks the row running → done/failed and
 * returns the worker output. Caller delivers the result to the owner.
 *
 * NOTE: executeTool runs the worker regardless of the spend cap (the cap only
 * filters Iris's tool LIST, not direct execution) — exactly what we want both
 * for the post-reset drain (caller already checked under-cap) and the owner
 * override (intentionally bypasses the cap).
 */
export async function runOneDeferred(
  row: DeferredDelegation,
  deps: { executeTool: ExecuteToolFn; connections: any[]; user: any },
): Promise<{ ok: boolean; content: string }> {
  await markDeferred(row.id, { status: 'running', attempts: row.attempts + 1 });
  try {
    const r = await deps.executeTool(
      { name: 'delegate_to_agent', input: { agentName: row.target_agent, task: row.task } },
      deps.connections,
      deps.user,
    );
    const content = r.content ?? '';
    if (r.success === false) {
      await markDeferred(row.id, { status: 'failed', error: content.slice(0, 300), ran_at: new Date().toISOString() });
      return { ok: false, content };
    }
    await markDeferred(row.id, { status: 'done', result_preview: content.slice(0, 500), ran_at: new Date().toISOString() });
    return { ok: true, content };
  } catch (err: any) {
    const msg = String(err?.message ?? err).slice(0, 300);
    await markDeferred(row.id, { status: 'failed', error: msg, ran_at: new Date().toISOString() });
    return { ok: false, content: msg };
  }
}

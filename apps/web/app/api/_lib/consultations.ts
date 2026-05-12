/**
 * Phase 1B — Peer consultations between agents.
 *
 * When an agent (Riley, Alex, Marcus) is about to escalate something
 * that crosses domains or is recurring, they consult a relevant peer
 * first. The peer answers on their next tick; the asker incorporates
 * the answer on the tick after.
 *
 * Loop prevention: max depth 1 (no consult-of-consult). Timeout 15 min.
 * Self-consult and consult-back-to-asker are both rejected at the API
 * boundary, not at the DB.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

export type ConsultTrigger = 'pre_escalation' | 'cross_domain' | 'recurring_stuck' | 'owner_directed';
export type ConsultStatus = 'asked' | 'answered' | 'timeout' | 'declined';

export interface InboxConsult {
  id: string;
  from_agent_name: string;
  question: string;
  reason: string | null;
  trigger_kind: ConsultTrigger;
  asked_at: string;
  propagation_depth: number;
}

export interface OutboxConsult {
  id: string;
  to_agent_name: string;
  question: string;
  answer: string | null;
  status: ConsultStatus;
  answered_at: string | null;
}

// ─── Ask ──────────────────────────────────────────────────────────────────

export async function askPeer(args: {
  tenantPhone: string;
  fromAgentInstanceId: string;
  fromAgentName: string;
  toAgentInstanceId: string;
  toAgentName: string;
  question: string;
  reason?: string;
  triggerKind?: ConsultTrigger;
  parentConsultationId?: string;
}): Promise<{ id?: string; rejected?: string }> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { rejected: 'supabase not configured' };

  // Self-consult guard
  if (args.fromAgentInstanceId === args.toAgentInstanceId) {
    return { rejected: 'cannot consult yourself' };
  }

  // Depth guard — if this is a consult spawned from another consult, cap at 2
  let depth = 1;
  if (args.parentConsultationId) {
    try {
      const parentRes = await fetch(
        `${SUPABASE_URL}/rest/v1/agent_consultations?id=eq.${args.parentConsultationId}&select=propagation_depth,from_agent_instance_id`,
        { headers: headers() },
      );
      const rows = parentRes.ok ? await parentRes.json() : [];
      if (rows[0]) {
        depth = (rows[0].propagation_depth ?? 1) + 1;
        // Block consult-back-to-asker (Alex consults Marcus, Marcus consults Alex would be a loop)
        if (rows[0].from_agent_instance_id === args.toAgentInstanceId) {
          return { rejected: 'cannot consult the agent who consulted you (loop)' };
        }
      }
    } catch {
      // ignore
    }
  }
  if (depth > 2) return { rejected: 'consult depth cap reached (max 2 hops)' };

  // Throttle — don't allow the same asker to flood the same peer with consults
  try {
    const recentRes = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_consultations?from_agent_instance_id=eq.${args.fromAgentInstanceId}&to_agent_instance_id=eq.${args.toAgentInstanceId}&status=eq.asked&select=id`,
      { headers: headers() },
    );
    const pending = recentRes.ok ? await recentRes.json() : [];
    if (pending.length >= 2) {
      return { rejected: `already have ${pending.length} open consults waiting on ${args.toAgentName}` };
    }
  } catch {
    // ignore
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/agent_consultations`, {
      method: 'POST',
      headers: { ...headers(), Prefer: 'return=representation' },
      body: JSON.stringify({
        tenant_phone: args.tenantPhone,
        from_agent_instance_id: args.fromAgentInstanceId,
        from_agent_name: args.fromAgentName,
        to_agent_instance_id: args.toAgentInstanceId,
        to_agent_name: args.toAgentName,
        question: args.question.slice(0, 800),
        reason: args.reason?.slice(0, 500) ?? null,
        trigger_kind: args.triggerKind ?? 'pre_escalation',
        propagation_depth: depth,
        parent_consultation_id: args.parentConsultationId ?? null,
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      console.warn('[consultations] ask failed:', txt);
      return { rejected: `Supabase ${res.status}` };
    }
    const rows = await res.json();
    return { id: rows[0]?.id };
  } catch (err: any) {
    return { rejected: err?.message ?? String(err) };
  }
}

// ─── Answer ───────────────────────────────────────────────────────────────

export async function answerConsult(args: {
  consultationId: string;
  answer: string;
  declined?: boolean;
}): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/agent_consultations?id=eq.${args.consultationId}`, {
      method: 'PATCH',
      headers: { ...headers(), Prefer: 'return=minimal' },
      body: JSON.stringify({
        answer: args.answer.slice(0, 2000),
        status: args.declined ? 'declined' : 'answered',
        answered_at: new Date().toISOString(),
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Inbox / Outbox ───────────────────────────────────────────────────────

export async function consultInboxForAgent(agentInstanceId: string): Promise<InboxConsult[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/consult_inbox_for_agent`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ p_agent_instance_id: agentInstanceId }),
    });
    return res.ok ? await res.json() : [];
  } catch {
    return [];
  }
}

export async function consultOutboxForAgent(agentInstanceId: string, lookbackMinutes = 30): Promise<OutboxConsult[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/consult_outbox_for_agent`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ p_agent_instance_id: agentInstanceId, p_lookback_minutes: lookbackMinutes }),
    });
    return res.ok ? await res.json() : [];
  } catch {
    return [];
  }
}

export async function markConsultsFolded(consultIds: string[]): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY || consultIds.length === 0) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/agent_consultations?id=in.(${consultIds.join(',')})`, {
      method: 'PATCH',
      headers: { ...headers(), Prefer: 'return=minimal' },
      body: JSON.stringify({ metadata: { folded_in: new Date().toISOString() } }),
    });
  } catch {
    // ignore
  }
}

export async function expireStaleConsultations(): Promise<number> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return 0;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/expire_stale_consultations`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({}),
    });
    if (!res.ok) return 0;
    return parseInt((await res.text()).trim(), 10) || 0;
  } catch {
    return 0;
  }
}

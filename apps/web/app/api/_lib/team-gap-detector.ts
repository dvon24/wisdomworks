/**
 * Team gap detection — Sophia spots needs the current team doesn't cover.
 *
 * Two paths:
 *   1. Reactive (during chat): owner says "I keep losing leads because I
 *      can't answer fast enough" → Sophia calls propose_team_addition →
 *      emits a team_gap insight → owner sees it in the digest + Insights
 *      tab → approve → agent gets provisioned.
 *
 *   2. Proactive (daily detector — future): scan recent chat + atoms for
 *      repeated themes that don't map to any existing agent's lane, emit
 *      team_gap insights for the owner to review.
 *
 * This module owns the data side. The agent-tools layer exposes the
 * propose_team_addition tool that Sophia calls.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

export interface CurrentTeamMember {
  name: string;
  role: string;
  category: string | null;
  status: string | null;
  description?: string | null;
}

/** Load the active team for a tenant — used to check whether a proposed
 *  role overlaps an existing one before emitting a gap. */
export async function loadCurrentTeam(tenantPhone: string): Promise<CurrentTeamMember[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_configs?tenant_phone=eq.${cleanPhone}&status=neq.archived&select=agent_name,agent_role,status,config&order=created_at.asc`,
      { headers: headers() },
    );
    if (!res.ok) return [];
    const rows = await res.json();
    return rows.map((r: any) => ({
      name: r.agent_name,
      role: r.agent_role,
      category: r.config?.category ?? null,
      status: r.status,
      description: r.config?.description ?? null,
    }));
  } catch {
    return [];
  }
}

/** Find the most recent open team_gap insight for this tenant. */
export async function loadLatestOpenTeamGap(tenantPhone: string): Promise<any | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/business_insights?tenant_phone=eq.${cleanPhone}&detector=eq.team_gap&status=eq.proposed&order=detected_at.desc&limit=1&select=*`,
      { headers: headers() },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export interface TeamGapProposal {
  tenantPhone: string;
  /** Friendly name for the proposed agent (e.g. "Riley") */
  agentName: string;
  /** Role title (e.g. "Lead Intake & Quoting") */
  agentRole: string;
  /** One-sentence description of what they'll do */
  description: string;
  /** Tier hint: Haiku/Sonnet/Opus */
  tier?: 'Haiku' | 'Sonnet' | 'Opus';
  /** Lane: scheduler / customer_service / marketing / finance / operations / specialist */
  lane?: string;
  /** Why this role is needed — the owner-observable signal that triggered it */
  triggerReason: string;
  /** Concrete examples of what this agent would do (3-5 bullets) */
  exampleResponsibilities?: string[];
  /** Optional parent agent name if this should report to an existing manager */
  parentAgentName?: string;
}

/**
 * Emit a team_gap insight via the existing business_insights flow so the
 * owner sees it in the digest + Insights tab and can approve/dismiss.
 * Approval → the agent gets provisioned (handled in agent-tools approve).
 */
export async function emitTeamGapInsight(
  proposal: TeamGapProposal,
): Promise<{ ok: boolean; insightId?: string; reason?: string }> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { ok: false, reason: 'supabase not configured' };
  const cleanPhone = proposal.tenantPhone.replace(/[\s\-+()]/g, '');

  // Dedup signature — same proposed role won't re-emit while previous is
  // still open. Lowercase + collapsed-spaces so "Lead Intake" and
  // "lead intake" merge.
  const sig = `team_gap:${proposal.agentRole.toLowerCase().replace(/\s+/g, '_')}`;

  const bodyLines: string[] = [];
  if (proposal.exampleResponsibilities && proposal.exampleResponsibilities.length > 0) {
    bodyLines.push('What this agent would handle:');
    for (const e of proposal.exampleResponsibilities.slice(0, 5)) bodyLines.push(`  • ${e}`);
  }

  const why = `${proposal.triggerReason}${bodyLines.length > 0 ? '\n\n' + bodyLines.join('\n') : ''}`;
  const recommendedAction = `Add ${proposal.agentName} (${proposal.agentRole}) to your team. ${proposal.tier ? `Tier: ${proposal.tier}.` : ''} They'd start on their next tick.`;

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/business_insights`, {
      method: 'POST',
      headers: { ...headers(), Prefer: 'return=representation,resolution=ignore-duplicates' },
      body: JSON.stringify({
        tenant_phone: cleanPhone,
        detector: 'team_gap',
        severity: 'medium',
        title: `Team gap: no one covers "${proposal.agentRole}"`,
        why,
        recommended_action: recommendedAction,
        expected_impact: 'Closes a known gap the owner has surfaced. Approving provisions the agent immediately.',
        confidence: 0.85,
        payload: {
          agent_name: proposal.agentName,
          agent_role: proposal.agentRole,
          description: proposal.description,
          tier: proposal.tier ?? 'Sonnet',
          lane: proposal.lane ?? 'specialist',
          parent_agent_name: proposal.parentAgentName ?? null,
          trigger_reason: proposal.triggerReason,
          example_responsibilities: proposal.exampleResponsibilities ?? [],
        },
        metadata: { signature: sig },
      }),
    });
    if (!res.ok) {
      if (res.status === 409) return { ok: false, reason: 'duplicate — already proposed' };
      return { ok: false, reason: `Supabase ${res.status}` };
    }
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) return { ok: false, reason: 'already proposed' };

    // Mirror to the digest queue
    const { enqueueNotification } = await import('./notifications');
    const notifId = await enqueueNotification({
      tenantPhone: cleanPhone,
      kind: 'agent_observation',
      severity: 'medium',
      title: `💡 Team gap: ${proposal.agentRole}`,
      body: `${why}\n\n${recommendedAction}\n\nReply "approve insight ${rows[0].id.slice(0, 8)}" to add them.`,
      sourceAgent: 'Sophia',
      sourceId: rows[0].id,
      metadata: { insight_id: rows[0].id, detector: 'team_gap' },
    });
    if (notifId) {
      await fetch(`${SUPABASE_URL}/rest/v1/business_insights?id=eq.${rows[0].id}`, {
        method: 'PATCH',
        headers: { ...headers(), Prefer: 'return=minimal' },
        body: JSON.stringify({ surfaced_in_notification_id: notifId }),
      });
    }

    return { ok: true, insightId: rows[0].id };
  } catch (err: any) {
    return { ok: false, reason: err?.message ?? String(err) };
  }
}

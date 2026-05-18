/**
 * Package 3 of the unified trust model (see project_unified_trust_model.md).
 *
 * Per-agent PROMOTION CANDIDATE scoring + emission.
 *
 * For each active agent, weekly cron computes a candidacy score from
 * signals already in the DB:
 *   - agent_runs.outcome distribution (proposed/acted/escalated/observed)
 *   - approval rate on proposed actions (was the owner approving?)
 *   - agent_skills success rates (Story 2.15)
 *   - lessons_learned severity counts (corrections received)
 *   - owner_affirmations net_score (Package 2)
 *
 * If the agent's signals meet the threshold for the NEXT autonomy
 * level, emit a business_insight (Story 6.12 / approvals pipeline)
 * with the per-agent SOP attached as the evidence packet. Owner
 * approves via the existing approvals tab → autonomy bumps in
 * agent_configs.config.autonomy. Owner dismisses → temporary
 * cooldown to prevent re-spamming the same suggestion.
 *
 * Default mode is OPTION 2 (recommend + approve) — Devon explicitly
 * not yet confident in Option 3 (auto-promote with notification).
 * The auto-promote toggle waits until we have multi-tenant
 * threshold data.
 *
 * v1 thresholds (will need tightening with real data — kept liberal
 * so demo-ability happens early):
 *   L1 → L2: ≥5 ticks producing 'proposed' in last 30 days,
 *            approval rate ≥80%, fewer than 3 owner-dismissed-as-wrong.
 *   L2 → L3: ≥15 ticks at L2, approval rate ≥90%,
 *            ≥3 skills in lane with success_rate ≥0.8.
 *   L3 → L4: ≥45 days at L3, approval rate ≥95%, zero high-severity
 *            lessons in period, ≥1 owner affirmation in last 30 days.
 */

import { getAgentAffirmations } from './disposition-mining';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

export type Autonomy = 'L1' | 'L2' | 'L3' | 'L4';
const AUTONOMY_LADDER: Autonomy[] = ['L1', 'L2', 'L3', 'L4'];

function nextLevel(cur: Autonomy): Autonomy | null {
  const idx = AUTONOMY_LADDER.indexOf(cur);
  if (idx < 0 || idx === AUTONOMY_LADDER.length - 1) return null;
  return AUTONOMY_LADDER[idx + 1] ?? null;
}

export interface PromotionEvidence {
  ticks_in_period: number;
  by_outcome: Record<string, number>;
  approval_rate: number | null;
  proposals_approved: number;
  proposals_dismissed: number;
  skills_count: number;
  skills_above_80pct: number;
  high_severity_lessons: number;
  affirmation_net_score: number;
  days_at_current_level: number | null;
}

export interface PromotionCandidate {
  agent_name: string;
  agent_role: string;
  lane?: string;
  current_autonomy: Autonomy;
  candidate_autonomy: Autonomy;
  recommended: boolean;
  reason: string;
  evidence: PromotionEvidence;
}

/**
 * Pull all the inputs and compute the candidacy decision for ONE agent.
 * Returns null if the agent has no config row or is already at L4.
 */
export async function scoreAgentForPromotion(
  tenantPhone: string,
  agentName: string,
): Promise<PromotionCandidate | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');

  // 1. Agent config + current autonomy + level-changed-at
  const cfgRes = await fetch(
    `${SUPABASE_URL}/rest/v1/agent_configs?tenant_phone=eq.${cleanPhone}&agent_name=ilike.${encodeURIComponent(agentName)}&limit=1&select=id,agent_name,agent_role,config,status,updated_at`,
    { headers: headers() },
  );
  if (!cfgRes.ok) return null;
  const cfg = (await cfgRes.json())?.[0];
  if (!cfg) return null;
  const lane: string | undefined = cfg.config?.category;
  const current: Autonomy = (cfg.config?.autonomy as Autonomy) ?? 'L1';
  const next = nextLevel(current);
  if (!next) {
    // Already L4 — no promotion path. We still return a "candidate"
    // record so the caller can render "Marcus is at the top" if desired.
    return {
      agent_name: cfg.agent_name,
      agent_role: cfg.agent_role,
      lane,
      current_autonomy: current,
      candidate_autonomy: current,
      recommended: false,
      reason: 'Already at maximum autonomy (L4).',
      evidence: {
        ticks_in_period: 0,
        by_outcome: {},
        approval_rate: null,
        proposals_approved: 0,
        proposals_dismissed: 0,
        skills_count: 0,
        skills_above_80pct: 0,
        high_severity_lessons: 0,
        affirmation_net_score: 0,
        days_at_current_level: null,
      },
    };
  }

  // 2. Find the agent_instance to scope agent_runs
  const instRes = await fetch(
    `${SUPABASE_URL}/rest/v1/agent_instances?agent_config_id=eq.${cfg.id}&select=id,updated_at&limit=1`,
    { headers: headers() },
  );
  const inst = (instRes.ok ? await instRes.json() : [])?.[0];

  // 3. Pull agent_runs in the evaluation window. Different next-level
  //    targets imply different lookback windows.
  const windowDays = next === 'L2' ? 30 : next === 'L3' ? 30 : 45;
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

  const byOutcome: Record<string, number> = {};
  let proposalsApproved = 0;
  let proposalsDismissed = 0;
  if (inst?.id) {
    try {
      const runsRes = await fetch(
        `${SUPABASE_URL}/rest/v1/agent_runs?agent_instance_id=eq.${inst.id}&started_at=gte.${since}&select=outcome,metadata&limit=500`,
        { headers: headers() },
      );
      if (runsRes.ok) {
        const runs: Array<{ outcome: string; metadata?: any }> = await runsRes.json();
        for (const r of runs) {
          byOutcome[r.outcome] = (byOutcome[r.outcome] ?? 0) + 1;
          // approval state — encoded into metadata when the owner has
          // explicitly approved or dismissed a proposed action via the
          // approvals flow.
          if (r.outcome === 'proposed') {
            const status = r.metadata?.owner_approval ?? r.metadata?.approval_status;
            if (status === 'approved') proposalsApproved++;
            else if (status === 'dismissed' || status === 'rejected') proposalsDismissed++;
          }
        }
      }
    } catch {}
  }
  const ticksInPeriod = Object.values(byOutcome).reduce((s, n) => s + n, 0);
  const totalApprovalSignals = proposalsApproved + proposalsDismissed;
  const approvalRate = totalApprovalSignals > 0 ? proposalsApproved / totalApprovalSignals : null;

  // 4. Lane skills (Story 2.15)
  let skillsCount = 0;
  let skillsAbove80 = 0;
  if (lane) {
    try {
      const skillRes = await fetch(
        `${SUPABASE_URL}/rest/v1/agent_skills?tenant_phone=eq.${cleanPhone}&lane=eq.${encodeURIComponent(lane)}&retired_at=is.null&select=success_count,failure_count`,
        { headers: headers() },
      );
      if (skillRes.ok) {
        const skills: Array<{ success_count: number; failure_count: number }> = await skillRes.json();
        skillsCount = skills.length;
        for (const s of skills) {
          const total = (s.success_count ?? 0) + (s.failure_count ?? 0);
          if (total >= 3 && (s.success_count ?? 0) / total >= 0.8) skillsAbove80++;
        }
      }
    } catch {}
  }

  // 5. High-severity lessons in window
  let highSeverityLessons = 0;
  try {
    const lessRes = await fetch(
      `${SUPABASE_URL}/rest/v1/lessons_learned?tenant_phone=eq.${cleanPhone}&created_at=gte.${since}&severity=in.(high,critical)&select=count`,
      { headers: { ...headers(), Prefer: 'count=exact' } },
    );
    if (lessRes.ok) {
      const cr = lessRes.headers.get('content-range');
      highSeverityLessons = parseInt(cr?.split('/')[1] ?? '0', 10);
    }
  } catch {}

  // 6. Owner affirmations (Package 2)
  let affirmationNet = 0;
  try {
    const aff = await getAgentAffirmations(cleanPhone, cfg.agent_name, { windowDays });
    affirmationNet = aff.net_score;
  } catch {}

  // 7. Days at current level — approximated via agent_configs.updated_at.
  //    Imprecise (any config edit resets the clock), but the right
  //    cleaner approach would be a separate autonomy_changes audit log
  //    which isn't shipped yet. Use this until we have one.
  const daysAtLevel = cfg.updated_at
    ? Math.floor((Date.now() - new Date(cfg.updated_at).getTime()) / (1000 * 60 * 60 * 24))
    : null;

  const evidence: PromotionEvidence = {
    ticks_in_period: ticksInPeriod,
    by_outcome: byOutcome,
    approval_rate: approvalRate,
    proposals_approved: proposalsApproved,
    proposals_dismissed: proposalsDismissed,
    skills_count: skillsCount,
    skills_above_80pct: skillsAbove80,
    high_severity_lessons: highSeverityLessons,
    affirmation_net_score: affirmationNet,
    days_at_current_level: daysAtLevel,
  };

  // 8. Threshold logic per target level
  let recommended = false;
  let reason = '';
  if (next === 'L2') {
    // Needs to have actually been proposing things AND be getting approved.
    const enoughProposed = (byOutcome.proposed ?? 0) >= 5;
    const ratioOk = approvalRate !== null && approvalRate >= 0.8;
    const notTooManyDismissals = proposalsDismissed < 3;
    if (enoughProposed && ratioOk && notTooManyDismissals) {
      recommended = true;
      reason = `${cfg.agent_name} has proposed ${byOutcome.proposed} actions in ${windowDays} days, ${proposalsApproved} approved (${Math.round((approvalRate ?? 0) * 100)}%), ${proposalsDismissed} dismissed. Earned L2 (can act on low-risk actions without proposing).`;
    } else {
      const gaps: string[] = [];
      if (!enoughProposed) gaps.push(`needs ≥5 proposed actions (has ${byOutcome.proposed ?? 0})`);
      if (!ratioOk) gaps.push(`needs ≥80% approval rate (has ${approvalRate === null ? 'no data' : Math.round(approvalRate * 100) + '%'})`);
      if (!notTooManyDismissals) gaps.push(`too many dismissals (${proposalsDismissed} — limit is 3)`);
      reason = `Not yet eligible for L2: ${gaps.join('; ')}.`;
    }
  } else if (next === 'L3') {
    const enoughL2Activity = ticksInPeriod >= 15;
    const ratioOk = approvalRate !== null && approvalRate >= 0.9;
    const skillsOk = skillsAbove80 >= 3;
    if (enoughL2Activity && ratioOk && skillsOk) {
      recommended = true;
      reason = `${cfg.agent_name} has ${ticksInPeriod} ticks at L2 with ${Math.round((approvalRate ?? 0) * 100)}% approval and ${skillsAbove80} proven techniques (≥80% success). Earned L3 (can act on medium-risk actions, escalates only exceptions).`;
    } else {
      const gaps: string[] = [];
      if (!enoughL2Activity) gaps.push(`needs ≥15 ticks (has ${ticksInPeriod})`);
      if (!ratioOk) gaps.push(`needs ≥90% approval rate (has ${approvalRate === null ? 'no data' : Math.round(approvalRate * 100) + '%'})`);
      if (!skillsOk) gaps.push(`needs ≥3 proven techniques at ≥80% (has ${skillsAbove80})`);
      reason = `Not yet eligible for L3: ${gaps.join('; ')}.`;
    }
  } else if (next === 'L4') {
    const enoughTimeAtL3 = (daysAtLevel ?? 0) >= 45;
    const ratioOk = approvalRate !== null && approvalRate >= 0.95;
    const cleanRecord = highSeverityLessons === 0;
    const affirmedRecently = affirmationNet >= 1;
    if (enoughTimeAtL3 && ratioOk && cleanRecord && affirmedRecently) {
      recommended = true;
      reason = `${cfg.agent_name} has ${daysAtLevel} days at L3 with ${Math.round((approvalRate ?? 0) * 100)}% approval, zero high-severity corrections, and owner has affirmed their work recently. Earned L4 (full autonomy with audit-after).`;
    } else {
      const gaps: string[] = [];
      if (!enoughTimeAtL3) gaps.push(`needs ≥45 days at L3 (has ${daysAtLevel ?? 'unknown'})`);
      if (!ratioOk) gaps.push(`needs ≥95% approval rate (has ${approvalRate === null ? 'no data' : Math.round(approvalRate * 100) + '%'})`);
      if (!cleanRecord) gaps.push(`needs zero high-severity corrections (has ${highSeverityLessons})`);
      if (!affirmedRecently) gaps.push(`needs ≥1 owner affirmation in window (net score: ${affirmationNet})`);
      reason = `Not yet eligible for L4: ${gaps.join('; ')}.`;
    }
  }

  return {
    agent_name: cfg.agent_name,
    agent_role: cfg.agent_role,
    lane,
    current_autonomy: current,
    candidate_autonomy: next,
    recommended,
    reason,
    evidence,
  };
}

/**
 * Walk every active agent for a tenant, score each, return the ones
 * that crossed the threshold for promotion. Used by the cron.
 */
export async function scoreAllAgentsForPromotion(tenantPhone: string): Promise<PromotionCandidate[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  const agentsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/agent_configs?tenant_phone=eq.${cleanPhone}&status=neq.removed&select=agent_name`,
    { headers: headers() },
  );
  if (!agentsRes.ok) return [];
  const agents: Array<{ agent_name: string }> = await agentsRes.json();
  const results = await Promise.all(
    agents.map((a) => scoreAgentForPromotion(cleanPhone, a.agent_name).catch(() => null)),
  );
  return results.filter((r): r is PromotionCandidate => r !== null && r.recommended);
}

/**
 * Bump the agent's autonomy in agent_configs. Owner action (via the
 * approvals flow), not auto-promote.
 *
 * Idempotent on the (tenant, agent_name) tuple. Returns the new level
 * stored, or null if the write failed.
 */
export async function applyPromotion(
  tenantPhone: string,
  agentName: string,
  newAutonomy: Autonomy,
): Promise<Autonomy | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  try {
    // Load → merge → write so we preserve other config fields.
    const cfgRes = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_configs?tenant_phone=eq.${cleanPhone}&agent_name=ilike.${encodeURIComponent(agentName)}&limit=1&select=id,config`,
      { headers: headers() },
    );
    if (!cfgRes.ok) return null;
    const cfg = (await cfgRes.json())?.[0];
    if (!cfg) return null;
    const newConfig = { ...(cfg.config ?? {}), autonomy: newAutonomy };
    const upd = await fetch(`${SUPABASE_URL}/rest/v1/agent_configs?id=eq.${cfg.id}`, {
      method: 'PATCH',
      headers: { ...headers(), Prefer: 'return=minimal' },
      body: JSON.stringify({ config: newConfig, updated_at: new Date().toISOString() }),
    });
    return upd.ok ? newAutonomy : null;
  } catch (err) {
    console.warn('[applyPromotion] failed:', err);
    return null;
  }
}

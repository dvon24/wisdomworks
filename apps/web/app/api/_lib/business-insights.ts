/**
 * Business insights — pattern detection over tenant data, producing
 * actionable recommendations.
 *
 * Each detector takes the tenant context (client profiles, visits,
 * vertical) and returns zero or more insight rows. Detectors are
 * deduped by metadata.signature to avoid re-emitting the same insight
 * before the owner has acted on the previous one.
 *
 * Phase 1 ships: lapsed_clients.
 * Phase 2 candidates: gap_analysis (vacancy), seasonality,
 *   revenue_optimization, client_milestone.
 */

import { listClients, type ClientProfile } from './client-profiles';
import { enqueueNotification } from './notifications';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

export type InsightSeverity = 'critical' | 'high' | 'medium' | 'low';
export type InsightStatus = 'proposed' | 'approved' | 'dismissed' | 'executed' | 'expired';

export interface BusinessInsight {
  id: string;
  tenant_phone: string;
  detector: string;
  severity: InsightSeverity;
  title: string;
  why: string | null;
  recommended_action: string | null;
  expected_impact: string | null;
  confidence: number;
  payload: Record<string, any>;
  status: InsightStatus;
  detected_at: string;
  expires_at: string;
  metadata: Record<string, any>;
}

export interface InsightInput {
  tenantPhone: string;
  detector: string;
  severity: InsightSeverity;
  title: string;
  why?: string;
  recommendedAction?: string;
  expectedImpact?: string;
  confidence?: number;
  payload?: Record<string, any>;
  /** Stable string for dedup — same signature won't re-insert while previous is still open. */
  signature?: string;
}

/** Insert an insight and enqueue a notification for the digest. Exported
 *  so other detectors (e.g. classification-learning QA scan) can route
 *  their findings through the same BMAD innovation surface. */
export async function emitInsight(input: InsightInput): Promise<string | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const cleanPhone = input.tenantPhone.replace(/[\s\-+()]/g, '');
    // Insert with the partial unique index doing dedup. If signature
    // conflicts, PostgREST returns 409 — silently swallow that.
    const res = await fetch(`${SUPABASE_URL}/rest/v1/business_insights`, {
      method: 'POST',
      headers: { ...headers(), Prefer: 'return=representation,resolution=ignore-duplicates' },
      body: JSON.stringify({
        tenant_phone: cleanPhone,
        detector: input.detector,
        severity: input.severity,
        title: input.title.slice(0, 250),
        why: input.why ?? null,
        recommended_action: input.recommendedAction ?? null,
        expected_impact: input.expectedImpact ?? null,
        confidence: input.confidence ?? 0.7,
        payload: input.payload ?? {},
        metadata: input.signature ? { signature: input.signature } : {},
      }),
    });
    if (!res.ok) {
      if (res.status === 409) return null; // dup, skip
      console.warn('[insights] insert failed:', await res.text());
      return null;
    }
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) return null; // duplicate
    const insight = rows[0];

    // Surface in the digest queue too
    const notifBody = [
      input.why ? input.why : '',
      input.recommendedAction ? `Recommended: ${input.recommendedAction}` : '',
      input.expectedImpact ? `Impact: ${input.expectedImpact}` : '',
      `Confidence: ${Math.round((input.confidence ?? 0.7) * 100)}%`,
      '',
      `Reply "approve insight ${insight.id.slice(0, 8)}" or "dismiss insight ${insight.id.slice(0, 8)}".`,
    ].filter(Boolean).join('\n');

    const notifId = await enqueueNotification({
      tenantPhone: cleanPhone,
      kind: 'agent_observation',
      severity: input.severity,
      title: `💡 ${input.title}`,
      body: notifBody,
      sourceAgent: 'Insights',
      sourceId: insight.id,
      metadata: { insight_id: insight.id, detector: input.detector },
    });

    if (notifId) {
      await fetch(`${SUPABASE_URL}/rest/v1/business_insights?id=eq.${insight.id}`, {
        method: 'PATCH',
        headers: { ...headers(), Prefer: 'return=minimal' },
        body: JSON.stringify({ surfaced_in_notification_id: notifId }),
      });
    }

    // Fire outbound to Zapier/Make/etc. webhooks
    try {
      const { fireEvent } = await import('./event-webhooks');
      void fireEvent({
        tenantPhone: cleanPhone,
        eventType: 'insight_emitted',
        payload: {
          insight_id: insight.id,
          detector: input.detector,
          severity: input.severity,
          title: input.title,
          why: input.why,
          recommended_action: input.recommendedAction,
          expected_impact: input.expectedImpact,
          confidence: input.confidence ?? 0.7,
          payload: input.payload,
        },
      });
    } catch {}

    return insight.id;
  } catch (err) {
    console.warn('[insights] emit exception:', err);
    return null;
  }
}

// ─── Detector: lapsed_clients ─────────────────────────────────────────────
//
// Surfaces clients whose last visit is > 60 days ago. Caps at 8 candidates
// per cycle to keep the recommendation tractable. Higher value first
// (visit_count desc), and recency desc among ties so the freshest lapses
// land first.

const LAPSED_DAYS = 60;
const MAX_LAPSED_PER_INSIGHT = 8;

export async function detectLapsedClients(tenantPhone: string): Promise<{ emitted: number }> {
  const clients = await listClients(tenantPhone, 500);
  const now = Date.now();
  const lapsed = clients
    .filter((c) => c.last_visit_at && c.visit_count >= 1)
    .map((c) => ({
      c,
      daysSince: Math.floor((now - new Date(c.last_visit_at!).getTime()) / (1000 * 60 * 60 * 24)),
    }))
    .filter((x) => x.daysSince > LAPSED_DAYS)
    .sort((a, b) => (b.c.visit_count - a.c.visit_count) || (a.daysSince - b.daysSince))
    .slice(0, MAX_LAPSED_PER_INSIGHT);

  if (lapsed.length === 0) return { emitted: 0 };

  // Dedup by the set of client IDs — same lapsed set won't re-emit
  const sig = `lapsed:${lapsed.map((x) => x.c.id).sort().join(',')}`;
  const names = lapsed.slice(0, 5).map((x) => x.c.display_name).join(', ');
  const more = lapsed.length > 5 ? ` (+${lapsed.length - 5} more)` : '';

  const id = await emitInsight({
    tenantPhone,
    detector: 'lapsed_clients',
    severity: 'medium',
    title: `${lapsed.length} client${lapsed.length === 1 ? '' : 's'} haven't been in for ${LAPSED_DAYS}+ days`,
    why: `These clients used to be regular but haven't returned: ${names}${more}. Re-engagement is cheaper than acquisition; even one returning client typically pays back the outreach.`,
    recommendedAction: `Send a personalized "we miss you" message to each. I can draft them from each client's preferences and past visits — say "approve insight" to have me draft them and queue for your review.`,
    expectedImpact: `Industry average: 15-25% of contacted lapsed clients return within 30 days.`,
    confidence: 0.85,
    payload: {
      client_ids: lapsed.map((x) => x.c.id),
      client_names: lapsed.map((x) => x.c.display_name),
      days_since: lapsed.map((x) => x.daysSince),
    },
    signature: sig,
  });

  return { emitted: id ? 1 : 0 };
}

// ─── Public API ──────────────────────────────────────────────────────────

export async function listOpenInsights(tenantPhone: string, limit = 20): Promise<BusinessInsight[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/business_insights?tenant_phone=eq.${cleanPhone}&status=in.(proposed,approved)&order=severity.asc,detected_at.desc&limit=${limit}&select=*`,
      { headers: headers() },
    );
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export async function getInsightById(idPrefix: string, tenantPhone: string): Promise<BusinessInsight | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  try {
    // Accept either full UUID or 8-char prefix
    const isPrefix = idPrefix.length === 8;
    const filter = isPrefix
      ? `id=ilike.${encodeURIComponent(idPrefix.toLowerCase() + '%')}`
      : `id=eq.${idPrefix}`;
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/business_insights?${filter}&tenant_phone=eq.${cleanPhone}&select=*&limit=1`,
      { headers: headers() },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function setInsightStatus(insightId: string, status: InsightStatus): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false;
  try {
    const update: Record<string, any> = { status };
    if (status === 'approved') update.approved_at = new Date().toISOString();
    if (status === 'dismissed') update.dismissed_at = new Date().toISOString();
    if (status === 'executed') update.executed_at = new Date().toISOString();
    const res = await fetch(`${SUPABASE_URL}/rest/v1/business_insights?id=eq.${insightId}`, {
      method: 'PATCH',
      headers: { ...headers(), Prefer: 'return=minimal' },
      body: JSON.stringify(update),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Detector: inactive_recent ────────────────────────────────────────────
//
// Lighter-touch sibling of lapsed_clients: 3+ visits and no visit in 30 days
// but not yet at the 60-day lapsed threshold. Catches the "drifting away"
// signal before they fully lapse, when re-engagement is cheaper and more
// effective.

const INACTIVE_RECENT_MIN_VISITS = 3;
const INACTIVE_RECENT_DAYS_MIN = 30;
const INACTIVE_RECENT_DAYS_MAX = 60;

export async function detectInactiveRecent(tenantPhone: string): Promise<{ emitted: number }> {
  const clients = await listClients(tenantPhone, 500);
  const now = Date.now();
  const drifting = clients
    .filter((c) => c.last_visit_at && c.visit_count >= INACTIVE_RECENT_MIN_VISITS)
    .map((c) => ({
      c,
      daysSince: Math.floor((now - new Date(c.last_visit_at!).getTime()) / (1000 * 60 * 60 * 24)),
    }))
    .filter((x) => x.daysSince > INACTIVE_RECENT_DAYS_MIN && x.daysSince <= INACTIVE_RECENT_DAYS_MAX)
    .sort((a, b) => b.c.visit_count - a.c.visit_count)
    .slice(0, 6);

  if (drifting.length === 0) return { emitted: 0 };

  const sig = `inactive_recent:${drifting.map((x) => x.c.id).sort().join(',')}`;
  const names = drifting.slice(0, 5).map((x) => x.c.display_name).join(', ');

  const id = await emitInsight({
    tenantPhone,
    detector: 'inactive_recent',
    severity: 'low',
    title: `${drifting.length} regular${drifting.length === 1 ? '' : 's'} starting to drift`,
    why: `${names} have 3+ visits but haven't been back in 30-60 days. They're not lapsed yet — this is the sweet spot for a light-touch nudge before they fully disengage.`,
    recommendedAction: `Light-touch outreach: a check-in message or relevant offer. I can draft one — say "approve insight" to have me prepare drafts.`,
    expectedImpact: `Catching drift early is ~2x more effective than re-engagement at 60+ days.`,
    confidence: 0.75,
    payload: {
      client_ids: drifting.map((x) => x.c.id),
      client_names: drifting.map((x) => x.c.display_name),
      days_since: drifting.map((x) => x.daysSince),
    },
    signature: sig,
  });

  return { emitted: id ? 1 : 0 };
}

// ─── Detector: client_milestone ───────────────────────────────────────────
//
// Recognizes recurring visit milestones (5, 10, 25, 50, 100) and annual
// "anniversary" markers based on first_visit_at. Drives loyalty moments —
// thank-you message, small gift, anniversary acknowledgement.

const MILESTONE_VISITS = [5, 10, 25, 50, 100];

export async function detectClientMilestones(tenantPhone: string): Promise<{ emitted: number }> {
  const clients = await listClients(tenantPhone, 500);
  const now = Date.now();
  let emitted = 0;

  for (const c of clients) {
    if (!c.first_visit_at) continue;

    // Visit-count milestone — hit exactly today (the cron runs once daily so
    // we only trigger when the count actually equals a target on this scan)
    if (MILESTONE_VISITS.includes(c.visit_count)) {
      const sig = `visit_count:${c.id}:${c.visit_count}`;
      const id = await emitInsight({
        tenantPhone,
        detector: 'client_milestone',
        severity: 'low',
        title: `${c.display_name} just hit ${c.visit_count} visits`,
        why: `Loyalty moments matter — clients who feel seen come back. ${c.visit_count} visits is a real commitment to your business.`,
        recommendedAction: `Send a personal thank-you. I can draft one based on their preferences — say "approve insight" for me to prepare it.`,
        expectedImpact: `Milestone acknowledgements correlate with ~20-30% higher next-90-day retention.`,
        confidence: 0.9,
        payload: {
          client_id: c.id,
          client_name: c.display_name,
          milestone_type: 'visit_count',
          milestone_value: c.visit_count,
        },
        signature: sig,
      });
      if (id) emitted++;
    }

    // Anniversary — first_visit_at exactly N years ago (within today's
    // window). Only check first 5 years to avoid noise.
    const firstVisit = new Date(c.first_visit_at);
    const yearsSince = Math.floor((now - firstVisit.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
    if (yearsSince >= 1 && yearsSince <= 5) {
      const anniversaryThisYear = new Date(firstVisit);
      anniversaryThisYear.setFullYear(firstVisit.getFullYear() + yearsSince);
      const daysFromAnniversary = Math.abs(
        Math.floor((now - anniversaryThisYear.getTime()) / (24 * 60 * 60 * 1000)),
      );
      if (daysFromAnniversary <= 1) {
        const sig = `anniversary:${c.id}:${yearsSince}`;
        const id = await emitInsight({
          tenantPhone,
          detector: 'client_milestone',
          severity: 'low',
          title: `${c.display_name} — ${yearsSince}yr anniversary as a client`,
          why: `${c.display_name} first came in ${yearsSince} year${yearsSince === 1 ? '' : 's'} ago today. Long-term clients are your real moat — these moments stick.`,
          recommendedAction: `Send an anniversary note. I can draft one personalized to their history.`,
          expectedImpact: `Anniversary acknowledgements lift annual retention noticeably; under-used by most service businesses.`,
          confidence: 0.85,
          payload: {
            client_id: c.id,
            client_name: c.display_name,
            milestone_type: 'anniversary',
            milestone_value: yearsSince,
          },
          signature: sig,
        });
        if (id) emitted++;
      }
    }
  }

  return { emitted };
}

// ─── Detector: vip_suggestion ─────────────────────────────────────────────
//
// Top clients by visit_count who aren't tagged VIP yet — propose tagging
// them so future workflows (priority booking, special rates) can use the
// tag. One-shot per cohort.

const VIP_MIN_VISITS = 5;
const VIP_SUGGEST_TOP_N = 5;

export async function detectVipSuggestions(tenantPhone: string): Promise<{ emitted: number }> {
  const clients = await listClients(tenantPhone, 500);
  const candidates = clients
    .filter((c) => c.visit_count >= VIP_MIN_VISITS && !(c.tags ?? []).includes('VIP'))
    .sort((a, b) => b.visit_count - a.visit_count)
    .slice(0, VIP_SUGGEST_TOP_N);

  if (candidates.length === 0) return { emitted: 0 };

  const sig = `vip_suggestion:${candidates.map((c) => c.id).sort().join(',')}`;
  const names = candidates.map((c) => `${c.display_name} (${c.visit_count} visits)`).join(', ');

  const id = await emitInsight({
    tenantPhone,
    detector: 'vip_suggestion',
    severity: 'low',
    title: `${candidates.length} top client${candidates.length === 1 ? '' : 's'} not tagged VIP yet`,
    why: `${names} are your most-visited clients with ${VIP_MIN_VISITS}+ visits each. Tagging them VIP unlocks the priority workflows (special offers, priority booking, recognition).`,
    recommendedAction: `Tag them as VIP so the team treats them accordingly going forward. I'll handle the tagging — say "approve insight".`,
    expectedImpact: `Helps the team consistently recognize and prioritize repeat customers.`,
    confidence: 0.9,
    payload: {
      client_ids: candidates.map((c) => c.id),
      client_names: candidates.map((c) => c.display_name),
      visit_counts: candidates.map((c) => c.visit_count),
    },
    signature: sig,
  });

  return { emitted: id ? 1 : 0 };
}

/** Run all detectors for one tenant. Called by the daily insights cron. */
export async function runDetectors(tenantPhone: string): Promise<{ emitted: number; detectors: number }> {
  const results = await Promise.all([
    detectLapsedClients(tenantPhone),
    detectInactiveRecent(tenantPhone),
    detectClientMilestones(tenantPhone),
    detectVipSuggestions(tenantPhone),
    // Phase 3 candidates (need more data):
    // detectGapAnalysis(tenantPhone) — calendar vacancy
    // detectSeasonality(tenantPhone) — needs 12+ weeks of visit data
    // detectRevenueOptimization(tenantPhone) — needs revenue capture
  ]);
  return {
    emitted: results.reduce((s, r) => s + r.emitted, 0),
    detectors: results.length,
  };
}

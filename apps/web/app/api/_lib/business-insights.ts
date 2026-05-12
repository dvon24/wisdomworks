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

interface InsightInput {
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

/** Insert an insight and enqueue a notification for the digest. */
async function emitInsight(input: InsightInput): Promise<string | null> {
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

/** Run all detectors for one tenant. Called by the daily insights cron. */
export async function runDetectors(tenantPhone: string): Promise<{ emitted: number; detectors: number }> {
  const results = await Promise.all([
    detectLapsedClients(tenantPhone),
    // Add new detectors here:
    // detectGapAnalysis(tenantPhone),
    // detectSeasonality(tenantPhone),
  ]);
  return {
    emitted: results.reduce((s, r) => s + r.emitted, 0),
    detectors: results.length,
  };
}

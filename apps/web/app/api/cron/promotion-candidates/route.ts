/**
 * Package 3 — weekly promotion-candidate cron.
 *
 * For each tenant: score every active agent, find promotion candidates
 * (agents that crossed the threshold for the next autonomy level), emit
 * a business_insight per recommended promotion so it shows up in the
 * owner's approvals tab with the evidence packet attached.
 *
 * Recommended cadence: once per week (Mondays). Idempotent — the
 * emitInsight signature dedups proposals for the same agent+target-level
 * while one is still open, so re-running mid-week doesn't spam.
 *
 * Default mode: Option 2 (recommend + approve). The candidate is
 * surfaced as an insight the owner explicitly approves. Auto-promote
 * mode (Option 3) is gated behind tenant_email_indexing_prefs-style
 * opt-in we don't ship yet.
 */

import { NextResponse } from 'next/server';
import { scoreAllAgentsForPromotion } from '../../_lib/promotion-candidates';
import { emitInsight } from '../../_lib/business-insights';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const ownerToken = process.env.OWNER_API_TOKEN;
  const auth = request.headers.get('authorization');
  if (cronSecret || ownerToken) {
    const validCron = cronSecret && auth === `Bearer ${cronSecret}`;
    const validOwner = ownerToken && auth === `Bearer ${ownerToken}`;
    if (!validCron && !validOwner) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  } else {
    console.warn('[promotion-candidates] WARNING: neither CRON_SECRET nor OWNER_API_TOKEN set.');
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  try {
    const tenantsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/whatsapp_contexts?select=phone_number`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
    );
    const tenants: { phone_number: string }[] = tenantsRes.ok ? await tenantsRes.json() : [];

    const startedAt = Date.now();
    const HARD_DEADLINE_MS = 100_000;

    let evaluated = 0;
    let candidatesFound = 0;
    let insightsEmitted = 0;
    const tenantDetails: Array<{ tenant: string; candidates: number; emitted: number }> = [];

    for (const t of tenants) {
      if (Date.now() - startedAt > HARD_DEADLINE_MS) {
        console.warn(`[promotion-candidates] deadline reached; deferring remaining tenants`);
        break;
      }
      try {
        const candidates = await scoreAllAgentsForPromotion(t.phone_number);
        evaluated++;
        candidatesFound += candidates.length;
        let emitted = 0;
        for (const c of candidates) {
          // Dedup signature: same agent + target level only emits once
          // while a prior insight is still open. When owner approves
          // or dismisses, the insight closes and re-eval is allowed.
          const insightId = await emitInsight({
            tenantPhone: t.phone_number,
            detector: 'promotion_candidate',
            severity: 'low',
            title: `${c.agent_name} earned ${c.candidate_autonomy} — review`,
            why: c.reason,
            recommendedAction: `Promote ${c.agent_name} from ${c.current_autonomy} → ${c.candidate_autonomy}. Open the agent's SOP (or use the show_agent_sop tool) to review the evidence before approving.`,
            expectedImpact: c.candidate_autonomy === 'L2'
              ? `${c.agent_name} will act on low-risk actions without proposing them for approval first. You'll see results in the activity feed instead of the approvals tab.`
              : c.candidate_autonomy === 'L3'
                ? `${c.agent_name} will act on medium-risk actions and escalate only exceptions. Most of their work stops needing your input.`
                : `${c.agent_name} will act with full autonomy and report results afterward. Reserved for agents with a long clean track record.`,
            confidence: 0.85,
            payload: {
              agent_name: c.agent_name,
              agent_role: c.agent_role,
              lane: c.lane,
              current_autonomy: c.current_autonomy,
              candidate_autonomy: c.candidate_autonomy,
              evidence: c.evidence,
            },
            signature: `promotion.${c.agent_name.toLowerCase()}.${c.candidate_autonomy}`,
          });
          if (insightId) {
            emitted++;
            insightsEmitted++;
          }
        }
        tenantDetails.push({ tenant: t.phone_number, candidates: candidates.length, emitted });
      } catch (err) {
        console.warn(`[promotion-candidates] tenant ${t.phone_number} failed:`, err);
      }
    }

    console.log(
      `[promotion-candidates] tenants=${tenants.length} evaluated=${evaluated} candidates=${candidatesFound} emitted=${insightsEmitted}`,
    );

    return NextResponse.json({
      ok: true,
      tenants: tenants.length,
      evaluated,
      candidates_found: candidatesFound,
      insights_emitted: insightsEmitted,
      details: tenantDetails,
    });
  } catch (err) {
    console.error('[promotion-candidates] error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

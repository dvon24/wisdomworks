/**
 * Per-tenant daily LLM spend cap — the cost circuit breaker (SPEC CAP-6,
 * see _bmad-output/specs/spec-tiered-audit-autonomy).
 *
 * chat_runs is the single source of total spend: recordChatRun AND
 * recordLlmCall (worker / Axis / email-sift sub-calls) both write there, so
 * summing cost_usd since midnight UTC gives the tenant's true daily spend.
 *
 * When a tenant crosses the cap, callers DEGRADE expensive/optional work
 * (delegation, research + other heavy tools, proactive crons, and the future
 * Tier-2 Opus audit) but NEVER hard-block the owner's direct reply. Base
 * replies are bounded by message volume anyway; the cap exists to stop the
 * BALLOON-able operations (delegation loops, research, crons) from a runaway
 * day — the "never a $3000 month" guarantee.
 *
 * Fail-OPEN: any query failure or missing config treats the tenant as under
 * cap. Better to let a turn through than to block Iris on an infra hiccup.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Default $5/tenant/day — grounded in real chat_runs (busiest observed day was
// $2.67; ~2× headroom; ~$150/mo ceiling on balloon-able ops). Tunable without
// a deploy via the DAILY_SPEND_CAP_USD env var.
const DEFAULT_CAP_USD = 5;

function resolveCapUsd(): number {
  const env = Number(process.env.DAILY_SPEND_CAP_USD);
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_CAP_USD;
}

export interface SpendStatus {
  spentUsd: number;
  capUsd: number;
  over: boolean;
}

// 60s in-memory cache so we don't query chat_runs on every turn / tool call.
const cache = new Map<string, { status: SpendStatus; at: number }>();
const CACHE_MS = 60_000;

/** Today's (since midnight UTC) total LLM spend for a tenant vs the cap. */
export async function getDailySpend(tenantPhone: string): Promise<SpendStatus> {
  const capUsd = resolveCapUsd();
  if (!SUPABASE_URL || !SUPABASE_KEY) return { spentUsd: 0, capUsd, over: false };
  const clean = tenantPhone.replace(/[\s\-+()]/g, '');
  const now = Date.now();
  const cached = cache.get(clean);
  if (cached && now - cached.at < CACHE_MS) return cached.status;

  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);

  let spentUsd = 0;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/chat_runs?tenant_phone=eq.${clean}&started_at=gte.${dayStart.toISOString()}&select=cost_usd`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
    );
    if (!res.ok) {
      console.warn(`[spend-cap] chat_runs query ${res.status} — treating as under cap`);
      return { spentUsd: 0, capUsd, over: false };
    }
    const rows: Array<{ cost_usd: number | string | null }> = await res.json();
    spentUsd = rows.reduce((sum, r) => sum + (Number(r.cost_usd) || 0), 0);
  } catch (err) {
    console.warn('[spend-cap] daily spend query failed (treating as under cap):', err);
    return { spentUsd: 0, capUsd, over: false };
  }

  // 2026-06-03: agent ticks log to agent_runs (tokens only, NO cost_usd) and
  // never hit chat_runs — so the cap was blind to the LARGEST background cost
  // surface (the bug Devon hit: real spend ~$5-13/day, cap saw only ~$2/day of
  // chat). Add agent_runs spend, derived from tokens. chat_runs and agent_runs
  // are DISJOINT sources, so summing both does NOT double-count. Input is
  // treated as uncached (a slight OVER-estimate) — the safe direction for a cap.
  try {
    const arRes = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_runs?tenant_phone=eq.${clean}&started_at=gte.${dayStart.toISOString()}&select=tokens_in,tokens_out,model_used`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
    );
    if (arRes.ok) {
      const { estimateLlmCost } = await import('./chat-cost-tracker');
      const arRows: Array<{ tokens_in: number | null; tokens_out: number | null; model_used: string | null }> = await arRes.json();
      for (const r of arRows) {
        spentUsd += estimateLlmCost({
          model: r.model_used ?? 'claude-sonnet-4-6',
          uncachedIn: Number(r.tokens_in) || 0,
          tokensOut: Number(r.tokens_out) || 0,
        });
      }
    }
  } catch (err) {
    console.warn('[spend-cap] agent_runs spend query failed (chat_runs still counted):', err);
  }

  const status: SpendStatus = { spentUsd, capUsd, over: spentUsd >= capUsd };
  cache.set(clean, { status, at: now });
  return status;
}

/** Convenience: is this tenant over today's spend cap? Fail-open. */
export async function isOverDailyCap(tenantPhone: string): Promise<boolean> {
  return (await getDailySpend(tenantPhone)).over;
}

/** Tools deferred when a tenant is over the daily cap — the balloon-able ones.
 *  Cheap read/memory tools (recall_*, list_*, get_*) stay available so Iris can
 *  still answer from what she knows. */
export const EXPENSIVE_TOOLS_DEFERRED_WHEN_CAPPED = new Set<string>([
  'request_research',
  'web_search',
  'read_url',
  'analyze_website',
  'generate_website',
  'create_document',
  'delegate_to_agent',
  'dispatch_to_agents',
  'consult_manager',
]);

/**
 * Usage tracker — sums token costs per tenant across all sources.
 *
 * Sources today:
 *   - agent_runs (every tick logs tokens_in + tokens_out + model_used)
 *   - WhatsApp Iris brain (logs to console only — TODO: persist to a table
 *     so we can include it; for now estimated separately)
 *
 * Pricing per 1M tokens — keep in sync with Anthropic published rates.
 * Cached for 5 min so dashboard hits are cheap.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

interface ModelPrice {
  inPerMillion: number;
  outPerMillion: number;
  cachedInPerMillion: number;
}

const MODEL_PRICES: Record<string, ModelPrice> = {
  // Anthropic published rates as of mid-2025
  'claude-opus-4-20250514': { inPerMillion: 15, outPerMillion: 75, cachedInPerMillion: 1.5 },
  'claude-sonnet-4-20250514': { inPerMillion: 3, outPerMillion: 15, cachedInPerMillion: 0.3 },
  'claude-haiku-4-5-20251001': { inPerMillion: 0.25, outPerMillion: 1.25, cachedInPerMillion: 0.025 },
};

const FALLBACK_PRICE: ModelPrice = { inPerMillion: 3, outPerMillion: 15, cachedInPerMillion: 0.3 };

function priceFor(model: string): ModelPrice {
  if (!model) return FALLBACK_PRICE;
  if (MODEL_PRICES[model]) return MODEL_PRICES[model];
  if (/opus/i.test(model)) return MODEL_PRICES['claude-opus-4-20250514']!;
  if (/haiku/i.test(model)) return MODEL_PRICES['claude-haiku-4-5-20251001']!;
  return FALLBACK_PRICE;
}

export interface UsagePeriod {
  periodStart: string;
  periodEnd: string;
  totals: {
    tokensIn: number;
    tokensOut: number;
    runs: number;
    estimatedCostUsd: number;
  };
  byModel: Record<string, { tokensIn: number; tokensOut: number; costUsd: number }>;
  byAgent: Record<string, { runs: number; tokensIn: number; tokensOut: number; costUsd: number }>;
}

/**
 * Compute usage for the current calendar month.
 * Aggregates from agent_runs only today.
 */
export async function computeMonthlyUsage(tenantPhone: string): Promise<UsagePeriod | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();

  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/agent_runs?tenant_phone=eq.${cleanPhone}&started_at=gte.${periodStart}&started_at=lt.${periodEnd}&select=tokens_in,tokens_out,model_used,agent_instance_id`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
  );
  if (!res.ok) return null;
  const rows: any[] = await res.json();

  const period: UsagePeriod = {
    periodStart,
    periodEnd,
    totals: { tokensIn: 0, tokensOut: 0, runs: 0, estimatedCostUsd: 0 },
    byModel: {},
    byAgent: {},
  };

  for (const r of rows) {
    const tIn = r.tokens_in ?? 0;
    const tOut = r.tokens_out ?? 0;
    const model = r.model_used ?? 'unknown';
    const price = priceFor(model);
    const cost = (tIn * price.inPerMillion + tOut * price.outPerMillion) / 1_000_000;

    period.totals.runs++;
    period.totals.tokensIn += tIn;
    period.totals.tokensOut += tOut;
    period.totals.estimatedCostUsd += cost;

    const m = period.byModel[model] ?? { tokensIn: 0, tokensOut: 0, costUsd: 0 };
    m.tokensIn += tIn;
    m.tokensOut += tOut;
    m.costUsd += cost;
    period.byModel[model] = m;

    const agentKey = r.agent_instance_id ?? 'unknown';
    const a = period.byAgent[agentKey] ?? { runs: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 };
    a.runs++;
    a.tokensIn += tIn;
    a.tokensOut += tOut;
    a.costUsd += cost;
    period.byAgent[agentKey] = a;
  }

  // Round display values
  period.totals.estimatedCostUsd = Number(period.totals.estimatedCostUsd.toFixed(4));
  for (const k of Object.keys(period.byModel)) {
    period.byModel[k]!.costUsd = Number(period.byModel[k]!.costUsd.toFixed(4));
  }
  for (const k of Object.keys(period.byAgent)) {
    period.byAgent[k]!.costUsd = Number(period.byAgent[k]!.costUsd.toFixed(4));
  }
  return period;
}

/**
 * Soft cap = 80% of monthly budget; hard cap = 100%.
 * Returns the cap status the deck/runtime should respect.
 */
export interface BudgetStatus {
  monthlyBudgetUsd: number;
  usedUsd: number;
  pctUsed: number;
  status: 'ok' | 'warning' | 'exceeded';
  estimatedDailyBurn: number;
  daysToExhaustion: number | null;
}

export function evaluateBudget(usage: UsagePeriod, monthlyBudgetUsd: number): BudgetStatus {
  const pctUsed = monthlyBudgetUsd > 0 ? usage.totals.estimatedCostUsd / monthlyBudgetUsd : 0;
  const periodStart = new Date(usage.periodStart);
  const daysElapsed = Math.max(1, (Date.now() - periodStart.getTime()) / (1000 * 60 * 60 * 24));
  const dailyBurn = usage.totals.estimatedCostUsd / daysElapsed;
  const remainingBudget = monthlyBudgetUsd - usage.totals.estimatedCostUsd;
  const daysToExhaustion = dailyBurn > 0 ? Math.max(0, remainingBudget / dailyBurn) : null;

  return {
    monthlyBudgetUsd,
    usedUsd: usage.totals.estimatedCostUsd,
    pctUsed: Number((pctUsed * 100).toFixed(1)),
    status: pctUsed >= 1 ? 'exceeded' : pctUsed >= 0.8 ? 'warning' : 'ok',
    estimatedDailyBurn: Number(dailyBurn.toFixed(4)),
    daysToExhaustion: daysToExhaustion !== null ? Number(daysToExhaustion.toFixed(1)) : null,
  };
}

/**
 * Hard cap enforcement — when budget is exceeded, pause all running agents
 * for the tenant. Idempotent; called from the tick cron and the manual tick
 * endpoint.
 */
export async function enforceBudgetCap(tenantPhone: string, budget: BudgetStatus): Promise<{ pausedCount: number }> {
  if (budget.status !== 'exceeded') return { pausedCount: 0 };
  if (!SUPABASE_URL || !SUPABASE_KEY) return { pausedCount: 0 };
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/agent_instances?tenant_phone=eq.${cleanPhone}&status=eq.running`,
    {
      method: 'PATCH',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({ status: 'paused' }),
    },
  );
  if (!res.ok) return { pausedCount: 0 };
  const rows = await res.json();
  console.log(`[usage] Budget exceeded for ${cleanPhone} — paused ${rows.length} agents`);
  return { pausedCount: rows.length };
}

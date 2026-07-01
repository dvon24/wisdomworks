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

// CONSERVATIVE canonical $/M-token prices, kept in sync with chat-cost-tracker.ts
// PRICING (TODO: consolidate both into model-registry.ts so they can't drift again).
// Aligned 2026-06-03: this table previously had STALE Haiku ($0.25/$1.25 — that's
// Haiku 3) and Opus-4.7 ($5/$25) values disagreeing ~4x/3x with chat-cost-tracker,
// and NEITHER table listed the LIVE Opus 4.8 → Opus undercounted ~5x. Confirm Haiku
// 4.5 + Opus 4.8 against the actual Anthropic invoice.
const MODEL_PRICES: Record<string, ModelPrice> = {
  'claude-opus-4-8': { inPerMillion: 15, outPerMillion: 75, cachedInPerMillion: 1.5 },
  'claude-opus-4-7': { inPerMillion: 15, outPerMillion: 75, cachedInPerMillion: 1.5 },
  // Sonnet 5 (Iris's brain, 2026-07) — same $3/$15 as Sonnet 4.6.
  'claude-sonnet-5': { inPerMillion: 3, outPerMillion: 15, cachedInPerMillion: 0.3 },
  'claude-sonnet-4-6': { inPerMillion: 3, outPerMillion: 15, cachedInPerMillion: 0.3 },
  'claude-haiku-4-5-20251001': { inPerMillion: 1, outPerMillion: 5, cachedInPerMillion: 0.1 },
  'claude-haiku-4-5': { inPerMillion: 1, outPerMillion: 5, cachedInPerMillion: 0.1 },
  // Previous generation — kept for historical chat_runs rows that reference these IDs.
  'claude-opus-4-20250514': { inPerMillion: 15, outPerMillion: 75, cachedInPerMillion: 1.5 },
  'claude-sonnet-4-20250514': { inPerMillion: 3, outPerMillion: 15, cachedInPerMillion: 0.3 },
};

const FALLBACK_PRICE: ModelPrice = { inPerMillion: 3, outPerMillion: 15, cachedInPerMillion: 0.3 };

function priceFor(model: string): ModelPrice {
  if (!model) return FALLBACK_PRICE;
  if (MODEL_PRICES[model]) return MODEL_PRICES[model];
  if (/opus/i.test(model)) return MODEL_PRICES['claude-opus-4-8']!;
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
  /** Cost rolled up by category — what the customer sees on the deck. */
  byCategory: {
    chat: { runs: number; costUsd: number };
    agents: { runs: number; costUsd: number };
    research: { runs: number; costUsd: number };
  };
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
  const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
  const [runsRes, chatRes] = await Promise.all([
    fetch(
      `${SUPABASE_URL}/rest/v1/agent_runs?tenant_phone=eq.${cleanPhone}&started_at=gte.${periodStart}&started_at=lt.${periodEnd}&select=tokens_in,tokens_out,model_used,agent_instance_id`,
      { headers },
    ),
    fetch(
      `${SUPABASE_URL}/rest/v1/chat_runs?tenant_phone=eq.${cleanPhone}&started_at=gte.${periodStart}&started_at=lt.${periodEnd}&select=tokens_in,tokens_out,cached_tokens_in,model_used,cost_usd,surface`,
      { headers },
    ),
  ]);
  if (!runsRes.ok) return null;
  const rows: any[] = await runsRes.json();
  const chatRows: any[] = chatRes.ok ? await chatRes.json() : [];

  const period: UsagePeriod = {
    periodStart,
    periodEnd,
    totals: { tokensIn: 0, tokensOut: 0, runs: 0, estimatedCostUsd: 0 },
    byModel: {},
    byAgent: {},
    byCategory: {
      chat: { runs: 0, costUsd: 0 },
      agents: { runs: 0, costUsd: 0 },
      research: { runs: 0, costUsd: 0 },
    },
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
    period.byCategory.agents.runs++;
    period.byCategory.agents.costUsd += cost;

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

  // Roll in chat_runs (iris-brain). Cost is already pre-computed at insert
  // time using the chat-cost-tracker's rate table, so trust it as-is.
  for (const r of chatRows) {
    const tIn = r.tokens_in ?? 0;
    const tOut = r.tokens_out ?? 0;
    const cost = Number(r.cost_usd ?? 0);
    const model = r.model_used ?? 'unknown';

    period.totals.runs++;
    period.totals.tokensIn += tIn;
    period.totals.tokensOut += tOut;
    period.totals.estimatedCostUsd += cost;
    period.byCategory.chat.runs++;
    period.byCategory.chat.costUsd += cost;

    const m = period.byModel[model] ?? { tokensIn: 0, tokensOut: 0, costUsd: 0 };
    m.tokensIn += tIn;
    m.tokensOut += tOut;
    m.costUsd += cost;
    period.byModel[model] = m;

    const chatKey = `chat:${r.surface ?? 'whatsapp'}`;
    const a = period.byAgent[chatKey] ?? { runs: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 };
    a.runs++;
    a.tokensIn += tIn;
    a.tokensOut += tOut;
    a.costUsd += cost;
    period.byAgent[chatKey] = a;
  }

  // Round display values
  period.totals.estimatedCostUsd = Number(period.totals.estimatedCostUsd.toFixed(4));
  for (const k of Object.keys(period.byModel)) {
    period.byModel[k]!.costUsd = Number(period.byModel[k]!.costUsd.toFixed(4));
  }
  for (const k of Object.keys(period.byAgent)) {
    period.byAgent[k]!.costUsd = Number(period.byAgent[k]!.costUsd.toFixed(4));
  }
  period.byCategory.chat.costUsd = Number(period.byCategory.chat.costUsd.toFixed(4));
  period.byCategory.agents.costUsd = Number(period.byCategory.agents.costUsd.toFixed(4));
  period.byCategory.research.costUsd = Number(period.byCategory.research.costUsd.toFixed(4));
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

/**
 * Emit an overage_events row for the difference between actual usage and
 * the included monthly budget — but only once per calendar month per
 * tenant (idempotent by period_start). The Stripe usage_records push is
 * a separate concern handled by the metered-billing cron, which reads
 * unreported rows from this table.
 */
export async function recordOverageIfExceeded(
  tenantPhone: string,
  usage: UsagePeriod,
  budget: BudgetStatus,
): Promise<void> {
  if (budget.status !== 'exceeded') return;
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  const amountOver = Math.max(0, usage.totals.estimatedCostUsd - budget.monthlyBudgetUsd);
  if (amountOver <= 0) return;

  try {
    // Check if an event already exists for this period
    const existingRes = await fetch(
      `${SUPABASE_URL}/rest/v1/overage_events?tenant_phone=eq.${cleanPhone}&period_start=eq.${encodeURIComponent(usage.periodStart)}&select=id,amount_usd`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
    );
    const existing = existingRes.ok ? await existingRes.json() : [];

    if (existing.length === 0) {
      // First overage of the period — insert.
      await fetch(`${SUPABASE_URL}/rest/v1/overage_events`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          tenant_phone: cleanPhone,
          period_start: usage.periodStart,
          period_end: usage.periodEnd,
          category: 'ai',
          amount_usd: amountOver,
          metadata: { budget_usd: budget.monthlyBudgetUsd, used_usd: usage.totals.estimatedCostUsd },
        }),
      });
    } else if (Number(existing[0].amount_usd) < amountOver) {
      // Overage has grown — update.
      await fetch(
        `${SUPABASE_URL}/rest/v1/overage_events?id=eq.${existing[0].id}&reported_to_stripe=eq.false`,
        {
          method: 'PATCH',
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({
            amount_usd: amountOver,
            metadata: { budget_usd: budget.monthlyBudgetUsd, used_usd: usage.totals.estimatedCostUsd },
          }),
        },
      );
    }
  } catch (err) {
    console.warn('[usage] overage event write failed:', err);
  }
}

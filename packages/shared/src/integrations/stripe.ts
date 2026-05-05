/**
 * Stripe customer integration — agent sees the customer's actual revenue/subscriptions.
 *
 * NOTE: This is for customers who use Stripe in THEIR business (e.g., a SaaS
 * customer who wants their finance agent to monitor MRR). It's separate from
 * the Stripe instance we use for billing them.
 *
 * Customer pastes a Stripe Restricted API Key with read permissions during
 * onboarding (or we provide an OAuth flow later via Stripe Connect).
 *
 * Docs: https://stripe.com/docs/api
 */

import type { IntegrationContext, IntegrationResult } from './types';

const STRIPE_API = 'https://api.stripe.com/v1';

export interface StripeCustomerSummary {
  totalCustomers: number;
  activeSubscriptions: number;
  trialSubscriptions: number;
  monthlyRecurringRevenue: number; // in cents
  failedPaymentsLast30d: number;
  recentSubscriptions: Array<{
    id: string;
    customerEmail: string;
    plan: string;
    amount: number;
    status: string;
    createdAt: string;
  }>;
  currency: string;
}

async function stripeGet(token: string, path: string, params?: Record<string, string>): Promise<any> {
  const url = new URL(`${STRIPE_API}${path}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

/**
 * Fetch a summary of the customer's Stripe account — MRR, active subs, etc.
 * Agent uses this to answer "how's revenue?" or surface "3 failed payments this week".
 */
export async function getAccountSummary(
  ctx: IntegrationContext,
): Promise<IntegrationResult<StripeCustomerSummary>> {
  try {
    // Fetch in parallel: customers, subscriptions, recent failed charges
    const [subsData, customersData, chargesData] = await Promise.all([
      stripeGet(ctx.accessToken, '/subscriptions', { limit: '100', status: 'all' }),
      stripeGet(ctx.accessToken, '/customers', { limit: '1' }),
      stripeGet(ctx.accessToken, '/charges', {
        limit: '100',
        'created[gte]': String(Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000)),
      }),
    ]);

    if (subsData.error || customersData.error) {
      return {
        success: false,
        error: subsData.error?.message ?? customersData.error?.message ?? 'Stripe API error',
      };
    }

    const subs = subsData.data ?? [];
    const active = subs.filter((s: any) => s.status === 'active');
    const trialing = subs.filter((s: any) => s.status === 'trialing');
    const totalCustomers = customersData.total_count ?? customersData.data?.length ?? 0;
    const failedPayments = (chargesData.data ?? []).filter((c: any) => c.status === 'failed').length;

    // Calculate MRR from active subscriptions
    let mrr = 0;
    let currency = 'usd';
    for (const sub of active) {
      const item = sub.items?.data?.[0];
      if (!item?.price) continue;
      const amount = item.price.unit_amount ?? 0;
      const interval = item.price.recurring?.interval ?? 'month';
      const intervalCount = item.price.recurring?.interval_count ?? 1;
      currency = item.price.currency ?? currency;

      // Normalize to monthly
      let monthly = amount;
      if (interval === 'year') monthly = amount / 12;
      else if (interval === 'week') monthly = amount * 4.33;
      else if (interval === 'day') monthly = amount * 30;
      monthly = monthly / intervalCount;

      mrr += monthly * (sub.quantity ?? 1);
    }

    // Recent subscriptions (most recent 10)
    const recentSubscriptions = subs
      .slice()
      .sort((a: any, b: any) => b.created - a.created)
      .slice(0, 10)
      .map((s: any) => ({
        id: s.id,
        customerEmail: s.customer_email ?? '(unknown)',
        plan: s.items?.data?.[0]?.price?.nickname ?? s.items?.data?.[0]?.price?.id ?? '(unnamed plan)',
        amount: s.items?.data?.[0]?.price?.unit_amount ?? 0,
        status: s.status,
        createdAt: new Date(s.created * 1000).toISOString(),
      }));

    return {
      success: true,
      data: {
        totalCustomers,
        activeSubscriptions: active.length,
        trialSubscriptions: trialing.length,
        monthlyRecurringRevenue: Math.round(mrr),
        failedPaymentsLast30d: failedPayments,
        recentSubscriptions,
        currency,
      },
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Get a specific customer by email — useful when client texts in and the agent
 * needs to look them up.
 */
export async function findCustomerByEmail(
  ctx: IntegrationContext,
  email: string,
): Promise<IntegrationResult<any>> {
  try {
    const data = await stripeGet(ctx.accessToken, '/customers', { email, limit: '1' });
    if (data.error) return { success: false, error: data.error.message };
    return { success: true, data: data.data?.[0] ?? null };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

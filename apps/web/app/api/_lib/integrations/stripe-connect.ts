/**
 * Stripe Connect adapter.
 *
 * https://stripe.com/docs/connect/standard-accounts
 *
 * "Standard" Connect lets each tenant own a full Stripe account that's
 * linked to ours. Owner clicks "Connect Stripe" → standard OAuth flow
 * via Stripe → we get an access_token + stripe_user_id (their Stripe
 * account id). We can then call the Stripe API on their behalf with
 * Stripe-Account header.
 *
 * Strategic value (per the party discussion): once tenants run payments
 * through our connection, we become the system of record for revenue,
 * not just operations. Future: take a 1% platform fee on bookings to
 * fund continued integration build.
 */

import { encryptToken } from '@wisdomworks/shared';

const STRIPE_API_BASE = 'https://api.stripe.com/v1';
const STRIPE_OAUTH_AUTHORIZE = 'https://connect.stripe.com/oauth/authorize';
const STRIPE_OAUTH_TOKEN = 'https://connect.stripe.com/oauth/token';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export interface StripeTokenResponse {
  access_token: string;
  refresh_token?: string;
  stripe_user_id: string;
  scope?: string;
  token_type?: string;
  stripe_publishable_key?: string;
  livemode?: boolean;
}

/** Build the OAuth authorize URL with the tenant phone signed into state. */
export function buildStripeAuthorizeUrl(state: string): string {
  const clientId = process.env.STRIPE_CLIENT_ID;
  if (!clientId) throw new Error('STRIPE_CLIENT_ID not set');
  const redirect = `${process.env.NEXT_PUBLIC_APP_BASE_URL?.replace(/\/$/, '')}/api/oauth/stripe/callback`;
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: 'read_write',
    state,
    redirect_uri: redirect,
  });
  return `${STRIPE_OAUTH_AUTHORIZE}?${params.toString()}`;
}

/** Exchange auth code for access token + stripe_user_id. */
export async function exchangeStripeCode(code: string): Promise<StripeTokenResponse | null> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    console.warn('[stripe] STRIPE_SECRET_KEY not set');
    return null;
  }
  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_secret: secretKey,
    });
    const res = await fetch(STRIPE_OAUTH_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) {
      console.warn('[stripe] token exchange failed:', res.status, await res.text());
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn('[stripe] token exchange exception:', err);
    return null;
  }
}

// ─── Account-side API calls (use connected account access_token) ──────────

/** Fetch the connected merchant's basic account info. */
export async function fetchStripeAccount(accessToken: string): Promise<any | null> {
  try {
    const res = await fetch(`${STRIPE_API_BASE}/account`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      console.warn('[stripe] fetchAccount failed:', res.status);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn('[stripe] fetchAccount exception:', err);
    return null;
  }
}

/** List recent charges for the connected merchant. */
export async function listStripeCharges(accessToken: string, limit = 25): Promise<any[]> {
  try {
    const res = await fetch(`${STRIPE_API_BASE}/charges?limit=${limit}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.data ?? [];
  } catch {
    return [];
  }
}

/** Create a Payment Link for a customer to pay an invoice or service.
 *  This is the simplest way to request payment without building a full
 *  Stripe Checkout flow — Stripe hosts the page, we just send the URL. */
export async function createStripePaymentLink(input: {
  accessToken: string;
  amountUsd: number;
  description: string;
  customerEmail?: string;
}): Promise<{ url: string; id: string } | null> {
  try {
    // First create a Price + Product
    const productRes = await fetch(`${STRIPE_API_BASE}/products`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        name: input.description.slice(0, 200),
      }).toString(),
    });
    if (!productRes.ok) {
      console.warn('[stripe] product create failed:', await productRes.text());
      return null;
    }
    const product = await productRes.json();

    const priceRes = await fetch(`${STRIPE_API_BASE}/prices`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        unit_amount: String(Math.round(input.amountUsd * 100)),
        currency: 'usd',
        product: product.id,
      }).toString(),
    });
    if (!priceRes.ok) {
      console.warn('[stripe] price create failed:', await priceRes.text());
      return null;
    }
    const price = await priceRes.json();

    const linkRes = await fetch(`${STRIPE_API_BASE}/payment_links`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        'line_items[0][price]': price.id,
        'line_items[0][quantity]': '1',
      }).toString(),
    });
    if (!linkRes.ok) {
      console.warn('[stripe] payment_link create failed:', await linkRes.text());
      return null;
    }
    const link = await linkRes.json();
    return { url: link.url, id: link.id };
  } catch (err) {
    console.warn('[stripe] createPaymentLink exception:', err);
    return null;
  }
}

// ─── Persistence ──────────────────────────────────────────────────────────

export async function saveStripeConnection(input: {
  tenantPhone: string;
  tokens: StripeTokenResponse;
}): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false;
  const cleanPhone = input.tenantPhone.replace(/[\s\-+()]/g, '');
  try {
    const encryptedAccess = await encryptToken(input.tokens.access_token);
    const encryptedRefresh = input.tokens.refresh_token
      ? await encryptToken(input.tokens.refresh_token)
      : null;

    const body = {
      phone_number: cleanPhone,
      provider: 'stripe',
      service: 'payments',
      account_name: input.tokens.stripe_user_id,
      access_token: encryptedAccess,
      refresh_token: encryptedRefresh,
      scopes: (input.tokens.scope ?? 'read_write').split(' '),
      status: 'active',
      metadata: {
        stripe_user_id: input.tokens.stripe_user_id,
        publishable_key: input.tokens.stripe_publishable_key,
        livemode: input.tokens.livemode ?? false,
      },
    };

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/oauth_connections?on_conflict=phone_number,provider,service`,
      {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(body),
      },
    );
    return res.ok;
  } catch (err) {
    console.warn('[stripe] saveConnection exception:', err);
    return false;
  }
}

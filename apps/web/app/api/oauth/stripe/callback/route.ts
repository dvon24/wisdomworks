/**
 * Stripe OAuth callback. Mirrors the Square / Calendly callback shape.
 *
 * GET /api/oauth/stripe/callback?code=…&state=…
 */

import { NextResponse } from 'next/server';
import { verifySessionToken } from '../../../_lib/api-auth';
import { exchangeStripeCode, saveStripeConnection } from '../../../_lib/integrations/stripe-connect';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const errParam = url.searchParams.get('error');

  const deckBase = process.env.NEXT_PUBLIC_APP_BASE_URL || 'https://wisdomworks.vercel.app';

  if (errParam) {
    console.warn('[stripe-oauth] user-rejected:', errParam);
    return NextResponse.redirect(`${deckBase}/?oauth=denied&provider=stripe`);
  }
  if (!code || !state) return new Response('Missing code or state', { status: 400 });

  const verified = await verifySessionToken(state);
  if (!verified) return new Response('Invalid state — open the link again from your deck', { status: 401 });

  const tokens = await exchangeStripeCode(code);
  if (!tokens?.access_token) return new Response('Stripe token exchange failed', { status: 502 });

  await saveStripeConnection({ tenantPhone: verified.phone, tokens });

  return NextResponse.redirect(`${deckBase}/?oauth=success&provider=stripe&service=payments`);
}

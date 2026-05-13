/**
 * Stripe OAuth initiation.
 *
 * GET /api/oauth/stripe?phone=<tenant_phone>
 *   → redirects to Stripe authorize URL with phone embedded in state
 *
 * Required env:
 *   - STRIPE_CLIENT_ID (Stripe Connect application id, from
 *     https://dashboard.stripe.com/settings/connect/onboarding-options)
 *   - STRIPE_SECRET_KEY (platform secret)
 *   - NEXT_PUBLIC_APP_BASE_URL (redirect URI base)
 *   - API_AUTH_SECRET (state signing)
 */

import { signSessionToken } from '../../_lib/api-auth';
import { buildStripeAuthorizeUrl } from '../../_lib/integrations/stripe-connect';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const phone = url.searchParams.get('phone');
  if (!phone) return new Response('phone required', { status: 400 });
  if (!process.env.STRIPE_CLIENT_ID) {
    return new Response('STRIPE_CLIENT_ID not configured', { status: 503 });
  }
  const state = await signSessionToken(phone);
  return Response.redirect(buildStripeAuthorizeUrl(state), 302);
}

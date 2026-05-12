/**
 * Square OAuth initiation.
 *
 * GET /api/oauth/square?phone=<tenant_phone>
 *   → redirects to Square's authorize URL with the phone embedded in state
 *
 * Callback lives at /api/oauth/square/callback.
 *
 * Required env:
 *   - SQUARE_APP_ID, SQUARE_APP_SECRET (from Square Developer dashboard)
 *   - SQUARE_ENV ('sandbox' or 'production')
 *   - NEXT_PUBLIC_APP_BASE_URL (used to build the redirect URI)
 *   - API_AUTH_SECRET (signs the state token so the callback can verify)
 */

import { signSessionToken } from '../../_lib/api-auth';
import { buildSquareAuthorizeUrl } from '../../_lib/booking-adapters/square';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const phone = url.searchParams.get('phone');
  if (!phone) return new Response('phone required', { status: 400 });

  if (!process.env.SQUARE_APP_ID) {
    return new Response('SQUARE_APP_ID not configured', { status: 503 });
  }

  // Sign the tenant phone into state so the callback can verify the
  // request didn't get spoofed (CSRF guard). Re-uses the existing
  // session-token HMAC.
  const state = await signSessionToken(phone);
  const authorizeUrl = buildSquareAuthorizeUrl(state);
  return Response.redirect(authorizeUrl, 302);
}

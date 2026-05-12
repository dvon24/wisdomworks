/**
 * Calendly OAuth initiation.
 *
 * GET /api/oauth/calendly?phone=<tenant_phone>
 *   → redirects to Calendly authorize URL with phone embedded in state.
 *
 * Required env:
 *   - CALENDLY_CLIENT_ID, CALENDLY_CLIENT_SECRET (from Calendly Developer dashboard)
 *   - NEXT_PUBLIC_APP_BASE_URL (for redirect URI)
 *   - API_AUTH_SECRET (signs state)
 */

import { signSessionToken } from '../../_lib/api-auth';
import { buildCalendlyAuthorizeUrl } from '../../_lib/booking-adapters/calendly';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const phone = url.searchParams.get('phone');
  if (!phone) return new Response('phone required', { status: 400 });

  if (!process.env.CALENDLY_CLIENT_ID) {
    return new Response('CALENDLY_CLIENT_ID not configured', { status: 503 });
  }

  const state = await signSessionToken(phone);
  const authorizeUrl = buildCalendlyAuthorizeUrl(state);
  return Response.redirect(authorizeUrl, 302);
}

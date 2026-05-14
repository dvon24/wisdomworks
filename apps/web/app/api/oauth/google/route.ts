/**
 * Google OAuth initiation — redirects to Google consent screen.
 *
 * GET /api/oauth/google?phone=+491703604562
 *
 * Ported from apps/website 2026-05-14 because apps/web is the actually-
 * deployed app at wisdomworks.vercel.app; the website-only version was
 * 404'ing all Connect Google buttons in production.
 *
 * Scopes: Gmail + Calendar + Drive + Search Console + Analytics. The
 * webmasters.readonly and analytics.readonly scopes were added today
 * for Alex (Au7o Project Director) so he can pull GSC/GA4 data.
 *
 * Re-consent required for tenants connected before this scope was added.
 */

import { signSessionToken } from '../../_lib/api-auth';
import { callbackBaseUrl } from '../_lib/save-connection';

export const dynamic = 'force-dynamic';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

const SCOPES = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/webmasters.readonly',
  'https://www.googleapis.com/auth/analytics.readonly',
];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const phone = url.searchParams.get('phone');

  if (!phone || phone.length < 8) {
    return new Response('Invalid phone number', { status: 400 });
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return new Response('Google OAuth not configured (GOOGLE_CLIENT_ID missing)', { status: 503 });
  }

  const redirectUri = `${callbackBaseUrl(request)}/api/oauth/google/callback`;
  // Use signSessionToken as the state — same HMAC the rest of the deck
  // uses, callback verifies via verifySessionToken.
  const state = await signSessionToken(phone);

  const authUrl = new URL(GOOGLE_AUTH_URL);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', SCOPES.join(' '));
  authUrl.searchParams.set('access_type', 'offline');  // get refresh token
  authUrl.searchParams.set('prompt', 'consent');        // force refresh token even on re-auth
  authUrl.searchParams.set('state', state);

  return Response.redirect(authUrl.toString(), 302);
}

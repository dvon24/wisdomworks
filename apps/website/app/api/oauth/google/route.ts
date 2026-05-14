/**
 * Google OAuth initiation — redirects user to Google consent screen.
 *
 * GET /api/oauth/google?phone=+491703604562&service=email|calendar|both
 *
 * After user approves, Google redirects back to /api/oauth/google/callback
 * with an authorization code we exchange for tokens.
 */

import { generateState, getCallbackBaseUrl } from '../_lib/store';

export const dynamic = 'force-dynamic';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

// Combined scopes — Gmail + Calendar + Drive + Search Console + Analytics.
// drive.readonly allows search + read of files (Story 2.16 Phase 4).
// webmasters.readonly + analytics.readonly added 2026-05-14 for Alex
// (Au7o Project Director) so he can pull GSC impressions/clicks +
// GA4 sessions/users to report on site performance.
//
// Re-consent required for tenants connected before any scope was added.
// Existing tokens continue to work for the scopes they had; tools that
// need newer scopes surface a "reconnect Google" message when the
// token's scopes don't cover the call. Iris/Alex's agent tools check
// connection.service and skip themselves when the corresponding row
// doesn't exist.
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
    return new Response('Google OAuth not configured', { status: 500 });
  }

  const redirectUri = `${getCallbackBaseUrl(request)}/api/oauth/google/callback`;
  const state = generateState(phone);

  const authUrl = new URL(GOOGLE_AUTH_URL);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', SCOPES.join(' '));
  authUrl.searchParams.set('access_type', 'offline'); // get refresh token
  authUrl.searchParams.set('prompt', 'consent'); // force refresh token even on re-auth
  authUrl.searchParams.set('state', state);

  return Response.redirect(authUrl.toString(), 302);
}

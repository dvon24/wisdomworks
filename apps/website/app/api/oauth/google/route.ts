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

// Combined scopes — covers Gmail + Calendar + basic profile
const SCOPES = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar',
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

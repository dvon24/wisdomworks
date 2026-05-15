/**
 * SSO sign-in via Google — Phase 1.
 *
 * GET /api/auth/google
 *
 * The difference between this and /api/oauth/google:
 *   /api/oauth/google  — "I'm already logged in, add Google as a service"
 *                        (requires ?phone= in the query string)
 *   /api/auth/google   — "Sign me in WITH Google"
 *                        (no phone needed — we look the user up by their
 *                         Google email after they consent; if no tenant
 *                         exists for that email we route them to signup)
 *
 * Requests identity + the full service-scope set in ONE consent screen
 * so a successful sign-in also persists Gmail/Calendar/Drive/Sheets/etc.
 * connections in the callback. True one click = login + services.
 */

import { callbackBaseUrl } from '../../oauth/_lib/save-connection';

export const dynamic = 'force-dynamic';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

// Same scope set as /api/oauth/google — auth flow doubles as service
// connect, so we ask for everything the integration adapters use.
const SCOPES = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/webmasters.readonly',
  'https://www.googleapis.com/auth/analytics.readonly',
  'https://www.googleapis.com/auth/spreadsheets',
];

export async function GET(request: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return new Response('Google OAuth not configured (GOOGLE_CLIENT_ID missing)', { status: 503 });
  }

  const url = new URL(request.url);
  const redirectUri = `${callbackBaseUrl(request)}/api/auth/google/callback`;
  // Optional return-path override — defaults to '/' (the deck root).
  // Caller can pass ?next=/some/path to be redirected there after sign-in.
  const next = url.searchParams.get('next') ?? '/';
  // State is a random nonce — we don't have a phone yet at the start of
  // sign-in flow, so we can't use the phone-based signed session token
  // pattern that /api/oauth/* uses. Encode the `next` path in the state
  // so the callback can honor it.
  const nonce = crypto.randomUUID();
  const state = encodeURIComponent(`${nonce}|${next}`);

  const authUrl = new URL(GOOGLE_AUTH_URL);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', SCOPES.join(' '));
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');
  authUrl.searchParams.set('state', state);

  return Response.redirect(authUrl.toString(), 302);
}

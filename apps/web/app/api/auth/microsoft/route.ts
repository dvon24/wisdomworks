/**
 * SSO sign-in via Microsoft — Phase 1.
 *
 * GET /api/auth/microsoft
 *
 * Same pattern as /api/auth/google but for Microsoft 365 / Outlook
 * identities. Requests identity + the full service-scope set (Outlook,
 * Calendar, OneDrive) so a successful sign-in also persists connections
 * in the callback.
 *
 * Sibling of /api/oauth/microsoft (which requires an already-signed-in
 * user and a ?phone= param). This route is for the very first click —
 * we have no phone yet.
 */

import { callbackBaseUrl } from '../../oauth/_lib/save-connection';

export const dynamic = 'force-dynamic';

const MS_AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';

const SCOPES = [
  'openid',
  'email',
  'profile',
  'offline_access',
  'User.Read',
  'Mail.Read',
  'Mail.Send',
  'Calendars.ReadWrite',
  'Files.Read.All',
];

export async function GET(request: Request) {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  if (!clientId) {
    return new Response('Microsoft OAuth not configured (MICROSOFT_CLIENT_ID missing)', { status: 503 });
  }

  const url = new URL(request.url);
  const redirectUri = `${callbackBaseUrl(request)}/api/auth/microsoft/callback`;
  const next = url.searchParams.get('next') ?? '/';
  const nonce = crypto.randomUUID();
  const state = encodeURIComponent(`${nonce}|${next}`);

  const authUrl = new URL(MS_AUTH_URL);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', SCOPES.join(' '));
  authUrl.searchParams.set('response_mode', 'query');
  authUrl.searchParams.set('state', state);

  return Response.redirect(authUrl.toString(), 302);
}

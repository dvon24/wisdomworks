/**
 * Microsoft OAuth initiation — covers Outlook + Calendar via Microsoft Graph.
 *
 * GET /api/oauth/microsoft?phone=+491703604562
 */

import { generateState, getCallbackBaseUrl } from '../_lib/store';

export const dynamic = 'force-dynamic';

const MS_AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';

const SCOPES = [
  'openid',
  'email',
  'profile',
  'offline_access', // refresh token
  'User.Read',
  'Mail.Read',
  'Mail.Send',
  'Calendars.ReadWrite',
  // Files.Read.All — search + read OneDrive files (own + shared). Used
  // by Story 2.16 Phase 4 cloud-doc tools. Re-consent required for
  // tenants connected before this scope was added; doc-pull tools
  // detect the missing scope at call time and tell owner to reconnect.
  'Files.Read.All',
];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const phone = url.searchParams.get('phone');

  if (!phone || phone.length < 8) {
    return new Response('Invalid phone number', { status: 400 });
  }

  const clientId = process.env.MICROSOFT_CLIENT_ID;
  if (!clientId) {
    return new Response('Microsoft OAuth not configured', { status: 500 });
  }

  const redirectUri = `${getCallbackBaseUrl(request)}/api/oauth/microsoft/callback`;
  const state = generateState(phone);

  const authUrl = new URL(MS_AUTH_URL);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', SCOPES.join(' '));
  authUrl.searchParams.set('response_mode', 'query');
  authUrl.searchParams.set('state', state);

  return Response.redirect(authUrl.toString(), 302);
}

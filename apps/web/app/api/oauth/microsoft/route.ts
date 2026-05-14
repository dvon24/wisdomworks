/**
 * Microsoft OAuth initiation — Outlook + Calendar + OneDrive via Microsoft Graph.
 *
 * Ported from apps/website 2026-05-14.
 *
 * GET /api/oauth/microsoft?phone=+491703604562
 */

import { signSessionToken } from '../../_lib/api-auth';
import { callbackBaseUrl } from '../_lib/save-connection';

export const dynamic = 'force-dynamic';

const MS_AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';

const SCOPES = [
  'openid',
  'email',
  'profile',
  'offline_access',  // refresh token
  'User.Read',
  'Mail.Read',
  'Mail.Send',
  'Calendars.ReadWrite',
  'Files.Read.All',   // OneDrive search + read for cloud-doc tools
];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const phone = url.searchParams.get('phone');

  if (!phone || phone.length < 8) {
    return new Response('Invalid phone number', { status: 400 });
  }

  const clientId = process.env.MICROSOFT_CLIENT_ID;
  if (!clientId) {
    return new Response('Microsoft OAuth not configured (MICROSOFT_CLIENT_ID missing)', { status: 503 });
  }

  const redirectUri = `${callbackBaseUrl(request)}/api/oauth/microsoft/callback`;
  const state = await signSessionToken(phone);

  const authUrl = new URL(MS_AUTH_URL);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', SCOPES.join(' '));
  authUrl.searchParams.set('response_mode', 'query');
  authUrl.searchParams.set('state', state);

  return Response.redirect(authUrl.toString(), 302);
}

/**
 * Meta OAuth initiation — Instagram Basic Display via Facebook Login.
 *
 * GET /api/oauth/meta?phone=+491703604562
 */

import { generateState, getCallbackBaseUrl } from '../_lib/store';

export const dynamic = 'force-dynamic';

const META_AUTH_URL = 'https://api.instagram.com/oauth/authorize';

const SCOPES = ['user_profile', 'user_media'];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const phone = url.searchParams.get('phone');

  if (!phone || phone.length < 8) {
    return new Response('Invalid phone number', { status: 400 });
  }

  const clientId = process.env.META_CLIENT_ID ?? process.env.INSTAGRAM_APP_ID;
  if (!clientId) {
    return new Response('Meta OAuth not configured', { status: 500 });
  }

  const redirectUri = `${getCallbackBaseUrl(request)}/api/oauth/meta/callback`;
  const state = generateState(phone);

  const authUrl = new URL(META_AUTH_URL);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', SCOPES.join(','));
  authUrl.searchParams.set('state', state);

  return Response.redirect(authUrl.toString(), 302);
}

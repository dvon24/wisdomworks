/**
 * Meta OAuth initiation — Instagram via Facebook Login for Business.
 *
 * Ported from apps/website 2026-05-14.
 *
 * GET /api/oauth/meta?phone=+491703604562
 */

import { signSessionToken } from '../../_lib/api-auth';
import { callbackBaseUrl } from '../_lib/save-connection';

export const dynamic = 'force-dynamic';

const META_AUTH_URL = 'https://www.facebook.com/v25.0/dialog/oauth';

const SCOPES = [
  'instagram_business_basic',
  'instagram_business_content_publish',
  'instagram_business_manage_messages',
  'instagram_business_manage_comments',
  'pages_show_list',
  'pages_read_engagement',
  'business_management',
];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const phone = url.searchParams.get('phone');

  if (!phone || phone.length < 8) {
    return new Response('Invalid phone number', { status: 400 });
  }

  const clientId = process.env.META_CLIENT_ID;
  if (!clientId) {
    return new Response('Meta OAuth not configured (META_CLIENT_ID missing)', { status: 503 });
  }

  const redirectUri = `${callbackBaseUrl(request)}/api/oauth/meta/callback`;
  const state = await signSessionToken(phone);

  const authUrl = new URL(META_AUTH_URL);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', SCOPES.join(','));
  authUrl.searchParams.set('state', state);

  return Response.redirect(authUrl.toString(), 302);
}

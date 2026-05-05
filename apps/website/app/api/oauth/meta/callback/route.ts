/**
 * Meta OAuth callback — exchanges code for Instagram access token, saves connection.
 */

import { decodeState, getCallbackBaseUrl, saveConnection } from '../../_lib/store';

export const dynamic = 'force-dynamic';

const META_TOKEN_URL = 'https://api.instagram.com/oauth/access_token';
const META_USERINFO_URL = 'https://graph.instagram.com/me?fields=id,username';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) {
    return Response.redirect(`${getCallbackBaseUrl(request)}/?oauth=denied&provider=meta`, 302);
  }

  if (!code || !state) {
    return new Response('Missing code or state', { status: 400 });
  }

  const decoded = decodeState(state);
  if (!decoded) {
    return new Response('Invalid or expired state', { status: 400 });
  }

  const clientId = process.env.META_CLIENT_ID ?? process.env.INSTAGRAM_APP_ID;
  const clientSecret = process.env.META_CLIENT_SECRET ?? process.env.INSTAGRAM_APP_SECRET;
  if (!clientId || !clientSecret) {
    return new Response('Meta OAuth not configured', { status: 500 });
  }

  const redirectUri = `${getCallbackBaseUrl(request)}/api/oauth/meta/callback`;

  try {
    // Instagram returns short-lived token here
    const tokenRes = await fetch(META_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code,
      }),
    });

    if (!tokenRes.ok) {
      console.error('[meta-oauth] Token exchange failed:', await tokenRes.text());
      return Response.redirect(`${getCallbackBaseUrl(request)}/?oauth=error&provider=meta`, 302);
    }

    const shortToken = await tokenRes.json();

    // Exchange short-lived for long-lived (60 days)
    const longTokenRes = await fetch(
      `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${clientSecret}&access_token=${shortToken.access_token}`,
    );
    const longToken = await longTokenRes.json();

    const accessToken = longToken.access_token ?? shortToken.access_token;
    const expiresIn = longToken.expires_in ?? 3600;

    // Fetch user info
    const userRes = await fetch(`${META_USERINFO_URL}&access_token=${accessToken}`);
    const user = await userRes.json();

    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    await saveConnection({
      phone_number: decoded.phone,
      provider: 'meta',
      service: 'instagram',
      account_email: user.username,
      account_name: user.username,
      access_token: accessToken,
      expires_at: expiresAt,
      metadata: { instagram_user_id: shortToken.user_id ?? user.id },
    });

    console.log(`[meta-oauth] Connected Instagram @${user.username} for ${decoded.phone}`);

    return Response.redirect(
      `${getCallbackBaseUrl(request)}/?oauth=success&provider=meta&services=instagram&email=${encodeURIComponent(user.username)}`,
      302,
    );
  } catch (err) {
    console.error('[meta-oauth] Callback error:', err);
    return Response.redirect(`${getCallbackBaseUrl(request)}/?oauth=error&provider=meta`, 302);
  }
}

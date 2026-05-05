/**
 * Microsoft OAuth callback — exchanges code for tokens, saves both Email + Calendar connections.
 */

import { decodeState, getCallbackBaseUrl, saveConnection } from '../../_lib/store';

export const dynamic = 'force-dynamic';

const MS_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const MS_USERINFO_URL = 'https://graph.microsoft.com/v1.0/me';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) {
    return Response.redirect(`${getCallbackBaseUrl(request)}/?oauth=denied&provider=microsoft`, 302);
  }

  if (!code || !state) {
    return new Response('Missing code or state', { status: 400 });
  }

  const decoded = decodeState(state);
  if (!decoded) {
    return new Response('Invalid or expired state', { status: 400 });
  }

  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return new Response('Microsoft OAuth not configured', { status: 500 });
  }

  const redirectUri = `${getCallbackBaseUrl(request)}/api/oauth/microsoft/callback`;

  try {
    const tokenRes = await fetch(MS_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      console.error('[ms-oauth] Token exchange failed:', await tokenRes.text());
      return Response.redirect(`${getCallbackBaseUrl(request)}/?oauth=error&provider=microsoft`, 302);
    }

    const tokens = await tokenRes.json();

    const userRes = await fetch(MS_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const user = await userRes.json();

    const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString();
    const scopes = (tokens.scope ?? '').split(' ');
    const email = user.mail ?? user.userPrincipalName;

    await saveConnection({
      phone_number: decoded.phone,
      provider: 'microsoft',
      service: 'email',
      account_email: email,
      account_name: user.displayName,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: expiresAt,
      scopes,
    });

    await saveConnection({
      phone_number: decoded.phone,
      provider: 'microsoft',
      service: 'calendar',
      account_email: email,
      account_name: user.displayName,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: expiresAt,
      scopes,
    });

    console.log(`[ms-oauth] Connected ${email} for ${decoded.phone}`);

    return Response.redirect(
      `${getCallbackBaseUrl(request)}/?oauth=success&provider=microsoft&services=email,calendar&email=${encodeURIComponent(email)}`,
      302,
    );
  } catch (err) {
    console.error('[ms-oauth] Callback error:', err);
    return Response.redirect(`${getCallbackBaseUrl(request)}/?oauth=error&provider=microsoft`, 302);
  }
}

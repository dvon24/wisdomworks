/**
 * Google OAuth callback — exchanges authorization code for access + refresh tokens.
 *
 * Google redirects here after the user approves access.
 * We exchange the code for tokens, fetch the user's email/name, and save the connection.
 */

import { decodeState, getCallbackBaseUrl, saveConnection } from '../../_lib/store';

export const dynamic = 'force-dynamic';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  // User denied access or Google returned an error
  if (error) {
    return Response.redirect(`${getCallbackBaseUrl(request)}/?oauth=denied&provider=google`, 302);
  }

  if (!code || !state) {
    return new Response('Missing code or state', { status: 400 });
  }

  // Verify state and extract phone number
  const decoded = decodeState(state);
  if (!decoded) {
    return new Response('Invalid or expired state', { status: 400 });
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return new Response('Google OAuth not configured', { status: 500 });
  }

  const redirectUri = `${getCallbackBaseUrl(request)}/api/oauth/google/callback`;

  try {
    // Exchange code for tokens
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text();
      console.error('[google-oauth] Token exchange failed:', errBody);
      return Response.redirect(`${getCallbackBaseUrl(request)}/?oauth=error&provider=google`, 302);
    }

    const tokens = await tokenRes.json();

    // Fetch user info to get email and name
    const userRes = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const user = await userRes.json();

    const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString();
    const scopes = (tokens.scope ?? '').split(' ');

    // Save both Email and Calendar connections — Google bundles them in one consent
    await saveConnection({
      phone_number: decoded.phone,
      provider: 'google',
      service: 'email',
      account_email: user.email,
      account_name: user.name,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: expiresAt,
      scopes,
    });

    await saveConnection({
      phone_number: decoded.phone,
      provider: 'google',
      service: 'calendar',
      account_email: user.email,
      account_name: user.name,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: expiresAt,
      scopes,
    });

    console.log(`[google-oauth] Connected ${user.email} for ${decoded.phone}`);

    // Redirect back to the app with success
    return Response.redirect(
      `${getCallbackBaseUrl(request)}/?oauth=success&provider=google&services=email,calendar&email=${encodeURIComponent(user.email)}`,
      302,
    );
  } catch (err) {
    console.error('[google-oauth] Callback error:', err);
    return Response.redirect(`${getCallbackBaseUrl(request)}/?oauth=error&provider=google`, 302);
  }
}

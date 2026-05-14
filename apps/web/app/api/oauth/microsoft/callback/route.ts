/**
 * Microsoft OAuth callback — exchanges code for tokens, saves connection rows.
 *
 * Ported from apps/website 2026-05-14. Writes one row per granted service
 * (email, calendar, drive) so the deck's tool gating shows the matching
 * tools per service.
 */

import { NextResponse } from 'next/server';
import { verifySessionToken } from '../../../_lib/api-auth';
import { saveOAuthConnection, callbackBaseUrl } from '../../_lib/save-connection';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MS_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const MS_USERINFO_URL = 'https://graph.microsoft.com/v1.0/me';

const SERVICE_SCOPE_MAP: Array<{ service: string; scopeNeedle: string }> = [
  { service: 'email', scopeNeedle: 'Mail.Read' },
  { service: 'calendar', scopeNeedle: 'Calendars' },
  { service: 'drive', scopeNeedle: 'Files.Read' },
];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const baseUrl = callbackBaseUrl(request);

  if (error) {
    return Response.redirect(`${baseUrl}/?oauth=denied&provider=microsoft`, 302);
  }
  if (!code || !state) return new Response('Missing code or state', { status: 400 });

  const verified = await verifySessionToken(state);
  if (!verified) return new Response('Invalid or expired state — open the Connect link again', { status: 401 });

  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return new Response('Microsoft OAuth not configured', { status: 500 });
  }

  const redirectUri = `${baseUrl}/api/oauth/microsoft/callback`;

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
      console.error('[ms-oauth] token exchange failed:', await tokenRes.text());
      return Response.redirect(`${baseUrl}/?oauth=error&provider=microsoft`, 302);
    }
    const tokens = await tokenRes.json();

    const userRes = await fetch(MS_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const user = await userRes.json();

    const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString();
    const scopes: string[] = (tokens.scope ?? '').split(' ').filter(Boolean);
    const email = user.mail ?? user.userPrincipalName;
    const cleanPhone = verified.phone.replace(/[\s\-+()]/g, '');

    const grantedServices: string[] = [];
    for (const { service, scopeNeedle } of SERVICE_SCOPE_MAP) {
      const granted = scopes.some((s) => s.includes(scopeNeedle));
      if (!granted) continue;
      await saveOAuthConnection({
        phone_number: cleanPhone,
        provider: 'microsoft',
        service,
        account_email: email,
        account_name: user.displayName,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: expiresAt,
        scopes,
      });
      grantedServices.push(service);
    }

    console.log(`[ms-oauth] Connected ${email} for ${cleanPhone} — services: ${grantedServices.join(', ')}`);

    return Response.redirect(
      `${baseUrl}/?oauth=success&provider=microsoft&services=${encodeURIComponent(grantedServices.join(','))}&email=${encodeURIComponent(email)}`,
      302,
    );
  } catch (err) {
    console.error('[ms-oauth] callback error:', err);
    return Response.redirect(`${baseUrl}/?oauth=error&provider=microsoft`, 302);
  }
}

/**
 * Google OAuth callback — exchanges code for tokens, persists connection rows.
 *
 * Ported from apps/website 2026-05-14. Writes ONE oauth_connections row
 * per service the user granted (email, calendar, drive, search_console,
 * analytics) so the deck's tool gating shows the right tools per service.
 */

import { NextResponse } from 'next/server';
import { verifySessionToken } from '../../../_lib/api-auth';
import { saveOAuthConnection, callbackBaseUrl } from '../../_lib/save-connection';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

const SERVICE_SCOPE_MAP: Array<{ service: string; scopeNeedle: string }> = [
  { service: 'email', scopeNeedle: 'gmail' },
  { service: 'calendar', scopeNeedle: '/calendar' },
  { service: 'drive', scopeNeedle: 'drive.readonly' },
  { service: 'search_console', scopeNeedle: 'webmasters' },
  { service: 'analytics', scopeNeedle: 'analytics.readonly' },
];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const baseUrl = callbackBaseUrl(request);

  if (error) {
    return Response.redirect(`${baseUrl}/?oauth=denied&provider=google`, 302);
  }
  if (!code || !state) return new Response('Missing code or state', { status: 400 });

  const verified = await verifySessionToken(state);
  if (!verified) return new Response('Invalid or expired state — open the Connect link again', { status: 401 });

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return new Response('Google OAuth not configured', { status: 500 });
  }

  const redirectUri = `${baseUrl}/api/oauth/google/callback`;

  try {
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
      console.error('[google-oauth] token exchange failed:', await tokenRes.text());
      return Response.redirect(`${baseUrl}/?oauth=error&provider=google`, 302);
    }
    const tokens = await tokenRes.json();

    const userRes = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const user = await userRes.json();

    const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString();
    const scopes: string[] = (tokens.scope ?? '').split(' ').filter(Boolean);

    const cleanPhone = verified.phone.replace(/[\s\-+()]/g, '');

    const grantedServices: string[] = [];
    for (const { service, scopeNeedle } of SERVICE_SCOPE_MAP) {
      const granted = scopes.some((s) => s.includes(scopeNeedle));
      if (!granted) continue;
      await saveOAuthConnection({
        phone_number: cleanPhone,
        provider: 'google',
        service,
        account_email: user.email,
        account_name: user.name,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: expiresAt,
        scopes,
      });
      grantedServices.push(service);
    }

    console.log(`[google-oauth] Connected ${user.email} for ${cleanPhone} — services: ${grantedServices.join(', ')}`);

    return Response.redirect(
      `${baseUrl}/?oauth=success&provider=google&services=${encodeURIComponent(grantedServices.join(','))}&email=${encodeURIComponent(user.email)}`,
      302,
    );
  } catch (err) {
    console.error('[google-oauth] callback error:', err);
    return Response.redirect(`${baseUrl}/?oauth=error&provider=google`, 302);
  }
}

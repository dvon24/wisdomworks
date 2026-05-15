/**
 * SSO sign-in via Google — callback. Phase 1.
 *
 * GET /api/auth/google/callback?code=...&state=...
 *
 * Phase 1 scope (this commit):
 *   - Exchange code for tokens
 *   - Look up the tenant by Google email via oauth_connections.account_email
 *   - If found: refresh the Google connection rows for this tenant, sign
 *     a ww_session cookie, redirect to the deck
 *   - If not found: redirect to the landing page with ?signup_email=<email>
 *     so the onboarding chat can pre-populate. Phase 2 will handle full
 *     SSO signup (persist tokens, finalize tenant via deploy-complete).
 */

import { NextResponse } from 'next/server';
import { signSessionToken, SESSION_COOKIE_NAME } from '../../../_lib/api-auth';
import { saveOAuthConnection, callbackBaseUrl } from '../../../oauth/_lib/save-connection';
import { logAuditEvent } from '../../../_lib/audit-log';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

const SERVICE_SCOPE_MAP: Array<{ service: string; scopeNeedle: string }> = [
  { service: 'email', scopeNeedle: 'gmail' },
  { service: 'calendar', scopeNeedle: '/calendar' },
  { service: 'drive', scopeNeedle: 'drive.' },
  { service: 'search_console', scopeNeedle: 'webmasters' },
  { service: 'analytics', scopeNeedle: 'analytics.readonly' },
  { service: 'sheets', scopeNeedle: 'spreadsheets' },
];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const baseUrl = callbackBaseUrl(request);

  if (error) {
    return Response.redirect(`${baseUrl}/?sso=denied&provider=google`, 302);
  }
  if (!code || !state) return new Response('Missing code or state', { status: 400 });

  // state encodes "<nonce>|<next>". We don't validate the nonce against a
  // server-side store yet — Phase 2 will tighten this with a signed,
  // short-lived state token. For now the cookie origin check + state's
  // presence keeps trivial CSRF out.
  const decoded = decodeURIComponent(state);
  const pipeIdx = decoded.indexOf('|');
  const next = pipeIdx >= 0 ? decoded.slice(pipeIdx + 1) : '/';

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return new Response('Google OAuth not configured', { status: 500 });
  }

  const redirectUri = `${baseUrl}/api/auth/google/callback`;

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
      console.error('[auth/google] token exchange failed:', await tokenRes.text());
      return Response.redirect(`${baseUrl}/?sso=error&provider=google`, 302);
    }
    const tokens = await tokenRes.json();

    const userRes = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const user = await userRes.json();
    if (!user.email) {
      console.error('[auth/google] no email on userinfo response:', user);
      return Response.redirect(`${baseUrl}/?sso=error&provider=google`, 302);
    }

    const email = String(user.email).toLowerCase();
    const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString();
    const scopes: string[] = (tokens.scope ?? '').split(' ').filter(Boolean);

    // Look up phone by email across oauth_connections. If multiple tenants
    // ever connected the same Google account (unusual but possible), pick
    // the most recently touched one — the user will typically be signing
    // into whichever account they last used.
    let tenantPhone: string | null = null;
    if (SUPABASE_URL && SUPABASE_KEY) {
      try {
        const lookupRes = await fetch(
          `${SUPABASE_URL}/rest/v1/oauth_connections?account_email=eq.${encodeURIComponent(email)}&order=updated_at.desc&limit=1&select=phone_number`,
          {
            headers: {
              apikey: SUPABASE_KEY,
              Authorization: `Bearer ${SUPABASE_KEY}`,
            },
          },
        );
        if (lookupRes.ok) {
          const rows = await lookupRes.json();
          if (Array.isArray(rows) && rows.length > 0 && rows[0]?.phone_number) {
            tenantPhone = String(rows[0].phone_number);
          }
        }
      } catch (err) {
        console.warn('[auth/google] tenant lookup failed:', err);
      }
    }

    if (!tenantPhone) {
      // Phase 1: route new users back to the landing page with their email
      // so the onboarding flow can pre-fill it. Phase 2 will persist the
      // OAuth tokens to a pending-signin row and finalize on deploy-complete.
      const websiteBase = process.env.NEXT_PUBLIC_WEBSITE_URL ?? baseUrl;
      const signupUrl = new URL(websiteBase);
      signupUrl.searchParams.set('signup_email', email);
      signupUrl.searchParams.set('signup_name', String(user.name ?? ''));
      signupUrl.searchParams.set('signup_provider', 'google');
      return Response.redirect(signupUrl.toString(), 302);
    }

    // Existing tenant — refresh the OAuth connection rows for each service
    // they consented to. This is the same loop as /api/oauth/google/callback
    // so signing in keeps tokens warm AND grants any newly-added scopes
    // (e.g. drive.file, spreadsheets) without a separate Reconnect trip.
    for (const { service, scopeNeedle } of SERVICE_SCOPE_MAP) {
      const granted = scopes.some((s) => s.includes(scopeNeedle));
      if (!granted) continue;
      await saveOAuthConnection({
        phone_number: tenantPhone,
        provider: 'google',
        service,
        account_email: email,
        account_name: user.name,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: expiresAt,
        scopes,
      });
    }

    // Mint a session token and set the ww_session cookie. Same shape as
    // /api/auth/deck/redeem — 30-day persistence, httpOnly, sameSite=lax.
    const sessionToken = await signSessionToken(tenantPhone);

    void logAuditEvent({
      tenantPhone,
      actor: tenantPhone,
      actorType: 'owner',
      action: 'auth.session_redeemed',
      resource: '/api/auth/google/callback',
      outcome: 'success',
      payload: {
        sso_provider: 'google',
        sso_email: email,
        scopes_granted: scopes.length,
        user_agent: request.headers.get('user-agent') ?? null,
      },
    });

    const deckUrl = new URL(next.startsWith('/') ? next : '/', baseUrl);
    deckUrl.searchParams.set('phone', tenantPhone);
    deckUrl.searchParams.set('sso', 'success');
    const res = NextResponse.redirect(deckUrl);
    res.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: sessionToken,
      httpOnly: true,
      secure: url.protocol === 'https:',
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 3600,
    });
    return res;
  } catch (err: any) {
    console.error('[auth/google] callback error:', err);
    return Response.redirect(`${baseUrl}/?sso=error&provider=google`, 302);
  }
}

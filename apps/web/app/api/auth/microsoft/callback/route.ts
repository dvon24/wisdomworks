/**
 * SSO sign-in via Microsoft — callback. Phase 1.
 *
 * Mirrors /api/auth/google/callback. Looks up the tenant by the
 * authenticated Microsoft email, refreshes the connection rows, signs
 * a ww_session cookie and redirects to the deck. Routes new users
 * (no tenant for this email) back to the landing page with the email
 * pre-filled.
 */

import { NextResponse } from 'next/server';
import { signSessionToken, SESSION_COOKIE_NAME } from '../../../_lib/api-auth';
import { saveOAuthConnection, callbackBaseUrl } from '../../../oauth/_lib/save-connection';
import { logAuditEvent } from '../../../_lib/audit-log';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

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
    return Response.redirect(`${baseUrl}/?sso=denied&provider=microsoft`, 302);
  }
  if (!code || !state) return new Response('Missing code or state', { status: 400 });

  const decoded = decodeURIComponent(state);
  const pipeIdx = decoded.indexOf('|');
  const next = pipeIdx >= 0 ? decoded.slice(pipeIdx + 1) : '/';

  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return new Response('Microsoft OAuth not configured', { status: 500 });
  }

  const redirectUri = `${baseUrl}/api/auth/microsoft/callback`;

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
      console.error('[auth/microsoft] token exchange failed:', await tokenRes.text());
      return Response.redirect(`${baseUrl}/?sso=error&provider=microsoft`, 302);
    }
    const tokens = await tokenRes.json();

    const userRes = await fetch(MS_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const user = await userRes.json();
    const email: string | undefined = user.mail ?? user.userPrincipalName;
    if (!email) {
      console.error('[auth/microsoft] no email on /me response:', user);
      return Response.redirect(`${baseUrl}/?sso=error&provider=microsoft`, 302);
    }

    const lowerEmail = email.toLowerCase();
    const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString();
    const scopes: string[] = (tokens.scope ?? '').split(' ').filter(Boolean);

    let tenantPhone: string | null = null;
    if (SUPABASE_URL && SUPABASE_KEY) {
      try {
        const lookupRes = await fetch(
          `${SUPABASE_URL}/rest/v1/oauth_connections?account_email=eq.${encodeURIComponent(lowerEmail)}&order=updated_at.desc&limit=1&select=phone_number`,
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
        console.warn('[auth/microsoft] tenant lookup failed:', err);
      }
    }

    if (!tenantPhone) {
      const websiteBase = process.env.NEXT_PUBLIC_WEBSITE_URL ?? baseUrl;
      const signupUrl = new URL(websiteBase);
      signupUrl.searchParams.set('signup_email', lowerEmail);
      signupUrl.searchParams.set('signup_name', String(user.displayName ?? ''));
      signupUrl.searchParams.set('signup_provider', 'microsoft');
      return Response.redirect(signupUrl.toString(), 302);
    }

    for (const { service, scopeNeedle } of SERVICE_SCOPE_MAP) {
      const granted = scopes.some((s) => s.includes(scopeNeedle));
      if (!granted) continue;
      await saveOAuthConnection({
        phone_number: tenantPhone,
        provider: 'microsoft',
        service,
        account_email: email,
        account_name: user.displayName,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: expiresAt,
        scopes,
      });
    }

    const sessionToken = await signSessionToken(tenantPhone);

    void logAuditEvent({
      tenantPhone,
      actor: tenantPhone,
      actorType: 'owner',
      action: 'auth.session_redeemed',
      resource: '/api/auth/microsoft/callback',
      outcome: 'success',
      payload: {
        sso_provider: 'microsoft',
        sso_email: lowerEmail,
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
    console.error('[auth/microsoft] callback error:', err);
    return Response.redirect(`${baseUrl}/?sso=error&provider=microsoft`, 302);
  }
}

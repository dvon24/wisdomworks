/**
 * Meta OAuth callback — Facebook Login for Business with Instagram permissions.
 *
 * Ported from apps/website 2026-05-14.
 *
 * Flow:
 *   1. Exchange code for short-lived user access token
 *   2. Upgrade to long-lived (~60 days)
 *   3. Find a Facebook Page with a linked Instagram Business Account
 *   4. Store the Page access token (used for IG API calls on behalf of the IG account)
 */

import { NextResponse } from 'next/server';
import { verifySessionToken } from '../../../_lib/api-auth';
import { saveOAuthConnection, callbackBaseUrl } from '../../_lib/save-connection';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const FB_TOKEN_URL = 'https://graph.facebook.com/v25.0/oauth/access_token';
const FB_USER_URL = 'https://graph.facebook.com/v25.0/me';
const FB_PAGES_URL = 'https://graph.facebook.com/v25.0/me/accounts';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const baseUrl = callbackBaseUrl(request);

  if (error) {
    return Response.redirect(`${baseUrl}/?oauth=denied&provider=meta`, 302);
  }
  if (!code || !state) return new Response('Missing code or state', { status: 400 });

  const verified = await verifySessionToken(state);
  if (!verified) return new Response('Invalid or expired state — open the Connect link again', { status: 401 });

  const clientId = process.env.META_CLIENT_ID;
  const clientSecret = process.env.META_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return new Response('Meta OAuth not configured', { status: 500 });
  }

  const redirectUri = `${baseUrl}/api/oauth/meta/callback`;
  const cleanPhone = verified.phone.replace(/[\s\-+()]/g, '');

  try {
    // 1. short-lived token
    const tokenUrl = new URL(FB_TOKEN_URL);
    tokenUrl.searchParams.set('client_id', clientId);
    tokenUrl.searchParams.set('client_secret', clientSecret);
    tokenUrl.searchParams.set('redirect_uri', redirectUri);
    tokenUrl.searchParams.set('code', code);
    const tokenRes = await fetch(tokenUrl.toString());
    if (!tokenRes.ok) {
      console.error('[meta-oauth] token exchange failed:', await tokenRes.text());
      return Response.redirect(`${baseUrl}/?oauth=error&provider=meta`, 302);
    }
    const shortToken = await tokenRes.json();

    // 2. upgrade to long-lived
    const longUrl = new URL(FB_TOKEN_URL);
    longUrl.searchParams.set('grant_type', 'fb_exchange_token');
    longUrl.searchParams.set('client_id', clientId);
    longUrl.searchParams.set('client_secret', clientSecret);
    longUrl.searchParams.set('fb_exchange_token', shortToken.access_token);
    const longRes = await fetch(longUrl.toString());
    const longToken = await longRes.json();
    const userToken: string = longToken.access_token ?? shortToken.access_token;
    const expiresIn: number = longToken.expires_in ?? 5184000;  // ~60 days

    // 3. user info
    const userRes = await fetch(`${FB_USER_URL}?fields=id,name&access_token=${userToken}`);
    const user = await userRes.json();

    // 4. find a Page with linked IG business account
    const pagesRes = await fetch(`${FB_PAGES_URL}?fields=id,name,access_token,instagram_business_account&access_token=${userToken}`);
    const pagesData = await pagesRes.json();
    const pageWithIg = (pagesData.data ?? []).find((p: any) => p.instagram_business_account);

    let igUsername: string | undefined;
    let igAccountId: string | undefined;
    let pageAccessToken: string | undefined;
    let pageId: string | undefined;

    if (pageWithIg) {
      pageAccessToken = pageWithIg.access_token;
      pageId = pageWithIg.id;
      igAccountId = pageWithIg.instagram_business_account.id;
      const igRes = await fetch(
        `https://graph.facebook.com/v25.0/${igAccountId}?fields=username,name&access_token=${pageAccessToken}`,
      );
      const ig = await igRes.json();
      igUsername = ig.username ?? ig.name;
    }

    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    await saveOAuthConnection({
      phone_number: cleanPhone,
      provider: 'meta',
      service: 'instagram',
      account_email: igUsername ?? user.name,
      account_name: igUsername ?? user.name,
      access_token: pageAccessToken ?? userToken,
      expires_at: expiresAt,
      metadata: {
        instagram_account_id: igAccountId,
        page_id: pageId,
        facebook_user_id: user.id,
        user_access_token: userToken,
      },
    });

    console.log(`[meta-oauth] Connected ${igUsername ? `@${igUsername}` : user.name} for ${cleanPhone}`);

    return Response.redirect(
      `${baseUrl}/?oauth=success&provider=meta&services=instagram&email=${encodeURIComponent(igUsername ?? user.name)}`,
      302,
    );
  } catch (err) {
    console.error('[meta-oauth] callback error:', err);
    return Response.redirect(`${baseUrl}/?oauth=error&provider=meta`, 302);
  }
}

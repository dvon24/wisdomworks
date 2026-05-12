/**
 * Owner deck-login redeem.
 *
 * Flow:
 *   1. Owner texts Sophia → Sophia mints a magic-link via issue_deck_login
 *      and sends it back via WhatsApp
 *   2. Owner taps the link → GET /api/auth/deck/redeem?token=<...>
 *   3. This route verifies the token and sets the ww_session cookie, then
 *      redirects to the deck root.
 *
 * The magic-link token is itself a session token — we just don't deliver
 * it as a cookie until the redirect.
 */

import { NextResponse } from 'next/server';
import { verifySessionToken, SESSION_COOKIE_NAME } from '../../../_lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  if (!token) return new Response('Missing token', { status: 400 });

  const verified = await verifySessionToken(token);
  if (!verified) {
    return new Response('Invalid or expired login link. Ask Sophia for a fresh one.', { status: 401 });
  }

  // Redirect to the deck and set the cookie. 30-day persistence.
  const deckUrl = new URL('/', url.origin);
  deckUrl.searchParams.set('phone', verified.phone);
  const res = NextResponse.redirect(deckUrl);
  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: url.protocol === 'https:',
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 3600,
  });
  return res;
}

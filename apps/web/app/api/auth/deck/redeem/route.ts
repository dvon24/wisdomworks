/**
 * Owner deck-login redeem.
 *
 * Flow:
 *   1. Owner texts Iris → Iris mints a magic-link via issue_deck_login
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
import { logAuditEvent } from '../../../_lib/audit-log';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  if (!token) return new Response('Missing token', { status: 400 });

  const verified = await verifySessionToken(token);
  if (!verified) {
    // Story 6.4 — log rejected redemptions. We can't tie them to a tenant
    // (token didn't verify) but we still record the attempt under
    // 'unknown' so a pattern of rejected attempts is auditable. Skipped
    // here to keep the audit log strictly tenant-scoped — these go to
    // server logs only via the 401 response.
    return new Response('Invalid or expired login link. Ask Iris for a fresh one.', { status: 401 });
  }

  // Story 6.4 — every successful login is a security event. Append to the
  // hash-chained audit log so the tenant has a tamper-evident record of
  // who logged into their deck and when. Foundation for SOC 2 / HIPAA
  // access-log requirements.
  void logAuditEvent({
    tenantPhone: verified.phone,
    actor: verified.phone,
    actorType: 'owner',
    action: 'auth.session_redeemed',
    resource: '/api/auth/deck/redeem',
    outcome: 'success',
    payload: {
      session_expires_in_days: 30,
      // User agent + IP are useful for security review but PII-adjacent.
      // The audit helper redacts free-text by default so the IP gets [IP].
      user_agent: request.headers.get('user-agent') ?? null,
    },
  });

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

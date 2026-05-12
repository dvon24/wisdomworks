/**
 * Mindbody OAuth — initiates the staff auth flow.
 *
 * Mindbody requires the merchant's SiteID and staff credentials. The
 * UX is a two-step form rather than a pure redirect:
 *   1. Owner enters their Mindbody SiteID (their unique site identifier)
 *   2. Owner enters staff username + password (Mindbody trades these
 *      for a UserToken on the API server side)
 *
 * For MVP, this route generates a one-tap form URL on the deck where
 * the owner pastes SiteID + creds. Once Mindbody approves the partner
 * app, we can move to their hosted OAuth.
 *
 * Required env:
 *   - MINDBODY_API_KEY (from the approved partner app)
 *   - NEXT_PUBLIC_APP_BASE_URL
 */

import { signSessionToken } from '../../_lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const phone = url.searchParams.get('phone');
  if (!phone) return new Response('phone required', { status: 400 });

  if (!process.env.MINDBODY_API_KEY) {
    return new Response('Mindbody integration not yet activated (partner app pending approval).', { status: 503 });
  }

  // Redirect to a connection form on the deck (or the website's
  // ConnectTools flow). Owner enters SiteID + staff creds there.
  const state = await signSessionToken(phone);
  const deckBase = process.env.NEXT_PUBLIC_APP_BASE_URL || 'https://wisdomworks.vercel.app';
  return Response.redirect(`${deckBase}/?connect=mindbody&state=${encodeURIComponent(state)}`, 302);
}

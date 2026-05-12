/**
 * Square OAuth callback.
 *
 * GET /api/oauth/square/callback?code=...&state=...
 *   1. Verify state HMAC → recover tenant_phone
 *   2. Exchange code for access_token + refresh_token + merchant_id
 *   3. Persist to oauth_connections (service='booking', provider='square')
 *   4. Kick off an initial customer sync (fire-and-forget)
 *   5. Redirect owner back to the deck Connections tab
 */

import { NextResponse } from 'next/server';
import { verifySessionToken } from '../../../_lib/api-auth';
import { exchangeSquareCode } from '../../../_lib/booking-adapters/square';
import { encryptToken } from '@wisdomworks/shared';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const errParam = url.searchParams.get('error');

  if (errParam) {
    console.warn('[square-oauth] user-rejected:', errParam);
    const deckBase = process.env.NEXT_PUBLIC_APP_BASE_URL || 'https://wisdomworks.vercel.app';
    return NextResponse.redirect(`${deckBase}/?oauth=denied&provider=square`);
  }

  if (!code || !state) return new Response('Missing code or state', { status: 400 });

  const verified = await verifySessionToken(state);
  if (!verified) return new Response('Invalid state — open the link again from your deck', { status: 401 });

  const tokens = await exchangeSquareCode(code);
  if (!tokens?.access_token) return new Response('Square token exchange failed', { status: 502 });

  // Persist as an oauth_connection (service='booking')
  if (SUPABASE_URL && SUPABASE_KEY) {
    try {
      const encryptedAccess = await encryptToken(tokens.access_token);
      const encryptedRefresh = tokens.refresh_token ? await encryptToken(tokens.refresh_token) : null;
      const cleanPhone = verified.phone.replace(/[\s\-+()]/g, '');
      const body = {
        phone_number: cleanPhone,
        provider: 'square',
        service: 'booking',
        account_name: tokens.merchant_id,
        access_token: encryptedAccess,
        refresh_token: encryptedRefresh,
        token_expires_at: tokens.expires_at ?? null,
        scopes: ['CUSTOMERS_READ', 'CUSTOMERS_WRITE', 'APPOINTMENTS_READ', 'APPOINTMENTS_WRITE', 'MERCHANT_PROFILE_READ'],
        status: 'active',
        metadata: { merchant_id: tokens.merchant_id, env: process.env.SQUARE_ENV ?? 'sandbox' },
      };
      const res = await fetch(`${SUPABASE_URL}/rest/v1/oauth_connections?on_conflict=phone_number,provider,service`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        console.error('[square-oauth] connection save failed:', await res.text());
      }

      // Fire-and-forget initial customer sync so the connection lights up
      // with data immediately. Don't block the redirect on it.
      (async () => {
        try {
          const base = process.env.NEXT_PUBLIC_APP_BASE_URL || 'https://wisdomworks.vercel.app';
          await fetch(`${base}/api/cron/booking-sync?phone=${encodeURIComponent(cleanPhone)}`, {
            headers: { Authorization: `Bearer ${process.env.CRON_SECRET ?? ''}` },
          });
        } catch {}
      })();
    } catch (err) {
      console.error('[square-oauth] persistence error:', err);
    }
  }

  const deckBase = process.env.NEXT_PUBLIC_APP_BASE_URL || 'https://wisdomworks.vercel.app';
  return NextResponse.redirect(`${deckBase}/?oauth=success&provider=square&service=booking`);
}

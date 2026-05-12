/**
 * Calendly OAuth callback. Mirrors the Square flow.
 *
 * GET /api/oauth/calendly/callback?code=…&state=…
 */

import { NextResponse } from 'next/server';
import { verifySessionToken } from '../../../_lib/api-auth';
import { exchangeCalendlyCode } from '../../../_lib/booking-adapters/calendly';
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
    console.warn('[calendly-oauth] user-rejected:', errParam);
    const deckBase = process.env.NEXT_PUBLIC_APP_BASE_URL || 'https://wisdomworks.vercel.app';
    return NextResponse.redirect(`${deckBase}/?oauth=denied&provider=calendly`);
  }

  if (!code || !state) return new Response('Missing code or state', { status: 400 });

  const verified = await verifySessionToken(state);
  if (!verified) return new Response('Invalid state — open the link again from your deck', { status: 401 });

  const tokens = await exchangeCalendlyCode(code);
  if (!tokens?.access_token) return new Response('Calendly token exchange failed', { status: 502 });

  if (SUPABASE_URL && SUPABASE_KEY) {
    try {
      const encryptedAccess = await encryptToken(tokens.access_token);
      const encryptedRefresh = tokens.refresh_token ? await encryptToken(tokens.refresh_token) : null;
      const cleanPhone = verified.phone.replace(/[\s\-+()]/g, '');
      const expiresAt = tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
        : null;
      const body = {
        phone_number: cleanPhone,
        provider: 'calendly',
        service: 'booking',
        account_name: tokens.owner ?? null,
        access_token: encryptedAccess,
        refresh_token: encryptedRefresh,
        token_expires_at: expiresAt,
        scopes: ['default'],
        status: 'active',
        metadata: { owner: tokens.owner, organization: tokens.organization },
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
      if (!res.ok) console.error('[calendly-oauth] connection save failed:', await res.text());

      // Fire initial sync
      (async () => {
        try {
          const base = process.env.NEXT_PUBLIC_APP_BASE_URL || 'https://wisdomworks.vercel.app';
          await fetch(`${base}/api/cron/booking-sync?phone=${encodeURIComponent(cleanPhone)}`, {
            headers: { Authorization: `Bearer ${process.env.CRON_SECRET ?? ''}` },
          });
        } catch {}
      })();
    } catch (err) {
      console.error('[calendly-oauth] persistence error:', err);
    }
  }

  const deckBase = process.env.NEXT_PUBLIC_APP_BASE_URL || 'https://wisdomworks.vercel.app';
  return NextResponse.redirect(`${deckBase}/?oauth=success&provider=calendly&service=booking`);
}

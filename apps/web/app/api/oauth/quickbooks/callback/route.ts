/**
 * QuickBooks OAuth callback.
 *
 * GET /api/oauth/quickbooks/callback?code=…&state=…&realmId=…
 *
 * Intuit returns the realmId as a query param on the callback URL — we
 * need it for every subsequent API call, so we capture it here and
 * persist it on the connection metadata.
 */

import { NextResponse } from 'next/server';
import { verifySessionToken } from '../../../_lib/api-auth';
import {
  exchangeQuickBooksCode,
  saveQuickBooksConnection,
  fetchCompanyInfo,
} from '../../../_lib/integrations/quickbooks';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const realmId = url.searchParams.get('realmId');
  const errParam = url.searchParams.get('error');

  const deckBase = process.env.NEXT_PUBLIC_APP_BASE_URL || 'https://wisdomworks.vercel.app';

  if (errParam) {
    console.warn('[qbo-oauth] user-rejected:', errParam);
    return NextResponse.redirect(`${deckBase}/?oauth=denied&provider=quickbooks`);
  }
  if (!code || !state || !realmId) {
    return new Response('Missing code, state, or realmId', { status: 400 });
  }

  const verified = await verifySessionToken(state);
  if (!verified) return new Response('Invalid state — open the link again from your deck', { status: 401 });

  const tokens = await exchangeQuickBooksCode({ code, realmId });
  if (!tokens?.access_token) return new Response('QuickBooks token exchange failed', { status: 502 });

  // Best-effort: pull company name so the connection displays as
  // "QuickBooks — Acme Plumbing" instead of a raw realm id
  let companyName: string | undefined;
  try {
    const info = await fetchCompanyInfo({ accessToken: tokens.access_token, realmId });
    companyName = info?.CompanyName ?? info?.LegalName;
  } catch {}

  await saveQuickBooksConnection({ tenantPhone: verified.phone, tokens, companyName });

  return NextResponse.redirect(`${deckBase}/?oauth=success&provider=quickbooks&service=accounting`);
}

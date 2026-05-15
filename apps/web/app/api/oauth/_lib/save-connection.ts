/**
 * Shared OAuth connection persistence for the deck app's OAuth callbacks.
 *
 * Ported 2026-05-14 from apps/website/api/oauth/_lib/store.ts because
 * apps/web is the only project actually deployed at wisdomworks.vercel.app,
 * but the Google/Microsoft/Meta OAuth routes had only ever been written
 * in apps/website (not deployed) → all those Connect buttons 404'd in
 * production. Moving the routes here so they're served by the same
 * deployment that serves the deck.
 *
 * Uses the shared encryptToken from @wisdomworks/shared so tokens are
 * encrypted at rest, consistent with everywhere else.
 */

import { encryptToken, computeOAuthConnectionHmac } from '@wisdomworks/shared';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export interface OAuthConnectionInsert {
  phone_number: string;
  provider: string;
  service: string;
  account_email?: string;
  account_name?: string;
  access_token: string;
  refresh_token?: string;
  expires_at?: string;
  scopes?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Upsert an OAuth connection row. Encrypts tokens before write. Idempotent
 * by (phone_number, provider, service) — re-running with the same triple
 * replaces the prior row's tokens + scopes + status.
 */
export async function saveOAuthConnection(conn: OAuthConnectionInsert): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.warn('[oauth-save] Supabase not configured');
    return false;
  }

  const encryptedAccess = await encryptToken(conn.access_token);
  const encryptedRefresh = conn.refresh_token ? await encryptToken(conn.refresh_token) : null;

  // Story 6.8 Phase B — HMAC the row at write time. If HMAC_ROW_SECRET is
  // missing the helper throws; we log and write unsigned (legacy path).
  let hmac: string | null = null;
  try {
    hmac = computeOAuthConnectionHmac({
      phone_number: conn.phone_number,
      provider: conn.provider,
      service: conn.service,
      account_email: conn.account_email ?? null,
      access_token: encryptedAccess,
      refresh_token: encryptedRefresh,
      status: 'active',
    });
  } catch (err) {
    console.warn('[oauth-save] HMAC compute failed (writing unsigned):', err);
  }

  const payload = {
    phone_number: conn.phone_number,
    provider: conn.provider,
    service: conn.service,
    account_email: conn.account_email ?? null,
    account_name: conn.account_name ?? null,
    access_token: encryptedAccess,
    refresh_token: encryptedRefresh,
    expires_at: conn.expires_at ?? null,
    scopes: conn.scopes ?? [],
    metadata: conn.metadata ?? {},
    status: 'active',
    hmac,
    updated_at: new Date().toISOString(),
  };

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/oauth_connections?on_conflict=phone_number,provider,service`,
    {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(payload),
    },
  );

  if (!res.ok) {
    const error = await res.text();
    console.error('[oauth-save] Save failed:', res.status, error);
    return false;
  }
  console.log(`[oauth-save] Saved ${conn.provider}/${conn.service} for ${conn.phone_number}`);
  return true;
}

/**
 * Build the absolute callback URL for an OAuth provider. Uses the
 * request URL's origin so dev / staging / prod all just work.
 */
export function callbackBaseUrl(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

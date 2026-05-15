/**
 * Persist a refreshed OAuth access token back to oauth_connections.
 *
 * Hook called from callGoogleWithRefresh's onTokenRefreshed callback when
 * a 401 → refresh → retry cycle succeeds. Without this, every Google API
 * call refreshes from scratch instead of using the cached fresh token,
 * AND the encrypted-but-stale token sits in the DB indefinitely.
 *
 * Encrypts the new access_token with the existing TOKEN_ENCRYPTION_KEY
 * before write, consistent with how OAuth callbacks store the original.
 *
 * Updates:
 *   - access_token (re-encrypted)
 *   - expires_at  (now + expires_in seconds)
 *   - status      (clamped back to 'active' if it had drifted)
 *   - last_rotated_at (Story 6.3 column — drives the 90-day reminder cron)
 *   - hmac        (Story 6.8 — recomputed when row contents change)
 *
 * Fire-and-forget — never blocks the API response. If persistence fails
 * the next call just refreshes again, which is wasteful but not broken.
 */

import { encryptToken, computeOAuthConnectionHmac } from '@wisdomworks/shared';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function persistRefreshedAccessToken(args: {
  phoneNumber: string;
  provider: string;
  service: string;
  newAccessToken: string;
  expiresAtIso: string;
}): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    const cleanPhone = args.phoneNumber.replace(/[\s\-+()]/g, '');

    // Load the existing row to recompute the HMAC over the updated state.
    const loadRes = await fetch(
      `${SUPABASE_URL}/rest/v1/oauth_connections?phone_number=eq.${cleanPhone}&provider=eq.${args.provider}&service=eq.${args.service}&select=*&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
    );
    if (!loadRes.ok) {
      console.warn('[oauth-token-store] load failed:', loadRes.status);
      return;
    }
    const rows = await loadRes.json();
    const existing = rows?.[0];
    if (!existing) {
      console.warn(`[oauth-token-store] no row found for ${cleanPhone}/${args.provider}/${args.service}`);
      return;
    }

    const encryptedAccessToken = await encryptToken(args.newAccessToken);

    // Recompute HMAC if the secret is configured. If not, skip — the row
    // stays signed with the old HMAC which will fail verification next read,
    // surfacing as a "tampered" signal. That's a deploy-config bug, not a
    // security bug, so we log loudly.
    let newHmac: string | null = null;
    try {
      newHmac = computeOAuthConnectionHmac({
        phone_number: cleanPhone,
        provider: args.provider,
        service: args.service,
        account_email: existing.account_email,
        access_token: encryptedAccessToken,
        refresh_token: existing.refresh_token,
        status: 'active',
      });
    } catch (err) {
      console.warn('[oauth-token-store] HMAC compute skipped (HMAC_ROW_SECRET unset?):', err);
    }

    const patchBody: Record<string, unknown> = {
      access_token: encryptedAccessToken,
      expires_at: args.expiresAtIso,
      status: 'active',
      last_rotated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (newHmac) patchBody.hmac = newHmac;

    const patchRes = await fetch(
      `${SUPABASE_URL}/rest/v1/oauth_connections?phone_number=eq.${cleanPhone}&provider=eq.${args.provider}&service=eq.${args.service}`,
      {
        method: 'PATCH',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify(patchBody),
      },
    );
    if (!patchRes.ok) {
      console.warn('[oauth-token-store] patch failed:', patchRes.status, await patchRes.text());
    }
  } catch (err) {
    console.warn('[oauth-token-store] exception:', err);
  }
}

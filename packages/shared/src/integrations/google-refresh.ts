/**
 * Google access-token refresh helper. Adapters call this on a 401 to mint
 * a new access token using the stored refresh token, then retry the API
 * call with the new token. Caller is responsible for persisting the new
 * access token back to oauth_connections so the NEXT call uses the
 * refreshed token without round-tripping Google again.
 *
 * Why this exists 2026-05-14: Google access tokens last only ~1 hour.
 * Without refresh, every Google integration (Gmail, Calendar, Drive,
 * Search Console, Analytics) returns 401 after the first hour. The old
 * codebase had no refresh wired anywhere — calls quietly stopped
 * working ~1hr after each consent.
 *
 * Requires `offline_access` to have been granted at consent (our scope
 * list includes `access_type=offline` + `prompt=consent` which together
 * guarantee a refresh_token comes back).
 */

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

export interface RefreshedGoogleToken {
  accessToken: string;
  expiresInSeconds: number;
  /** ISO timestamp at which the new token expires. */
  expiresAtIso: string;
}

/**
 * Exchange a refresh token for a new access token.
 * Returns null on any failure (caller should fall back to surfacing
 * a "reconnect Google" message to the owner).
 */
export async function refreshGoogleAccessToken(
  refreshToken: string,
): Promise<RefreshedGoogleToken | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret || !refreshToken) return null;

  try {
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    if (!res.ok) {
      console.warn('[google-refresh] token refresh failed:', res.status, await res.text());
      return null;
    }
    const data = await res.json();
    const expiresIn = data.expires_in ?? 3600;
    return {
      accessToken: data.access_token,
      expiresInSeconds: expiresIn,
      expiresAtIso: new Date(Date.now() + expiresIn * 1000).toISOString(),
    };
  } catch (err) {
    console.warn('[google-refresh] exception:', err);
    return null;
  }
}

/**
 * Wrap a Google API call so that a 401 response automatically refreshes
 * the access token and retries ONCE. The caller provides:
 *   - the initial access token (decrypted)
 *   - the refresh token (decrypted)
 *   - a function that takes an access token and runs the API call
 *
 * Returns the API response. If the refresh fails or the retry still 401s,
 * the original 401 is returned so the adapter can surface the right
 * "reconnect Google" error to the owner.
 *
 * Side effect: when refresh succeeds, calls onTokenRefreshed (optional)
 * so the caller can persist the new token to oauth_connections. Fire-
 * and-forget — does NOT block the retry on the persist.
 */
export async function callGoogleWithRefresh<T extends Response>(
  args: {
    accessToken: string;
    refreshToken: string | null;
    call: (accessToken: string) => Promise<T>;
    onTokenRefreshed?: (newAccessToken: string, expiresAtIso: string) => void | Promise<void>;
  },
): Promise<T> {
  const first = await args.call(args.accessToken);
  if (first.status !== 401 || !args.refreshToken) return first;

  const refreshed = await refreshGoogleAccessToken(args.refreshToken);
  if (!refreshed) return first;  // refresh failed — return the original 401

  // Fire-and-forget persist (don't block the retry).
  if (args.onTokenRefreshed) {
    void Promise.resolve(args.onTokenRefreshed(refreshed.accessToken, refreshed.expiresAtIso));
  }

  return args.call(refreshed.accessToken);
}

/**
 * Convenience wrapper: takes an IntegrationContext-shaped object + a URL
 * and runs a Google API fetch with auto-refresh on 401. Lets adapters
 * replace `fetch(url, { headers: { Authorization: \`Bearer ${ctx.accessToken}\` } })`
 * with `googleFetch(ctx, url)` while keeping the same single-line shape.
 *
 * Caller can pass `init` for non-GET methods (POST/PATCH body, etc.) — the
 * Authorization header is set automatically; if the caller's init also has
 * headers they're merged with the Authorization header taking precedence.
 */
export async function googleFetch(
  ctx: {
    accessToken: string;
    refreshToken?: string | null;
    onTokenRefreshed?: (newAccessToken: string, expiresAtIso: string) => void | Promise<void>;
  },
  url: string,
  init?: RequestInit,
): Promise<Response> {
  return callGoogleWithRefresh({
    accessToken: ctx.accessToken,
    refreshToken: ctx.refreshToken ?? null,
    onTokenRefreshed: ctx.onTokenRefreshed,
    call: (token) => fetch(url, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        Authorization: `Bearer ${token}`,
      },
    }),
  });
}

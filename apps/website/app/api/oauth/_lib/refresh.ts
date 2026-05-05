/**
 * Token refresh — exchanges a refresh_token for a new access_token when expired.
 * Called by API helpers (Gmail, Calendar) before making authenticated requests.
 */

import { saveConnection, type OAuthConnection } from './store';

const PROVIDER_TOKEN_URLS = {
  google: 'https://oauth2.googleapis.com/token',
  microsoft: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
  meta: 'https://graph.facebook.com/v25.0/oauth/access_token',
} as const;

/**
 * Refresh a connection's access token if expired. Returns the (possibly updated) connection.
 */
export async function ensureFreshToken(conn: OAuthConnection): Promise<OAuthConnection> {
  if (!conn.expires_at) return conn;

  const expiresAt = new Date(conn.expires_at).getTime();
  const now = Date.now();

  // Return as-is if expires more than 5 min from now
  if (expiresAt - now > 5 * 60 * 1000) return conn;

  if (!conn.refresh_token) {
    console.warn(`[oauth-refresh] No refresh token for ${conn.provider}/${conn.service}`);
    return conn;
  }

  const provider = conn.provider as keyof typeof PROVIDER_TOKEN_URLS;
  const tokenUrl = PROVIDER_TOKEN_URLS[provider];
  if (!tokenUrl) return conn; // Apple doesn't use OAuth refresh

  const clientId = process.env[`${provider.toUpperCase()}_CLIENT_ID`];
  const clientSecret = process.env[`${provider.toUpperCase()}_CLIENT_SECRET`];
  if (!clientId || !clientSecret) {
    console.error(`[oauth-refresh] Missing credentials for ${provider}`);
    return conn;
  }

  try {
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: conn.refresh_token,
        grant_type: 'refresh_token',
      }),
    });

    if (!res.ok) {
      console.error(`[oauth-refresh] Refresh failed for ${provider}:`, await res.text());
      return conn;
    }

    const data = await res.json();
    const newExpiresAt = new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString();

    const updated: OAuthConnection = {
      ...conn,
      access_token: data.access_token,
      // Some providers return a new refresh_token, some don't — keep the old one if not
      refresh_token: data.refresh_token ?? conn.refresh_token,
      expires_at: newExpiresAt,
    };

    await saveConnection(updated);
    console.log(`[oauth-refresh] Refreshed ${provider}/${conn.service} for ${conn.phone_number}`);
    return updated;
  } catch (err) {
    console.error(`[oauth-refresh] Error refreshing ${provider}:`, err);
    return conn;
  }
}

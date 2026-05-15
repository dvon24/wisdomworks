/**
 * OAuth Connection Store — saves and loads access/refresh tokens per user per service.
 *
 * Tokens stored in Supabase oauth_connections table. Keyed by (phone_number, provider, service).
 *
 * Note: For MVP, tokens stored in plain text within RLS-protected table accessed only by service role.
 * Production should add envelope encryption with a dedicated key vault.
 */

import { decryptToken, encryptToken } from './crypto';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export type Provider = 'google' | 'microsoft' | 'meta' | 'apple' | 'yahoo' | 'imap';
export type Service = 'email' | 'calendar' | 'instagram' | 'drive' | 'search_console' | 'analytics' | 'sheets';

export interface OAuthConnection {
  id?: string;
  phone_number: string;
  provider: Provider;
  service: Service;
  account_email?: string;
  account_name?: string;
  access_token: string;
  refresh_token?: string;
  expires_at?: string;
  scopes?: string[];
  metadata?: Record<string, unknown>;
  status?: 'active' | 'expired' | 'revoked';
}

/**
 * Save or update an OAuth connection.
 * Upserts by (phone_number, provider, service).
 */
export async function saveConnection(conn: OAuthConnection): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.warn('[oauth-store] Supabase not configured');
    return false;
  }

  // Encrypt sensitive fields before storage
  const encrypted = {
    ...conn,
    access_token: await encryptToken(conn.access_token),
    refresh_token: conn.refresh_token ? await encryptToken(conn.refresh_token) : undefined,
    status: conn.status ?? 'active',
    updated_at: new Date().toISOString(),
  };

  const res = await fetch(`${SUPABASE_URL}/rest/v1/oauth_connections`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(encrypted),
  });

  if (!res.ok) {
    const error = await res.text();
    console.error('[oauth-store] Save failed:', res.status, error);
    return false;
  }

  console.log(`[oauth-store] Saved ${conn.provider}/${conn.service} for ${conn.phone_number}`);
  return true;
}

/**
 * Load all connections for a phone number.
 */
export async function loadConnections(phoneNumber: string): Promise<OAuthConnection[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];

  const cleanPhone = phoneNumber.replace(/[\s\-\+\(\)]/g, '');
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/oauth_connections?phone_number=eq.${cleanPhone}&status=eq.active&select=*`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    },
  );

  if (!res.ok) return [];
  const rows = (await res.json()) as OAuthConnection[];
  // Decrypt tokens on read
  return Promise.all(rows.map(decryptConnection));
}

/**
 * Get a specific connection by provider + service.
 */
export async function getConnection(
  phoneNumber: string,
  provider: Provider,
  service: Service,
): Promise<OAuthConnection | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;

  const cleanPhone = phoneNumber.replace(/[\s\-\+\(\)]/g, '');
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/oauth_connections?phone_number=eq.${cleanPhone}&provider=eq.${provider}&service=eq.${service}&select=*`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    },
  );

  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0] ? decryptConnection(rows[0]) : null;
}

async function decryptConnection(conn: OAuthConnection): Promise<OAuthConnection> {
  return {
    ...conn,
    access_token: await decryptToken(conn.access_token),
    refresh_token: conn.refresh_token ? await decryptToken(conn.refresh_token) : undefined,
  };
}

/**
 * Generate a CSRF state token for the OAuth flow.
 * Encodes the user's phone number so the callback knows who's connecting.
 */
export function generateState(phoneNumber: string): string {
  const cleanPhone = phoneNumber.replace(/[\s\-\+\(\)]/g, '');
  const random = crypto.randomUUID();
  return Buffer.from(JSON.stringify({ phone: cleanPhone, nonce: random, ts: Date.now() })).toString('base64url');
}

/**
 * Decode a state token from the OAuth callback.
 * Returns null if invalid or expired (>15 min old).
 */
export function decodeState(state: string): { phone: string } | null {
  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64url').toString());
    if (!decoded.phone || !decoded.ts) return null;
    if (Date.now() - decoded.ts > 15 * 60 * 1000) return null; // 15 min expiry
    return { phone: decoded.phone };
  } catch {
    return null;
  }
}

/**
 * Get the base URL for OAuth callbacks.
 * Uses request host in production, localhost:3001 in dev.
 */
export function getCallbackBaseUrl(request: Request): string {
  const host = request.headers.get('host') ?? 'localhost:3001';
  const proto = host.includes('localhost') ? 'http' : 'https';
  return `${proto}://${host}`;
}

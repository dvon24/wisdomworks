/**
 * OAuth Connection Loader — fetches a user's OAuth connections from Supabase
 * and decrypts the access/refresh tokens.
 *
 * Used by the WhatsApp webhook and cron jobs to get tokens ready for API calls.
 */

import { decryptToken } from './crypto';
import type { OAuthConnection } from './router';

interface SupabaseConfig {
  url: string;
  serviceKey: string;
}

function getConfig(): SupabaseConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return { url, serviceKey };
}

/** Fetch all active connections for a phone number, with tokens decrypted. */
export async function loadConnectionsForPhone(phoneNumber: string): Promise<OAuthConnection[]> {
  const cfg = getConfig();
  if (!cfg) return [];

  const cleanPhone = phoneNumber.replace(/[\s\-+()]/g, '');
  const res = await fetch(
    `${cfg.url}/rest/v1/oauth_connections?phone_number=eq.${cleanPhone}&status=eq.active&select=*`,
    {
      headers: {
        apikey: cfg.serviceKey,
        Authorization: `Bearer ${cfg.serviceKey}`,
      },
    },
  );
  if (!res.ok) return [];
  const rows = (await res.json()) as Array<OAuthConnection & { access_token: string; refresh_token?: string }>;

  // Decrypt tokens in parallel
  return Promise.all(
    rows.map(async (row) => ({
      ...row,
      access_token: await decryptToken(row.access_token),
      refresh_token: row.refresh_token ? await decryptToken(row.refresh_token) : undefined,
    })),
  );
}

/** Fetch a specific connection (provider + service) for a phone number. */
export async function getConnectionForPhone(
  phoneNumber: string,
  provider: OAuthConnection['provider'],
  service: OAuthConnection['service'],
): Promise<OAuthConnection | null> {
  const cfg = getConfig();
  if (!cfg) return null;

  const cleanPhone = phoneNumber.replace(/[\s\-+()]/g, '');
  const res = await fetch(
    `${cfg.url}/rest/v1/oauth_connections?phone_number=eq.${cleanPhone}&provider=eq.${provider}&service=eq.${service}&status=eq.active&select=*`,
    {
      headers: {
        apikey: cfg.serviceKey,
        Authorization: `Bearer ${cfg.serviceKey}`,
      },
    },
  );
  if (!res.ok) return null;
  const rows = await res.json();
  if (!rows.length) return null;

  const row = rows[0];
  return {
    ...row,
    access_token: await decryptToken(row.access_token),
    refresh_token: row.refresh_token ? await decryptToken(row.refresh_token) : undefined,
  };
}

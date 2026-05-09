/**
 * Lightweight connection writer for the Command Deck.
 *
 * The website's onboarding has a sibling at apps/website/app/api/oauth/_lib/store.ts.
 * This file mirrors just the saveConnection bit so the deck can add new connections
 * (Apple, Yahoo, etc.) without bouncing the user back to onboarding.
 */

import { encryptToken } from '@wisdomworks/shared';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export type Provider = 'google' | 'microsoft' | 'meta' | 'apple' | 'yahoo' | 'imap';
export type Service = 'email' | 'calendar' | 'instagram';

export interface ConnectionInput {
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
}

export async function saveConnection(conn: ConnectionInput): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.warn('[connections] Supabase not configured');
    return false;
  }
  const encrypted = {
    ...conn,
    access_token: await encryptToken(conn.access_token),
    refresh_token: conn.refresh_token ? await encryptToken(conn.refresh_token) : undefined,
    status: 'active',
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
    console.error('[connections] Save failed:', res.status, await res.text());
    return false;
  }
  console.log(`[connections] Saved ${conn.provider}/${conn.service} for ${conn.phone_number}`);
  return true;
}

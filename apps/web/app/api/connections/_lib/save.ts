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

export interface SaveResult {
  ok: boolean;
  error?: string;
}

export async function saveConnection(conn: ConnectionInput): Promise<SaveResult> {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    const msg = 'Supabase URL or service role key not set in env';
    console.warn(`[connections] ${msg}`);
    return { ok: false, error: msg };
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
    const body = await res.text();
    const msg = `Supabase ${res.status}: ${body.slice(0, 300)}`;
    console.error(`[connections] Save failed: ${msg}`);
    return { ok: false, error: msg };
  }
  console.log(`[connections] Saved ${conn.provider}/${conn.service} for ${conn.phone_number}`);
  return { ok: true };
}

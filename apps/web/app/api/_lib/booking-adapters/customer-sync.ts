/**
 * Customer sync — pulls customers from a connected booking provider and
 * upserts them into client_profiles. Provider-agnostic: takes any adapter
 * and runs it.
 *
 * Phase 1 scope (this commit): one-shot + daily cron sync. Each customer
 * upserts via the existing upsert_client_profile RPC so dedup by name+
 * phone works the same as conversational capture.
 *
 * Phase 2 (later): incremental sync using `last_synced_at` to bound
 * the search, plus appointment sync (visits → client_visits).
 */

import { decryptToken } from '@wisdomworks/shared';
import type { BookingAdapter, BookingCustomer } from './index';
import { upsertClientProfile } from '../client-profiles';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

export interface SyncResult {
  ok: boolean;
  fetched: number;
  upserted: number;
  reason?: string;
}

/** Load active booking connections for one tenant (or all if no phone given). */
export async function loadActiveBookingConnections(tenantPhone?: string): Promise<any[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  try {
    const cleanFilter = tenantPhone
      ? `&phone_number=eq.${tenantPhone.replace(/[\s\-+()]/g, '')}`
      : '';
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/oauth_connections?service=eq.booking&status=eq.active${cleanFilter}&select=*`,
      { headers: headers() },
    );
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

/** Mark sync done on a connection (records last_synced_at). */
async function markSynced(connectionId: string, fetched: number): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/oauth_connections?id=eq.${connectionId}`, {
      method: 'PATCH',
      headers: { ...headers(), Prefer: 'return=minimal' },
      body: JSON.stringify({
        last_synced_at: new Date().toISOString(),
        metadata: { last_sync_fetched: fetched },
      }),
    });
  } catch {}
}

/**
 * Run customer sync for one connection. Idempotent — re-upserts safely
 * (the dedup index on client_profiles prevents duplicates).
 */
export async function syncCustomersFromConnection(
  connection: any,
  adapter: BookingAdapter,
): Promise<SyncResult> {
  try {
    const accessToken = await decryptToken(connection.access_token);
    const since = connection.last_synced_at ?? undefined;

    const customers: BookingCustomer[] = await adapter.listCustomers(accessToken, since, {
      merchantId: connection.metadata?.merchant_id,
    });

    let upserted = 0;
    const verticalLabel = await loadTenantVerticalLabel(connection.phone_number);
    for (const c of customers) {
      try {
        const id = await upsertClientProfile({
          tenantPhone: connection.phone_number,
          displayName: c.displayName,
          phone: c.phone,
          email: c.email,
          notes: c.notes,
          verticalLabel: verticalLabel ?? undefined,
          source: 'imported',
          tags: c.tags,
        });
        if (id) upserted++;
      } catch (err) {
        console.warn('[customer-sync] upsert failed for', c.displayName, err);
      }
    }

    await markSynced(connection.id, customers.length);
    console.log(`[customer-sync] ${connection.phone_number} ${adapter.provider}: fetched=${customers.length} upserted=${upserted}`);
    return { ok: true, fetched: customers.length, upserted };
  } catch (err: any) {
    console.warn('[customer-sync] error:', err);
    return { ok: false, fetched: 0, upserted: 0, reason: err?.message ?? String(err) };
  }
}

async function loadTenantVerticalLabel(tenantPhone: string): Promise<string | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${cleanPhone}&select=profile`,
      { headers: headers() },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return rows[0]?.profile?.vertical_template?.label ?? null;
  } catch {
    return null;
  }
}

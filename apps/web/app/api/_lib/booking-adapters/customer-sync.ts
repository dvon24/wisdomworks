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
import { upsertClientProfile, recordClientVisit, findProfileByExternalId } from '../client-profiles';

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
  /** Phase 2 — appointment ingestion. Mirrors the customer counters. */
  appointmentsFetched: number;
  visitsRecorded: number;
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
          externalProvider: adapter.provider,
          externalId: c.externalId,
        });
        if (id) upserted++;
      } catch (err) {
        console.warn('[customer-sync] upsert failed for', c.displayName, err);
      }
    }

    // ─── Phase 2 — appointment ingestion → client_visits ────────────────
    // Pull bookings from 12 months back through 30 days ahead so the visit
    // history immediately reflects the tenant's real activity. Future
    // bookings are intentionally included for the same data shape (Riley's
    // upcoming-bookings tool will read these later).
    let appointmentsFetched = 0;
    let visitsRecorded = 0;
    if (adapter.listAppointments) {
      const now = new Date();
      const fromIso = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString();
      const toIso = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
      try {
        const appointments = await adapter.listAppointments(accessToken, fromIso, toIso, {
          merchantId: connection.metadata?.merchant_id,
        });
        appointmentsFetched = appointments.length;
        for (const a of appointments) {
          if (!a.customerExternalId || !a.startAt) continue;
          // Only count completed/booked appointments — skip cancellations
          // for the visit log (cancellations might be a separate signal
          // we surface later).
          if (a.status === 'cancelled') continue;
          try {
            const profileId = await findProfileByExternalId({
              tenantPhone: connection.phone_number,
              externalProvider: adapter.provider,
              externalId: a.customerExternalId,
            });
            if (!profileId) continue;
            const visitId = await recordClientVisit({
              tenantPhone: connection.phone_number,
              clientProfileId: profileId,
              summary: a.serviceLabel
                ? `${a.serviceLabel}${a.staffLabel ? ` with ${a.staffLabel}` : ''}`
                : `Booked appointment${a.staffLabel ? ` with ${a.staffLabel}` : ''}`,
              channel: 'in_person',
              satisfaction: a.status === 'completed' ? 'positive' : undefined,
              notes: a.notes,
              occurredAt: a.startAt,
              externalProvider: adapter.provider,
              externalId: a.externalId,
            });
            if (visitId) visitsRecorded++;
          } catch (err) {
            console.warn('[customer-sync] visit upsert failed:', err);
          }
        }
      } catch (err) {
        console.warn('[customer-sync] appointment fetch failed:', err);
      }
    }

    await markSynced(connection.id, customers.length);
    console.log(`[customer-sync] ${connection.phone_number} ${adapter.provider}: customers=${customers.length}/${upserted} appointments=${appointmentsFetched}/${visitsRecorded}`);
    return { ok: true, fetched: customers.length, upserted, appointmentsFetched, visitsRecorded };
  } catch (err: any) {
    console.warn('[customer-sync] error:', err);
    return { ok: false, fetched: 0, upserted: 0, appointmentsFetched: 0, visitsRecorded: 0, reason: err?.message ?? String(err) };
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

/**
 * Square adapter — bookings + customers via Square Developer API.
 *
 * Square OAuth docs: https://developer.squareup.com/docs/oauth-api
 * Bookings API:     https://developer.squareup.com/reference/square/bookings-api
 * Customers API:    https://developer.squareup.com/reference/square/customers-api
 *
 * Scope set we request:
 *   - CUSTOMERS_READ, CUSTOMERS_WRITE
 *   - APPOINTMENTS_READ (Phase 2 booking sync)
 *   - APPOINTMENTS_WRITE (Phase 3 — Riley writes bookings)
 *   - MERCHANT_PROFILE_READ (so we know the merchant_id)
 */

import type { BookingAdapter, BookingCustomer, BookingAvailabilitySlot, CreateBookingInput, CreatedBooking, BookingService, VisitorContact } from './index';

const SQUARE_API_BASE = process.env.SQUARE_ENV === 'production'
  ? 'https://connect.squareup.com'
  : 'https://connect.squareupsandbox.com';

export const squareAdapter: BookingAdapter = {
  provider: 'square',
  oauthInitiatePath: '/api/oauth/square',

  async listCustomers(accessToken, since): Promise<BookingCustomer[]> {
    const results: BookingCustomer[] = [];
    let cursor: string | undefined;

    // Square paginates via `cursor` — pull until exhausted, cap at 5000 to
    // keep first-sync sensible. Subsequent syncs use `since` to bound.
    let safety = 0;
    do {
      safety++;
      if (safety > 50) break;
      const body: any = { limit: 100 };
      if (cursor) body.cursor = cursor;
      if (since) {
        // Square uses `updated_at` filter in the search endpoint
        body.query = {
          filter: { updated_at: { start_at: since } },
          sort: { field: 'CREATED_AT', order: 'DESC' },
        };
      }

      const res = await fetch(`${SQUARE_API_BASE}/v2/customers/search`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Square-Version': '2024-12-18',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        console.warn('[square] listCustomers failed:', res.status, await res.text());
        break;
      }
      const data = await res.json();
      const batch = data.customers ?? [];
      for (const c of batch) {
        const display = [c.given_name, c.family_name].filter(Boolean).join(' ').trim()
          || c.nickname
          || c.company_name
          || c.email_address
          || c.phone_number;
        if (!display) continue;
        results.push({
          externalId: c.id,
          displayName: display,
          email: c.email_address || undefined,
          phone: c.phone_number || undefined,
          createdAt: c.created_at,
          notes: c.note,
          tags: Array.isArray(c.group_ids) ? c.group_ids : undefined,
        });
        if (results.length >= 5000) break;
      }
      cursor = data.cursor;
    } while (cursor && results.length < 5000);

    return results;
  },

  async searchAvailability(accessToken, fromIso, toIso, opts): Promise<BookingAvailabilitySlot[]> {
    if (!opts?.serviceExternalId) return [];
    try {
      const filter: any = {
        start_at_range: { start_at: fromIso, end_at: toIso },
        segment_filters: [{
          service_variation_id: opts.serviceExternalId,
          ...(opts.staffExternalId ? { team_member_id_filter: { any: [opts.staffExternalId] } } : {}),
        }],
      };
      const res = await fetch(`${SQUARE_API_BASE}/v2/bookings/availability/search`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Square-Version': '2024-12-18',
        },
        body: JSON.stringify({ query: { filter } }),
      });
      if (!res.ok) {
        console.warn('[square] searchAvailability failed:', res.status, await res.text());
        return [];
      }
      const data = await res.json();
      return (data.availabilities ?? []).map((a: any) => ({
        startAt: a.start_at,
        staffExternalId: a.appointment_segments?.[0]?.team_member_id,
      }));
    } catch (err) {
      console.warn('[square] searchAvailability exception:', err);
      return [];
    }
  },

  async createBooking(accessToken, input: CreateBookingInput): Promise<CreatedBooking | null> {
    if (!input.serviceExternalId) {
      console.warn('[square] createBooking requires serviceExternalId');
      return null;
    }
    try {
      const idempotencyKey = `${input.customerExternalId}-${input.startAt}-${input.serviceExternalId}`.slice(0, 64);
      const segment: any = {
        service_variation_id: input.serviceExternalId,
        ...(input.staffExternalId ? { team_member_id: input.staffExternalId } : {}),
        ...(input.durationMinutes ? { duration_minutes: input.durationMinutes } : {}),
      };
      const res = await fetch(`${SQUARE_API_BASE}/v2/bookings`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Square-Version': '2024-12-18',
        },
        body: JSON.stringify({
          idempotency_key: idempotencyKey,
          booking: {
            customer_id: input.customerExternalId,
            start_at: input.startAt,
            seller_note: input.sellerNote,
            appointment_segments: [segment],
          },
        }),
      });
      if (!res.ok) {
        console.warn('[square] createBooking failed:', res.status, await res.text());
        return null;
      }
      const data = await res.json();
      const b = data.booking;
      if (!b) return null;
      return {
        externalId: b.id,
        startAt: b.start_at,
        endAt: b.appointment_segments?.[0]?.end_at,
        status: b.status,
      };
    } catch (err) {
      console.warn('[square] createBooking exception:', err);
      return null;
    }
  },

  async listServices(accessToken): Promise<BookingService[]> {
    try {
      const res = await fetch(`${SQUARE_API_BASE}/v2/catalog/list?types=ITEM`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Square-Version': '2024-12-18',
        },
      });
      if (!res.ok) {
        console.warn('[square] listServices failed:', res.status, await res.text());
        return [];
      }
      const data = await res.json();
      const items = data.objects ?? [];
      const services: BookingService[] = [];
      for (const item of items) {
        const itemData = item.item_data;
        if (!itemData) continue;
        // Each item can have multiple variations (e.g. "Haircut — short" vs "Haircut — long").
        // For widget UX, each variation becomes its own bookable service.
        const variations = itemData.variations ?? [];
        for (const v of variations) {
          if (!v.id || !v.item_variation_data) continue;
          const vd = v.item_variation_data;
          if (!vd.available_for_booking) continue; // only bookable variations
          const priceMinor = vd.price_money?.amount;
          const priceUsd = typeof priceMinor === 'number' || typeof priceMinor === 'string'
            ? Number(priceMinor) / 100
            : undefined;
          services.push({
            externalId: v.id,
            name: variations.length > 1 ? `${itemData.name} — ${vd.name}` : itemData.name,
            durationMinutes: vd.service_duration ? Math.round(vd.service_duration / 60000) : undefined,
            priceUsd,
            description: itemData.description,
          });
        }
      }
      return services;
    } catch (err) {
      console.warn('[square] listServices exception:', err);
      return [];
    }
  },

  async findOrCreateCustomer(accessToken, input: VisitorContact): Promise<string | null> {
    if (!input.name) return null;
    try {
      // Try to find by email first (most reliable dedup key)
      if (input.email) {
        const search = await fetch(`${SQUARE_API_BASE}/v2/customers/search`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Square-Version': '2024-12-18',
          },
          body: JSON.stringify({
            query: { filter: { email_address: { exact: input.email } } },
            limit: 1,
          }),
        });
        if (search.ok) {
          const data = await search.json();
          const existing = data.customers?.[0];
          if (existing?.id) return existing.id;
        }
      }
      // Create new
      const [given, ...rest] = input.name.split(' ');
      const family = rest.join(' ');
      const createRes = await fetch(`${SQUARE_API_BASE}/v2/customers`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Square-Version': '2024-12-18',
        },
        body: JSON.stringify({
          given_name: given,
          family_name: family || undefined,
          email_address: input.email,
          phone_number: input.phone,
          note: 'Created via WisdomWorks widget',
        }),
      });
      if (!createRes.ok) {
        console.warn('[square] customer create failed:', createRes.status, await createRes.text());
        return null;
      }
      const created = await createRes.json();
      return created.customer?.id ?? null;
    } catch (err) {
      console.warn('[square] findOrCreateCustomer exception:', err);
      return null;
    }
  },

  async listAppointments(accessToken, fromIso, toIso) {
    // Phase 2 stub — not wired into the cron yet; here so the interface
    // is complete and the cron can flip it on.
    try {
      const res = await fetch(`${SQUARE_API_BASE}/v2/bookings/search`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Square-Version': '2024-12-18',
        },
        body: JSON.stringify({
          limit: 200,
          query: {
            filter: { start_at_range: { start_at: fromIso, end_at: toIso } },
          },
        }),
      });
      if (!res.ok) return [];
      const data = await res.json();
      const bookings = data.bookings ?? [];
      return bookings.map((b: any) => ({
        externalId: b.id,
        customerExternalId: b.customer_id ?? '',
        startAt: b.start_at,
        endAt: b.appointment_segments?.[0]?.end_at,
        serviceLabel: b.appointment_segments?.[0]?.service_variation_id,
        staffLabel: b.appointment_segments?.[0]?.team_member_id,
        status: (b.status?.toLowerCase() ?? 'booked') as any,
        notes: b.customer_note,
      }));
    } catch (err) {
      console.warn('[square] listAppointments failed:', err);
      return [];
    }
  },
};

// ─── OAuth helpers ────────────────────────────────────────────────────────

export interface SquareTokenResponse {
  access_token: string;
  refresh_token?: string;
  merchant_id: string;
  expires_at?: string;
  token_type?: string;
}

const SQUARE_OAUTH_BASE = process.env.SQUARE_ENV === 'production'
  ? 'https://connect.squareup.com'
  : 'https://connect.squareupsandbox.com';

export function buildSquareAuthorizeUrl(state: string): string {
  const appId = process.env.SQUARE_APP_ID;
  if (!appId) throw new Error('SQUARE_APP_ID not set');
  const redirect = `${process.env.NEXT_PUBLIC_APP_BASE_URL?.replace(/\/$/, '')}/api/oauth/square/callback`;
  const scope = [
    'CUSTOMERS_READ',
    'CUSTOMERS_WRITE',
    'APPOINTMENTS_READ',
    'APPOINTMENTS_WRITE',
    'MERCHANT_PROFILE_READ',
  ].join('+');
  return `${SQUARE_OAUTH_BASE}/oauth2/authorize?client_id=${appId}&scope=${scope}&session=false&state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(redirect)}`;
}

export async function exchangeSquareCode(code: string): Promise<SquareTokenResponse | null> {
  const appId = process.env.SQUARE_APP_ID;
  const appSecret = process.env.SQUARE_APP_SECRET;
  if (!appId || !appSecret) {
    console.warn('[square] SQUARE_APP_ID / SQUARE_APP_SECRET not set');
    return null;
  }
  try {
    const res = await fetch(`${SQUARE_OAUTH_BASE}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Square-Version': '2024-12-18' },
      body: JSON.stringify({
        client_id: appId,
        client_secret: appSecret,
        code,
        grant_type: 'authorization_code',
      }),
    });
    if (!res.ok) {
      console.warn('[square] token exchange failed:', res.status, await res.text());
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn('[square] token exchange exception:', err);
    return null;
  }
}

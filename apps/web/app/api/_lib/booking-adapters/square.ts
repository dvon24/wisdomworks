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

import type { BookingAdapter, BookingCustomer } from './index';

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

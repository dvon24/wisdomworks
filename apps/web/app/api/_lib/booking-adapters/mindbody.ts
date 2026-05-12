/**
 * Mindbody adapter — clients + appointments via the Public API v6.
 *
 * Docs: https://developers.mindbodyonline.com/PublicDocumentation
 *
 * Mindbody uses a hybrid auth: a Public API Key (per partner app) + a
 * SiteID (per merchant) + a per-staff OAuth token. The partner-app key
 * is shared across all tenants; per-tenant we still do an OAuth flow
 * to get the staff token for write operations.
 *
 * IMPORTANT: To go live in production with Mindbody, the partner app
 * must be approved by Mindbody (~2 week process). Until approval,
 * keep this in sandbox / dev. Setup:
 *   1. Apply at https://developers.mindbodyonline.com → submit app
 *   2. Once approved, set MINDBODY_API_KEY + MINDBODY_PARTNER_NAME
 *   3. Tenants connect via /api/oauth/mindbody → they enter their
 *      SiteID + staff credentials (Mindbody's flow is unusual)
 */

import type { BookingAdapter, BookingCustomer, BookingAppointment } from './index';

const MINDBODY_API_BASE = 'https://api.mindbodyonline.com/public/v6';

export const mindbodyAdapter: BookingAdapter = {
  provider: 'mindbody',
  oauthInitiatePath: '/api/oauth/mindbody',

  async listCustomers(accessToken, since, opts): Promise<BookingCustomer[]> {
    const siteId = opts?.merchantId;
    if (!siteId) return [];
    const apiKey = process.env.MINDBODY_API_KEY;
    if (!apiKey) return [];

    const out: BookingCustomer[] = [];
    let offset = 0;
    const limit = 200;
    let safety = 0;
    do {
      safety++;
      if (safety > 25) break;
      const url = new URL(`${MINDBODY_API_BASE}/client/clients`);
      url.searchParams.set('limit', String(limit));
      url.searchParams.set('offset', String(offset));
      if (since) url.searchParams.set('lastModifiedDate', since);

      const res = await fetch(url.toString(), {
        headers: {
          Authorization: accessToken,
          'API-Key': apiKey,
          'SiteId': siteId,
          'Content-Type': 'application/json',
        },
      });
      if (!res.ok) {
        console.warn('[mindbody] clients fetch failed:', res.status, await res.text());
        break;
      }
      const data = await res.json();
      const batch = data.Clients ?? [];
      for (const c of batch) {
        const display = [c.FirstName, c.LastName].filter(Boolean).join(' ').trim() || c.Email || c.MobilePhone;
        if (!display) continue;
        out.push({
          externalId: String(c.Id),
          displayName: display,
          email: c.Email || undefined,
          phone: c.MobilePhone || c.HomePhone || undefined,
          createdAt: c.CreationDate,
          notes: c.Notes,
        });
        if (out.length >= 5000) break;
      }
      if (batch.length < limit) break;
      offset += limit;
    } while (out.length < 5000);

    return out;
  },

  async listAppointments(accessToken, fromIso, toIso, opts): Promise<BookingAppointment[]> {
    const siteId = opts?.merchantId;
    if (!siteId) return [];
    const apiKey = process.env.MINDBODY_API_KEY;
    if (!apiKey) return [];

    try {
      const url = new URL(`${MINDBODY_API_BASE}/appointment/appointments`);
      url.searchParams.set('startDate', fromIso);
      url.searchParams.set('endDate', toIso);
      url.searchParams.set('limit', '200');

      const res = await fetch(url.toString(), {
        headers: {
          Authorization: accessToken,
          'API-Key': apiKey,
          'SiteId': siteId,
        },
      });
      if (!res.ok) {
        console.warn('[mindbody] appointments fetch failed:', res.status, await res.text());
        return [];
      }
      const data = await res.json();
      const appts = data.Appointments ?? [];
      return appts.map((a: any) => ({
        externalId: String(a.Id),
        customerExternalId: String(a.ClientId ?? ''),
        startAt: a.StartDateTime,
        endAt: a.EndDateTime,
        serviceLabel: a.SessionType?.Name,
        staffLabel: a.StaffName,
        status: a.Status?.toLowerCase().includes('cancel') ? 'cancelled' : 'booked',
        notes: a.Notes,
      }));
    } catch (err) {
      console.warn('[mindbody] appointment fetch exception:', err);
      return [];
    }
  },

  // searchAvailability + createBooking land in a follow-up — Mindbody's
  // appointment-creation endpoint requires staff-token scoping that's
  // simpler to add after the read-only sync is verified live.
};

/**
 * Calendly adapter — scheduled events + invitees → customers + visits.
 *
 * Calendly OAuth docs: https://developer.calendly.com/api-docs/ZG9jOjE2OTUyOTAy-oauth-2-0
 * API base: https://api.calendly.com
 *
 * Unlike Square, Calendly doesn't expose a generic "list contacts"
 * endpoint — to get the customer roster we walk the scheduled events
 * and pull invitees from each. We dedup by email at write time via
 * upsert_client_profile's name+email match.
 *
 * Scopes used:
 *   - default (everything Calendly tokens get); their OAuth doesn't
 *     use granular scopes today
 */

import type { BookingAdapter, BookingCustomer, BookingAppointment } from './index';

const CALENDLY_API_BASE = 'https://api.calendly.com';
const CALENDLY_OAUTH_BASE = 'https://auth.calendly.com';

export const calendlyAdapter: BookingAdapter = {
  provider: 'calendly',
  oauthInitiatePath: '/api/oauth/calendly',

  async listCustomers(accessToken): Promise<BookingCustomer[]> {
    // 1) Resolve the user URI so we can scope invitee lookups
    const userUri = await fetchUserUri(accessToken);
    if (!userUri) return [];

    // 2) Walk recent scheduled events (90 days back), collecting invitee
    //    emails as unique customer records.
    const minStart = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const events = await listScheduledEventsBetween(accessToken, userUri, minStart, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString());

    const seen = new Map<string, BookingCustomer>();
    for (const event of events) {
      const eventUuid = event.uri.split('/').pop();
      if (!eventUuid) continue;
      try {
        const invRes = await fetch(`${CALENDLY_API_BASE}/scheduled_events/${eventUuid}/invitees`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!invRes.ok) continue;
        const data = await invRes.json();
        for (const inv of data.collection ?? []) {
          if (!inv.email) continue;
          // Calendly's invitee URI is stable per invitee; use that as the
          // canonical external_id so we dedup across events properly.
          const externalId = inv.uri ?? inv.email;
          if (seen.has(externalId)) continue;
          seen.set(externalId, {
            externalId,
            displayName: inv.name || inv.email,
            email: inv.email,
            phone: inv.text_reminder_number ?? undefined,
            createdAt: inv.created_at,
          });
        }
      } catch (err) {
        console.warn('[calendly] invitee fetch failed:', err);
      }
      if (seen.size >= 2000) break;
    }

    return Array.from(seen.values());
  },

  async listAppointments(accessToken, fromIso, toIso): Promise<BookingAppointment[]> {
    const userUri = await fetchUserUri(accessToken);
    if (!userUri) return [];

    const events = await listScheduledEventsBetween(accessToken, userUri, fromIso, toIso);

    const out: BookingAppointment[] = [];
    for (const event of events) {
      const eventUuid = event.uri.split('/').pop();
      if (!eventUuid) continue;
      // Pull the primary invitee for customer mapping
      try {
        const invRes = await fetch(`${CALENDLY_API_BASE}/scheduled_events/${eventUuid}/invitees`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const invData = invRes.ok ? await invRes.json() : { collection: [] };
        const primaryInvitee = invData.collection?.[0];
        if (!primaryInvitee) continue;

        out.push({
          externalId: event.uri,
          customerExternalId: primaryInvitee.uri ?? primaryInvitee.email,
          startAt: event.start_time,
          endAt: event.end_time,
          serviceLabel: event.name,
          status: event.status === 'canceled' ? 'cancelled' : 'booked',
          notes: primaryInvitee.questions_and_answers?.map((qa: any) => `${qa.question}: ${qa.answer}`).join(' | '),
        });
      } catch (err) {
        console.warn('[calendly] appointment build failed:', err);
      }
    }

    return out;
  },

  // Calendly doesn't expose programmatic booking creation — you have to
  // route invitees through their hosted booking pages. searchAvailability
  // and createBooking are intentionally unimplemented; Riley falls back
  // to drafting a "book yourself via {calendly_url}" reply for those.
};

// ─── Helpers ─────────────────────────────────────────────────────────────

async function fetchUserUri(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(`${CALENDLY_API_BASE}/users/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.resource?.uri ?? null;
  } catch (err) {
    console.warn('[calendly] fetchUserUri failed:', err);
    return null;
  }
}

async function listScheduledEventsBetween(accessToken: string, userUri: string, minStartIso: string, maxStartIso: string): Promise<any[]> {
  const out: any[] = [];
  let cursor: string | undefined;
  let safety = 0;
  do {
    safety++;
    if (safety > 20) break;
    const url = new URL(`${CALENDLY_API_BASE}/scheduled_events`);
    url.searchParams.set('user', userUri);
    url.searchParams.set('min_start_time', minStartIso);
    url.searchParams.set('max_start_time', maxStartIso);
    url.searchParams.set('count', '100');
    if (cursor) url.searchParams.set('page_token', cursor);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      console.warn('[calendly] events fetch failed:', res.status, await res.text());
      break;
    }
    const data = await res.json();
    for (const e of data.collection ?? []) out.push(e);
    cursor = data.pagination?.next_page_token;
  } while (cursor);

  return out;
}

// ─── OAuth helpers ────────────────────────────────────────────────────────

export interface CalendlyTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  owner?: string;
  organization?: string;
}

export function buildCalendlyAuthorizeUrl(state: string): string {
  const clientId = process.env.CALENDLY_CLIENT_ID;
  if (!clientId) throw new Error('CALENDLY_CLIENT_ID not set');
  const redirect = `${process.env.NEXT_PUBLIC_APP_BASE_URL?.replace(/\/$/, '')}/api/oauth/calendly/callback`;
  return `${CALENDLY_OAUTH_BASE}/oauth/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirect)}&state=${encodeURIComponent(state)}`;
}

export async function exchangeCalendlyCode(code: string): Promise<CalendlyTokenResponse | null> {
  const clientId = process.env.CALENDLY_CLIENT_ID;
  const clientSecret = process.env.CALENDLY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.warn('[calendly] CALENDLY_CLIENT_ID / CALENDLY_CLIENT_SECRET not set');
    return null;
  }
  const redirect = `${process.env.NEXT_PUBLIC_APP_BASE_URL?.replace(/\/$/, '')}/api/oauth/calendly/callback`;
  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirect,
    });
    const res = await fetch(`${CALENDLY_OAUTH_BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) {
      console.warn('[calendly] token exchange failed:', res.status, await res.text());
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn('[calendly] token exchange exception:', err);
    return null;
  }
}

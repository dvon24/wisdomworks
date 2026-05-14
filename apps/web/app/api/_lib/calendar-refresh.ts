/**
 * Single-tenant live calendar refresh.
 *
 * Extracted from the 6:30 AM calendar-sync cron so the dashboard route
 * can refresh today's calendar inline when the cached copy is stale.
 * Cron-side does additional work (mirror into tenant_events, send brief)
 * that doesn't make sense for an on-demand deck refresh — this helper
 * skips those.
 *
 * Returns the list of today's events on success, null if the tenant has
 * no active calendar connection or the fetch failed.
 */

import { listCalendarEvents, decryptToken, type CalendarEvent, type OAuthConnection } from '@wisdomworks/shared';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export interface StoredCalendarEvent {
  id: string;
  title: string;
  start: string | Date;
  end: string | Date;
  location?: string;
  attendees?: string[];
}

export async function fetchAndStoreTodaysCalendarForTenant(
  tenantPhone: string,
): Promise<StoredCalendarEvent[] | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');

  // Find the tenant's active calendar connection (Google, Microsoft, Apple).
  // We pick the first match — most tenants only have one calendar connected.
  let connRow: OAuthConnection & { phone_number: string };
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/oauth_connections?phone_number=eq.${cleanPhone}&service=eq.calendar&status=eq.active&select=*&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    if (!rows?.length) return null;
    connRow = rows[0];
  } catch {
    return null;
  }

  // Decrypt tokens before passing to the provider client.
  let decrypted: OAuthConnection;
  try {
    decrypted = {
      ...connRow,
      access_token: await decryptToken(connRow.access_token),
      refresh_token: connRow.refresh_token ? await decryptToken(connRow.refresh_token) : undefined,
    };
  } catch (err) {
    console.warn('[calendar-refresh] decrypt failed:', err);
    return null;
  }

  // Fetch today's events (from now to end-of-day local).
  const now = new Date();
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  const result = await listCalendarEvents(decrypted, { from: now, to: endOfDay });
  if (!result.success || !result.data) {
    console.warn(`[calendar-refresh] listCalendarEvents failed for ${cleanPhone}:`, result.error);
    return null;
  }

  const events = result.data;
  const stored: StoredCalendarEvent[] = events.map((e: CalendarEvent) => ({
    id: e.id,
    title: e.title,
    start: e.start,
    end: e.end,
    location: e.location,
    attendees: e.attendees?.map((a) => a.name ?? a.email).filter((x): x is string => !!x),
  }));

  // Persist to whatsapp_contexts.profile so subsequent reads (briefing,
  // chat tools) get the same fresh data.
  try {
    const ctxRes = await fetch(
      `${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${cleanPhone}&select=profile`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
    );
    if (ctxRes.ok) {
      const ctxRows = await ctxRes.json();
      const profile = ctxRows[0]?.profile ?? { preferences: {}, activeTopics: [] };
      profile.todaysCalendar = stored;
      profile.todaysCalendarFetchedAt = new Date().toISOString();
      await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${cleanPhone}`, {
        method: 'PATCH',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ profile }),
      });
    }
  } catch (err) {
    console.warn('[calendar-refresh] profile write failed:', err);
    // Return the events anyway — caller can use them even if the cache update failed.
  }

  return stored;
}

/**
 * Calendar Sync Cron — daily morning digest of each customer's schedule.
 *
 * Runs at 6:30 AM (configured in vercel.json). For each customer with a calendar
 * connection (Google / Microsoft / Apple), pulls today's events and sends a
 * WhatsApp briefing 30 min before the daily-briefing cron, so Iris can reference
 * actual events in her morning summary.
 *
 * Stores today's events in whatsapp_contexts.profile.todaysCalendar so the
 * WhatsApp AI brain can answer "what's on my schedule?" without an extra API call.
 */

import { NextResponse } from 'next/server';
import { listCalendarEvents, decryptToken, type CalendarEvent, type OAuthConnection } from '@wisdomworks/shared';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const GRAPH_API = 'https://graph.facebook.com/v25.0';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  try {
    const connections = await fetchActiveCalendarConnections();
    if (!connections.length) {
      console.log('[calendar-sync] No active calendar connections');
      return NextResponse.json({ synced: 0 });
    }

    let synced = 0;
    for (const conn of connections) {
      try {
        await syncCustomer(conn);
        synced++;
      } catch (err) {
        console.error(`[calendar-sync] Failed for ${conn.phone_number} (${conn.provider}):`, err);
      }
    }

    console.log(`[calendar-sync] Synced ${synced}/${connections.length} customers`);
    return NextResponse.json({ synced, total: connections.length });
  } catch (error) {
    console.error('[calendar-sync] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

async function fetchActiveCalendarConnections(): Promise<(OAuthConnection & { phone_number: string })[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/oauth_connections?service=eq.calendar&status=eq.active&select=*`,
    {
      headers: {
        apikey: SUPABASE_KEY!,
        Authorization: `Bearer ${SUPABASE_KEY!}`,
      },
    },
  );
  if (!res.ok) return [];
  return res.json();
}

async function syncCustomer(conn: OAuthConnection & { phone_number: string }): Promise<void> {
  // Decrypt the access token before passing to API client
  const decrypted: OAuthConnection = {
    ...conn,
    access_token: await decryptToken(conn.access_token),
    refresh_token: conn.refresh_token ? await decryptToken(conn.refresh_token) : undefined,
  };

  // Pull today's events (now → end of day)
  const now = new Date();
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  const result = await listCalendarEvents(decrypted, { from: now, to: endOfDay });
  if (!result.success || !result.data) {
    console.warn(`[calendar-sync] Could not fetch events for ${conn.phone_number}`);
    return;
  }

  const events = result.data;

  // Store in whatsapp_contexts so the AI brain can reference without API call
  await storeTodaysSchedule(conn.phone_number, events);

  // Two-way sync — mirror each external event into tenant_events so the
  // unified schedule + conflict detection see it from one source. Dedup
  // happens via tenant_events.external_id (unique partial index from the
  // 2026-05-12 migration).
  if (events.length > 0) {
    await mirrorIntoTenantEvents(conn.phone_number, conn.provider, events);
  }

  // Send a brief schedule message (only if there are events)
  if (events.length > 0) {
    await sendScheduleBrief(conn.phone_number, events);
  }
}

async function mirrorIntoTenantEvents(
  phoneNumber: string,
  provider: string,
  events: CalendarEvent[],
): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  const cleanPhone = phoneNumber.replace(/[\s\-+()]/g, '');
  for (const e of events) {
    try {
      // INSERT with ON CONFLICT DO NOTHING via PostgREST. The partial
      // unique index on (tenant, external_provider, external_id) makes
      // this idempotent.
      await fetch(`${SUPABASE_URL}/rest/v1/tenant_events`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal,resolution=ignore-duplicates',
        },
        body: JSON.stringify({
          tenant_phone: cleanPhone,
          title: e.title,
          location: e.location ?? null,
          start_at: typeof e.start === 'string' ? e.start : new Date(e.start as any).toISOString(),
          end_at: typeof e.end === 'string' ? e.end : new Date(e.end as any).toISOString(),
          source: 'external_sync',
          external_provider: provider,
          external_id: e.id,
        }),
      });
    } catch (err) {
      console.warn('[calendar-sync] mirror upsert failed:', err);
    }
  }
}

async function storeTodaysSchedule(phoneNumber: string, events: CalendarEvent[]): Promise<void> {
  const cleanPhone = phoneNumber.replace(/[\s\-\+\(\)]/g, '');
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${cleanPhone}`,
    {
      headers: {
        apikey: SUPABASE_KEY!,
        Authorization: `Bearer ${SUPABASE_KEY!}`,
      },
    },
  );
  if (!res.ok) return;
  const rows = await res.json();
  if (!rows.length) return;

  const profile = rows[0].profile ?? { preferences: {}, activeTopics: [] };
  profile.todaysCalendar = events.map((e) => ({
    id: e.id,
    title: e.title,
    start: e.start,
    end: e.end,
    location: e.location,
    attendees: e.attendees?.map((a) => a.name ?? a.email),
  }));
  profile.todaysCalendarFetchedAt = new Date().toISOString();

  await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${cleanPhone}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_KEY!,
      Authorization: `Bearer ${SUPABASE_KEY!}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ profile }),
  });
}

async function sendScheduleBrief(phoneNumber: string, events: CalendarEvent[]): Promise<void> {
  const lines = [`Today's schedule (${events.length} event${events.length > 1 ? 's' : ''}):`, ''];

  for (const e of events) {
    const start = new Date(e.start);
    const time = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    lines.push(`${time}  ${e.title}${e.location ? ` (${e.location})` : ''}`);
  }

  await sendWhatsApp(phoneNumber, lines.join('\n'));
}

async function sendWhatsApp(to: string, message: string): Promise<void> {
  const cleanTo = to.replace(/[\s\-\+\(\)]/g, '');
  const { sendOwnerMessage } = await import('../../_lib/owner-message');
  await sendOwnerMessage({ tenantPhone: cleanTo, body: message, source: 'calendar-sync' });
}

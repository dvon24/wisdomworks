/**
 * Google Calendar API client.
 * Docs: https://developers.google.com/calendar/api/v3/reference
 */

import type {
  CalendarEvent,
  CreateCalendarEvent,
  IntegrationContext,
  IntegrationResult,
} from './types';
import { googleFetch } from './google-refresh';

const CAL_BASE = 'https://www.googleapis.com/calendar/v3';

interface GoogleEventRaw {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: Array<{
    email: string;
    displayName?: string;
    responseStatus?: 'accepted' | 'declined' | 'tentative' | 'needsAction';
  }>;
  organizer?: { email: string; displayName?: string };
  recurringEventId?: string;
  recurrence?: string[];
}

function rawToEvent(raw: GoogleEventRaw): CalendarEvent {
  const isAllDay = !!raw.start.date && !raw.start.dateTime;
  return {
    id: raw.id,
    title: raw.summary ?? '(no title)',
    description: raw.description,
    location: raw.location,
    start: raw.start.dateTime ?? `${raw.start.date}T00:00:00Z`,
    end: raw.end.dateTime ?? `${raw.end.date}T23:59:59Z`,
    attendees: raw.attendees?.map((a) => ({
      email: a.email,
      name: a.displayName,
      status:
        a.responseStatus === 'needsAction' ? 'pending' :
        a.responseStatus,
    })),
    organizer: raw.organizer ? { email: raw.organizer.email, name: raw.organizer.displayName } : undefined,
    isAllDay,
    recurring: !!(raw.recurringEventId || raw.recurrence),
    raw,
  };
}

/**
 * List events on the user's primary calendar within a date range.
 * Default range: today through 7 days from now.
 */
export async function listEvents(
  ctx: IntegrationContext,
  options?: { from?: Date; to?: Date; calendarId?: string; limit?: number },
): Promise<IntegrationResult<CalendarEvent[]>> {
  try {
    const from = options?.from ?? new Date();
    const to = options?.to ?? new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);
    const calendarId = options?.calendarId ?? 'primary';
    const params = new URLSearchParams({
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: String(options?.limit ?? 50),
    });

    const res = await googleFetch(ctx, `${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params}`);

    if (!res.ok) return { success: false, error: `Calendar list failed: ${res.status}` };
    const data = await res.json();
    return { success: true, data: (data.items ?? []).map(rawToEvent) };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Create a new calendar event.
 */
export async function createEvent(
  ctx: IntegrationContext,
  event: CreateCalendarEvent,
  calendarId: string = 'primary',
): Promise<IntegrationResult<CalendarEvent>> {
  try {
    const body: any = {
      summary: event.title,
      description: event.description,
      location: event.location,
      attendees: event.attendees?.map((a) => ({ email: a.email, displayName: a.name })),
    };

    if (event.isAllDay) {
      body.start = { date: event.start.split('T')[0] };
      body.end = { date: event.end.split('T')[0] };
    } else {
      body.start = { dateTime: event.start };
      body.end = { dateTime: event.end };
    }

    if (event.reminderMinutes !== undefined) {
      body.reminders = {
        useDefault: false,
        overrides: [{ method: 'popup', minutes: event.reminderMinutes }],
      };
    }

    const res = await googleFetch(ctx, `${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      return { success: false, error: `Calendar create failed: ${res.status} ${err}` };
    }
    return { success: true, data: rawToEvent(await res.json()) };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Update an existing event (e.g. reschedule).
 */
export async function updateEvent(
  ctx: IntegrationContext,
  eventId: string,
  patch: Partial<CreateCalendarEvent>,
  calendarId: string = 'primary',
): Promise<IntegrationResult<CalendarEvent>> {
  try {
    const body: any = {};
    if (patch.title !== undefined) body.summary = patch.title;
    if (patch.description !== undefined) body.description = patch.description;
    if (patch.location !== undefined) body.location = patch.location;
    if (patch.attendees !== undefined) {
      body.attendees = patch.attendees.map((a) => ({ email: a.email, displayName: a.name }));
    }
    if (patch.start) body.start = { dateTime: patch.start };
    if (patch.end) body.end = { dateTime: patch.end };

    const res = await googleFetch(ctx, `${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) return { success: false, error: `Calendar update failed: ${res.status}` };
    return { success: true, data: rawToEvent(await res.json()) };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Delete a calendar event.
 */
export async function deleteEvent(
  ctx: IntegrationContext,
  eventId: string,
  calendarId: string = 'primary',
): Promise<IntegrationResult<void>> {
  try {
    const res = await googleFetch(ctx, `${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`, {
      method: 'DELETE',
    });
    if (!res.ok && res.status !== 410) return { success: false, error: `Calendar delete failed: ${res.status}` };
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

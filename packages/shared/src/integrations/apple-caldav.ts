/**
 * Apple iCloud CalDAV client.
 *
 * Apple doesn't expose OAuth — we use CalDAV protocol with the user's iCloud
 * email + app-specific password. The "access token" stored in oauth_connections
 * IS the app-specific password.
 *
 * Wraps tsdav: https://github.com/natelindev/tsdav
 */

import type {
  CalendarEvent,
  CreateCalendarEvent,
  IntegrationContext,
  IntegrationResult,
} from './types';

interface AppleContext extends IntegrationContext {
  /** From oauth_connections.account_email */
  username: string;
}

const SERVER_URL = 'https://caldav.icloud.com';

interface ICalEvent {
  uid: string;
  summary?: string;
  description?: string;
  location?: string;
  dtstart: string;
  dtend: string;
  attendees?: string[];
  organizer?: string;
}

/** Parse an iCalendar VEVENT into our shape */
function parseICalEvent(ical: string, href: string): CalendarEvent | null {
  const lines = ical.split(/\r?\n/);
  const event: any = { id: href };
  let inEvent = false;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') inEvent = true;
    if (line === 'END:VEVENT') inEvent = false;
    if (!inEvent) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const keyPart = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const key = keyPart.split(';')[0]!;
    const isDate = keyPart.includes('VALUE=DATE');

    if (key === 'UID') event.uid = value;
    else if (key === 'SUMMARY') event.title = value.replace(/\\,/g, ',').replace(/\\n/g, '\n');
    else if (key === 'DESCRIPTION') event.description = value.replace(/\\,/g, ',').replace(/\\n/g, '\n');
    else if (key === 'LOCATION') event.location = value;
    else if (key === 'DTSTART') {
      event.start = isDate ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00Z` : icalDateToISO(value);
      event.isAllDay = isDate;
    } else if (key === 'DTEND') {
      event.end = isDate ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T23:59:59Z` : icalDateToISO(value);
    } else if (key === 'RRULE') {
      event.recurring = true;
    }
  }
  if (!event.start || !event.end) return null;
  return {
    id: event.uid ?? href,
    title: event.title ?? '(no title)',
    description: event.description,
    location: event.location,
    start: event.start,
    end: event.end,
    isAllDay: event.isAllDay,
    recurring: event.recurring,
    raw: { ical, href },
  };
}

/** Convert iCal date format (20260505T120000Z) to ISO 8601 */
function icalDateToISO(dt: string): string {
  // 20260505T120000Z → 2026-05-05T12:00:00Z
  if (dt.length >= 15) {
    return `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}T${dt.slice(9, 11)}:${dt.slice(11, 13)}:${dt.slice(13, 15)}${dt.endsWith('Z') ? 'Z' : ''}`;
  }
  return dt;
}

/** Convert ISO 8601 to iCal format */
function isoToICalDate(iso: string): string {
  // 2026-05-05T12:00:00Z → 20260505T120000Z
  return iso.replace(/[-:.]/g, '').replace(/\.\d{3}/, '').slice(0, 15) + 'Z';
}

async function getCalDAVClient(ctx: AppleContext) {
  const { createDAVClient } = await import('tsdav');
  return createDAVClient({
    serverUrl: SERVER_URL,
    credentials: { username: ctx.username, password: ctx.accessToken },
    authMethod: 'Basic',
    defaultAccountType: 'caldav',
  });
}

export async function listEvents(
  ctx: AppleContext,
  options?: { from?: Date; to?: Date; limit?: number },
): Promise<IntegrationResult<CalendarEvent[]>> {
  try {
    const client = await getCalDAVClient(ctx);
    const calendars = await client.fetchCalendars();
    if (!calendars.length) return { success: true, data: [] };

    const from = options?.from ?? new Date();
    const to = options?.to ?? new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Use the first calendar (typically "home"). Multi-calendar support can be added later.
    const calendar = calendars[0]!;
    const objects = await client.fetchCalendarObjects({
      calendar,
      timeRange: { start: from.toISOString(), end: to.toISOString() },
    });

    const events: CalendarEvent[] = [];
    for (const obj of objects) {
      if (typeof obj.data === 'string') {
        const parsed = parseICalEvent(obj.data, obj.url ?? obj.etag ?? '');
        if (parsed) events.push(parsed);
      }
    }
    return { success: true, data: events.slice(0, options?.limit ?? 50) };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function createEvent(
  ctx: AppleContext,
  event: CreateCalendarEvent,
): Promise<IntegrationResult<CalendarEvent>> {
  try {
    const client = await getCalDAVClient(ctx);
    const calendars = await client.fetchCalendars();
    if (!calendars.length) return { success: false, error: 'No calendars found' };
    const calendar = calendars[0]!;

    const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}@wisdomworks.app`;
    const dtStart = isoToICalDate(event.start);
    const dtEnd = isoToICalDate(event.end);

    const ical = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//WisdomWorks//EN',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${isoToICalDate(new Date().toISOString())}`,
      `DTSTART:${dtStart}`,
      `DTEND:${dtEnd}`,
      `SUMMARY:${event.title.replace(/,/g, '\\,').replace(/\n/g, '\\n')}`,
      event.description ? `DESCRIPTION:${event.description.replace(/,/g, '\\,').replace(/\n/g, '\\n')}` : '',
      event.location ? `LOCATION:${event.location}` : '',
      'END:VEVENT',
      'END:VCALENDAR',
    ].filter(Boolean).join('\r\n');

    const filename = `${uid}.ics`;
    await client.createCalendarObject({
      calendar,
      filename,
      iCalString: ical,
    });

    return {
      success: true,
      data: {
        id: uid,
        title: event.title,
        description: event.description,
        location: event.location,
        start: event.start,
        end: event.end,
        isAllDay: event.isAllDay,
      },
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

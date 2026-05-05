/**
 * Microsoft Graph client — Outlook (mail) + Microsoft Calendar combined.
 * Docs: https://learn.microsoft.com/en-us/graph/api/overview
 */

import type {
  EmailMessage,
  SendEmailRequest,
  CalendarEvent,
  CreateCalendarEvent,
  IntegrationContext,
  IntegrationResult,
} from './types';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

// ─── Outlook (mail) ───

interface MsEmailRaw {
  id: string;
  conversationId?: string;
  subject: string;
  bodyPreview: string;
  body: { contentType: 'text' | 'html'; content: string };
  from: { emailAddress: { name?: string; address: string } };
  toRecipients: Array<{ emailAddress: { name?: string; address: string } }>;
  ccRecipients?: Array<{ emailAddress: { name?: string; address: string } }>;
  receivedDateTime: string;
  isRead: boolean;
  hasAttachments: boolean;
}

function msToEmail(raw: MsEmailRaw): EmailMessage {
  let body = raw.body.content;
  if (raw.body.contentType === 'html') {
    body = body.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  }
  return {
    id: raw.id,
    threadId: raw.conversationId,
    from: raw.from.emailAddress.address,
    fromName: raw.from.emailAddress.name,
    to: raw.toRecipients.map((r) => r.emailAddress.address),
    cc: raw.ccRecipients?.map((r) => r.emailAddress.address),
    subject: raw.subject,
    body,
    bodyPreview: raw.bodyPreview,
    date: raw.receivedDateTime,
    isUnread: !raw.isRead,
    hasAttachments: raw.hasAttachments,
    raw,
  };
}

export async function listUnreadMessages(
  ctx: IntegrationContext,
  limit: number = 25,
): Promise<IntegrationResult<EmailMessage[]>> {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const url = `${GRAPH_BASE}/me/messages?$filter=isRead eq false and receivedDateTime ge ${since}&$top=${limit}&$orderby=receivedDateTime desc`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${ctx.accessToken}` },
    });
    if (!res.ok) return { success: false, error: `Graph mail list failed: ${res.status}` };
    const data = await res.json();
    return { success: true, data: (data.value ?? []).map(msToEmail) };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function sendEmail(
  ctx: IntegrationContext,
  req: SendEmailRequest,
): Promise<IntegrationResult<{ messageId: string }>> {
  try {
    const message: any = {
      subject: req.subject,
      body: { contentType: 'Text', content: req.body },
      toRecipients: req.to.map((email) => ({ emailAddress: { address: email } })),
    };
    if (req.cc?.length) message.ccRecipients = req.cc.map((email) => ({ emailAddress: { address: email } }));
    if (req.bcc?.length) message.bccRecipients = req.bcc.map((email) => ({ emailAddress: { address: email } }));

    // If replying to a message, use the reply endpoint instead
    if (req.inReplyToMessageId) {
      const res = await fetch(`${GRAPH_BASE}/me/messages/${req.inReplyToMessageId}/reply`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ctx.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ comment: req.body }),
      });
      if (!res.ok) return { success: false, error: `Graph reply failed: ${res.status}` };
      return { success: true, data: { messageId: 'reply-sent' } };
    }

    // Standalone send
    const res = await fetch(`${GRAPH_BASE}/me/sendMail`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ctx.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message, saveToSentItems: true }),
    });
    if (!res.ok) return { success: false, error: `Graph send failed: ${res.status}` };
    return { success: true, data: { messageId: 'sent' } };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function markAsRead(
  ctx: IntegrationContext,
  messageId: string,
): Promise<IntegrationResult<void>> {
  try {
    const res = await fetch(`${GRAPH_BASE}/me/messages/${messageId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${ctx.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ isRead: true }),
    });
    if (!res.ok) return { success: false, error: `Graph markAsRead failed: ${res.status}` };
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── Microsoft Calendar ───

interface MsEventRaw {
  id: string;
  subject?: string;
  bodyPreview?: string;
  body?: { contentType: string; content: string };
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  location?: { displayName?: string };
  attendees?: Array<{
    emailAddress: { address: string; name?: string };
    status?: { response: 'accepted' | 'declined' | 'tentativelyAccepted' | 'none' };
  }>;
  organizer?: { emailAddress: { address: string; name?: string } };
  isAllDay?: boolean;
  recurrence?: any;
}

function msEventToEvent(raw: MsEventRaw): CalendarEvent {
  return {
    id: raw.id,
    title: raw.subject ?? '(no title)',
    description: raw.bodyPreview ?? raw.body?.content,
    location: raw.location?.displayName,
    start: raw.start.dateTime,
    end: raw.end.dateTime,
    attendees: raw.attendees?.map((a) => ({
      email: a.emailAddress.address,
      name: a.emailAddress.name,
      status:
        a.status?.response === 'tentativelyAccepted' ? 'tentative' :
        a.status?.response === 'none' ? 'pending' :
        a.status?.response,
    })),
    organizer: raw.organizer
      ? { email: raw.organizer.emailAddress.address, name: raw.organizer.emailAddress.name }
      : undefined,
    isAllDay: raw.isAllDay,
    recurring: !!raw.recurrence,
    raw,
  };
}

export async function listEvents(
  ctx: IntegrationContext,
  options?: { from?: Date; to?: Date; limit?: number },
): Promise<IntegrationResult<CalendarEvent[]>> {
  try {
    const from = options?.from ?? new Date();
    const to = options?.to ?? new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);
    const url = `${GRAPH_BASE}/me/calendarView?startDateTime=${from.toISOString()}&endDateTime=${to.toISOString()}&$top=${options?.limit ?? 50}&$orderby=start/dateTime`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${ctx.accessToken}` },
    });
    if (!res.ok) return { success: false, error: `Graph calendar list failed: ${res.status}` };
    const data = await res.json();
    return { success: true, data: (data.value ?? []).map(msEventToEvent) };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function createEvent(
  ctx: IntegrationContext,
  event: CreateCalendarEvent,
): Promise<IntegrationResult<CalendarEvent>> {
  try {
    const body: any = {
      subject: event.title,
      body: { contentType: 'Text', content: event.description ?? '' },
      start: { dateTime: event.start, timeZone: 'UTC' },
      end: { dateTime: event.end, timeZone: 'UTC' },
      isAllDay: event.isAllDay ?? false,
    };
    if (event.location) body.location = { displayName: event.location };
    if (event.attendees?.length) {
      body.attendees = event.attendees.map((a) => ({
        emailAddress: { address: a.email, name: a.name },
        type: 'required',
      }));
    }
    if (event.reminderMinutes !== undefined) {
      body.reminderMinutesBeforeStart = event.reminderMinutes;
      body.isReminderOn = true;
    }

    const res = await fetch(`${GRAPH_BASE}/me/events`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ctx.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { success: false, error: `Graph create event failed: ${res.status}` };
    return { success: true, data: msEventToEvent(await res.json()) };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function updateEvent(
  ctx: IntegrationContext,
  eventId: string,
  patch: Partial<CreateCalendarEvent>,
): Promise<IntegrationResult<CalendarEvent>> {
  try {
    const body: any = {};
    if (patch.title !== undefined) body.subject = patch.title;
    if (patch.description !== undefined) body.body = { contentType: 'Text', content: patch.description };
    if (patch.location !== undefined) body.location = { displayName: patch.location };
    if (patch.start) body.start = { dateTime: patch.start, timeZone: 'UTC' };
    if (patch.end) body.end = { dateTime: patch.end, timeZone: 'UTC' };
    if (patch.attendees) {
      body.attendees = patch.attendees.map((a) => ({
        emailAddress: { address: a.email, name: a.name },
        type: 'required',
      }));
    }

    const res = await fetch(`${GRAPH_BASE}/me/events/${eventId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${ctx.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { success: false, error: `Graph update event failed: ${res.status}` };
    return { success: true, data: msEventToEvent(await res.json()) };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function deleteEvent(
  ctx: IntegrationContext,
  eventId: string,
): Promise<IntegrationResult<void>> {
  try {
    const res = await fetch(`${GRAPH_BASE}/me/events/${eventId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${ctx.accessToken}` },
    });
    if (!res.ok) return { success: false, error: `Graph delete event failed: ${res.status}` };
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

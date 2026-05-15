/**
 * Microsoft Graph client — Outlook (mail) + Microsoft Calendar combined.
 * Docs: https://learn.microsoft.com/en-us/graph/api/overview
 */

import type {
  EmailMessage,
  EmailAttachmentRef,
  FetchedAttachment,
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
    // Bug fix 2026-05-14: Graph supports inline attachments on the message
    // object for files under 3MB (larger files need a separate upload
    // session; we don't support that yet).
    if ((req.attachments?.length ?? 0) > 0) {
      message.attachments = (req.attachments ?? []).map((a) => ({
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: a.filename,
        contentType: a.mimeType,
        contentBytes: a.contentBase64,
      }));
    }

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

/** Read-state check — for Phase 2c engagement polling. Cheap (single
 *  $select=isRead query). Returns null if the message no longer exists
 *  (deleted from inbox). */
export async function getMessageReadState(
  ctx: IntegrationContext,
  messageId: string,
): Promise<IntegrationResult<{ isRead: boolean } | null>> {
  try {
    const res = await fetch(`${GRAPH_BASE}/me/messages/${messageId}?$select=isRead`, {
      headers: { Authorization: `Bearer ${ctx.accessToken}` },
    });
    if (res.status === 404) return { success: true, data: null };
    if (!res.ok) return { success: false, error: `Graph readState failed: ${res.status}` };
    const data = await res.json();
    return { success: true, data: { isRead: !!data.isRead } };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── Attachments ───

/** List attachment metadata for a message. Lightweight — just names + sizes. */
export async function listMessageAttachments(
  ctx: IntegrationContext,
  messageId: string,
): Promise<IntegrationResult<EmailAttachmentRef[]>> {
  try {
    const url = `${GRAPH_BASE}/me/messages/${messageId}/attachments?$select=id,name,contentType,size`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${ctx.accessToken}` } });
    if (!res.ok) return { success: false, error: `Graph attachments list failed: ${res.status}` };
    const data = await res.json();
    const refs: EmailAttachmentRef[] = (data.value ?? [])
      .filter((a: any) => a['@odata.type'] === '#microsoft.graph.fileAttachment')
      .map((a: any) => ({
        id: String(a.id),
        filename: String(a.name ?? 'attachment'),
        mimeType: String(a.contentType ?? 'application/octet-stream'),
        sizeBytes: typeof a.size === 'number' ? a.size : undefined,
      }));
    return { success: true, data: refs };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/** Fetch an attachment's bytes. Graph returns the file as base64 in
 *  `contentBytes` for fileAttachment instances. */
export async function fetchMessageAttachment(
  ctx: IntegrationContext,
  messageId: string,
  attachmentId: string,
): Promise<IntegrationResult<FetchedAttachment>> {
  try {
    const url = `${GRAPH_BASE}/me/messages/${messageId}/attachments/${attachmentId}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${ctx.accessToken}` } });
    if (!res.ok) return { success: false, error: `Graph attachment fetch failed: ${res.status}` };
    const a = await res.json();
    if (a['@odata.type'] !== '#microsoft.graph.fileAttachment') {
      return { success: false, error: `Unsupported attachment type: ${a['@odata.type']}` };
    }
    if (!a.contentBytes) return { success: false, error: 'Attachment had no contentBytes' };
    const bytes = Uint8Array.from(Buffer.from(a.contentBytes, 'base64'));
    return {
      success: true,
      data: {
        filename: String(a.name ?? 'attachment'),
        mimeType: String(a.contentType ?? 'application/octet-stream'),
        bytes,
        sizeBytes: bytes.length,
      },
    };
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
  options?: { from?: Date; to?: Date; limit?: number; calendarId?: string },
): Promise<IntegrationResult<CalendarEvent[]>> {
  try {
    const from = options?.from ?? new Date();
    const to = options?.to ?? new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);
    // calendarView on the user's default calendar OR a specific calendar
    // (used for Outlook's "Holidays" calendar and any shared/subscribed
    // calendars). When calendarId is omitted, /me/calendarView hits the
    // primary; otherwise we route through /me/calendars/{id}/calendarView.
    const calPath = options?.calendarId
      ? `/me/calendars/${encodeURIComponent(options.calendarId)}/calendarView`
      : `/me/calendarView`;
    const url = `${GRAPH_BASE}${calPath}?startDateTime=${from.toISOString()}&endDateTime=${to.toISOString()}&$top=${options?.limit ?? 50}&$orderby=start/dateTime`;
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

/**
 * List the user's Outlook calendars (primary, owned, shared with them,
 * and any subscribed calendars). Mirrors google-calendar.listCalendars
 * so multi-provider tenants can enumerate everything in one flow.
 */
export interface MsCalendarListEntry {
  id: string;
  summary: string;
  primary?: boolean;
  isHoliday?: boolean;
  canEdit?: boolean;
}

export async function listCalendars(
  ctx: IntegrationContext,
): Promise<IntegrationResult<MsCalendarListEntry[]>> {
  try {
    const url = `${GRAPH_BASE}/me/calendars?$select=id,name,isDefaultCalendar,canEdit`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${ctx.accessToken}` },
    });
    if (!res.ok) return { success: false, error: `Graph calendarList failed: ${res.status}` };
    const data = await res.json();
    const entries: MsCalendarListEntry[] = (data.value ?? []).map((c: any) => ({
      id: c.id,
      summary: c.name,
      primary: c.isDefaultCalendar,
      canEdit: c.canEdit,
      // Outlook auto-adds a "Holidays" calendar when the locale is set
      // and the user has enabled it under Settings → Calendar. Detect by
      // name (locale-independent fallback: keep canEdit=false signal).
      isHoliday: /^Holidays?$/i.test(c.name ?? '') || /Holidays in /i.test(c.name ?? ''),
    }));
    return { success: true, data: entries };
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

/**
 * Provider router — dispatches to the correct integration client based on OAuth connection.
 *
 * Agents call these functions without knowing which provider the customer uses.
 * "Send this email" → router picks Gmail / Outlook / IMAP based on connection.
 * "Create this calendar event" → router picks Google Cal / MS Cal / Apple CalDAV.
 */

import * as gmail from './gmail';
import * as gcal from './google-calendar';
import * as ms from './microsoft';
import * as apple from './apple-caldav';
import * as imap from './imap';
import type {
  EmailMessage,
  SendEmailRequest,
  CalendarEvent,
  CreateCalendarEvent,
  IntegrationResult,
} from './types';

/** Connection shape — matches oauth_connections table */
export interface OAuthConnection {
  provider: 'google' | 'microsoft' | 'meta' | 'apple' | 'yahoo' | 'imap';
  service: 'email' | 'calendar' | 'instagram';
  account_email?: string;
  access_token: string;
  refresh_token?: string;
  metadata?: Record<string, unknown>;
}

// ─── Email ───

export async function listEmails(
  conn: OAuthConnection,
  limit?: number,
): Promise<IntegrationResult<EmailMessage[]>> {
  const ctx = { accessToken: conn.access_token, metadata: conn.metadata };
  if (conn.provider === 'google') return gmail.listUnreadMessages(ctx, limit);
  if (conn.provider === 'microsoft') return ms.listUnreadMessages(ctx, limit);
  if (conn.provider === 'yahoo' || conn.provider === 'imap') {
    if (!conn.account_email) return { success: false, error: 'IMAP connection missing account email' };
    return imap.listUnreadMessages({ ...ctx, username: conn.account_email } as any, limit);
  }
  return { success: false, error: `Email not supported for provider: ${conn.provider}` };
}

export async function sendEmail(
  conn: OAuthConnection,
  req: SendEmailRequest,
): Promise<IntegrationResult<{ messageId: string }>> {
  const ctx = { accessToken: conn.access_token, metadata: conn.metadata };
  if (conn.provider === 'google') return gmail.sendEmail(ctx, req);
  if (conn.provider === 'microsoft') return ms.sendEmail(ctx, req);
  return { success: false, error: `Send not supported for provider: ${conn.provider}` };
}

export async function markEmailRead(
  conn: OAuthConnection,
  messageId: string,
): Promise<IntegrationResult<void>> {
  const ctx = { accessToken: conn.access_token, metadata: conn.metadata };
  if (conn.provider === 'google') return gmail.markAsRead(ctx, messageId);
  if (conn.provider === 'microsoft') return ms.markAsRead(ctx, messageId);
  return { success: false, error: `markRead not supported for provider: ${conn.provider}` };
}

// ─── Calendar ───

export async function listCalendarEvents(
  conn: OAuthConnection,
  options?: { from?: Date; to?: Date; limit?: number },
): Promise<IntegrationResult<CalendarEvent[]>> {
  const ctx = { accessToken: conn.access_token, metadata: conn.metadata };
  if (conn.provider === 'google') return gcal.listEvents(ctx, options);
  if (conn.provider === 'microsoft') return ms.listEvents(ctx, options);
  if (conn.provider === 'apple') {
    if (!conn.account_email) return { success: false, error: 'Apple connection missing account email' };
    return apple.listEvents({ ...ctx, username: conn.account_email }, options);
  }
  return { success: false, error: `Calendar not supported for provider: ${conn.provider}` };
}

export async function createCalendarEvent(
  conn: OAuthConnection,
  event: CreateCalendarEvent,
): Promise<IntegrationResult<CalendarEvent>> {
  const ctx = { accessToken: conn.access_token, metadata: conn.metadata };
  if (conn.provider === 'google') return gcal.createEvent(ctx, event);
  if (conn.provider === 'microsoft') return ms.createEvent(ctx, event);
  if (conn.provider === 'apple') {
    if (!conn.account_email) return { success: false, error: 'Apple connection missing account email' };
    return apple.createEvent({ ...ctx, username: conn.account_email }, event);
  }
  return { success: false, error: `Create event not supported for provider: ${conn.provider}` };
}

export async function updateCalendarEvent(
  conn: OAuthConnection,
  eventId: string,
  patch: Partial<CreateCalendarEvent>,
): Promise<IntegrationResult<CalendarEvent>> {
  const ctx = { accessToken: conn.access_token, metadata: conn.metadata };
  if (conn.provider === 'google') return gcal.updateEvent(ctx, eventId, patch);
  if (conn.provider === 'microsoft') return ms.updateEvent(ctx, eventId, patch);
  return { success: false, error: `Update event not supported for provider: ${conn.provider}` };
}

export async function deleteCalendarEvent(
  conn: OAuthConnection,
  eventId: string,
): Promise<IntegrationResult<void>> {
  const ctx = { accessToken: conn.access_token, metadata: conn.metadata };
  if (conn.provider === 'google') return gcal.deleteEvent(ctx, eventId);
  if (conn.provider === 'microsoft') return ms.deleteEvent(ctx, eventId);
  return { success: false, error: `Delete event not supported for provider: ${conn.provider}` };
}

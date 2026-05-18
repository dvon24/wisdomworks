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
import * as cloudDocs from './cloud-docs';
import type { CloudDocRef, FetchedCloudDoc } from './cloud-docs';
import type {
  EmailMessage,
  EmailAttachmentRef,
  FetchedAttachment,
  SendEmailRequest,
  CalendarEvent,
  CreateCalendarEvent,
  IntegrationResult,
} from './types';

/** Connection shape — matches oauth_connections table */
export interface OAuthConnection {
  provider: 'google' | 'microsoft' | 'meta' | 'apple' | 'yahoo' | 'imap';
  service: 'email' | 'calendar' | 'instagram' | 'drive' | 'sheets' | 'search_console' | 'analytics' | 'payments' | 'booking' | 'accounting';
  account_email?: string;
  access_token: string;
  refresh_token?: string;
  metadata?: Record<string, unknown>;
  /** Optional callback fired when the adapter refreshes an expired
   *  access token. Caller (apps/web side) binds this to its own
   *  persistence helper so the refreshed token is written back to
   *  oauth_connections — without this, every refresh starts from
   *  scratch and the encrypted-but-stale token sits in the DB.
   *  packages/shared can't import from apps/web, so the callback
   *  binding lives at the calling layer. */
  onTokenRefreshed?: (newAccessToken: string, expiresAtIso: string) => void | Promise<void>;
}

// ─── Email ───

export async function listEmails(
  conn: OAuthConnection,
  limit?: number,
): Promise<IntegrationResult<EmailMessage[]>> {
  const ctx = { accessToken: conn.access_token, refreshToken: conn.refresh_token, metadata: conn.metadata, onTokenRefreshed: conn.onTokenRefreshed };
  if (conn.provider === 'google') return gmail.listUnreadMessages(ctx, limit);
  if (conn.provider === 'microsoft') return ms.listUnreadMessages(ctx, limit);
  if (conn.provider === 'yahoo' || conn.provider === 'imap') {
    // IMAP runtime lives in apps/web (apps/web/app/api/_lib/imap-runtime.ts).
    // Reason: imapflow uses Node-only modules that Turbopack can't bundle out
    // of the transpiled shared package. Callers should detect IMAP providers
    // and route to the local runtime directly instead of going through here.
    return { success: false, error: 'IMAP listing must be invoked from the app-local runtime, not through the shared router.' };
  }
  return { success: false, error: `Email not supported for provider: ${conn.provider}` };
}

/**
 * List the owner's recent SENT messages — used by the behavioral RAG
 * pipeline to index what the owner has actually written so semantic
 * recall covers "what did I tell Ron about the timeline" queries.
 * Gmail-only today; Outlook + Yahoo support can land later.
 */
export async function listSentEmails(
  conn: OAuthConnection,
  opts: { sinceDays?: number; limit?: number } = {},
): Promise<IntegrationResult<EmailMessage[]>> {
  const ctx = { accessToken: conn.access_token, refreshToken: conn.refresh_token, metadata: conn.metadata, onTokenRefreshed: conn.onTokenRefreshed };
  if (conn.provider === 'google') return gmail.listSentMessages(ctx, opts);
  return { success: false, error: `Sent-mail listing not yet supported for provider: ${conn.provider}` };
}

/**
 * List the owner's recent INBOX (received) messages — symmetric to
 * listSentEmails. Powers received-email indexing so behavioral RAG
 * covers "what did Ron ask me about the timeline" alongside "what
 * I told Ron about it." Gmail-only today.
 */
export async function listReceivedEmails(
  conn: OAuthConnection,
  opts: { sinceDays?: number; limit?: number } = {},
): Promise<IntegrationResult<EmailMessage[]>> {
  const ctx = { accessToken: conn.access_token, refreshToken: conn.refresh_token, metadata: conn.metadata, onTokenRefreshed: conn.onTokenRefreshed };
  if (conn.provider === 'google') return gmail.listInboxMessages(ctx, opts);
  return { success: false, error: `Inbox listing not yet supported for provider: ${conn.provider}` };
}

export async function sendEmail(
  conn: OAuthConnection,
  req: SendEmailRequest,
): Promise<IntegrationResult<{ messageId: string }>> {
  const ctx = { accessToken: conn.access_token, refreshToken: conn.refresh_token, metadata: conn.metadata, onTokenRefreshed: conn.onTokenRefreshed };
  if (conn.provider === 'google') return gmail.sendEmail(ctx, req);
  if (conn.provider === 'microsoft') return ms.sendEmail(ctx, req);
  return { success: false, error: `Send not supported for provider: ${conn.provider}` };
}

export async function markEmailRead(
  conn: OAuthConnection,
  messageId: string,
): Promise<IntegrationResult<void>> {
  const ctx = { accessToken: conn.access_token, refreshToken: conn.refresh_token, metadata: conn.metadata, onTokenRefreshed: conn.onTokenRefreshed };
  if (conn.provider === 'google') return gmail.markAsRead(ctx, messageId);
  if (conn.provider === 'microsoft') return ms.markAsRead(ctx, messageId);
  return { success: false, error: `markRead not supported for provider: ${conn.provider}` };
}

// ─── Engagement signal (Story 2.16 Phase 2c) ────────────────────────────

/**
 * Cheap read-state check used by the engagement-poll cron. Returns the
 * current isRead status of an email. Yahoo/IMAP routes to the local
 * runtime via the apps/web caller.
 */
export async function getEmailReadState(
  conn: OAuthConnection,
  messageId: string,
): Promise<IntegrationResult<{ isRead: boolean } | null>> {
  const ctx = { accessToken: conn.access_token, refreshToken: conn.refresh_token, metadata: conn.metadata, onTokenRefreshed: conn.onTokenRefreshed };
  if (conn.provider === 'google') return gmail.getMessageReadState(ctx, messageId);
  if (conn.provider === 'microsoft') return ms.getMessageReadState(ctx, messageId);
  if (conn.provider === 'yahoo' || conn.provider === 'imap') {
    return { success: false, error: 'IMAP read state must be checked via app-local runtime' };
  }
  return { success: false, error: `Engagement signal not supported for ${conn.provider}` };
}

// ─── Attachments (Story 2.16 Phase 2b) ───────────────────────────────────

/**
 * List attachment metadata for a message. Provider-routed:
 *   - google → Gmail API (walks payload tree)
 *   - microsoft → Graph API
 *   - yahoo / imap → app-local IMAP runtime (call from apps/web directly)
 */
export async function listEmailAttachments(
  conn: OAuthConnection,
  messageId: string,
): Promise<IntegrationResult<EmailAttachmentRef[]>> {
  const ctx = { accessToken: conn.access_token, refreshToken: conn.refresh_token, metadata: conn.metadata, onTokenRefreshed: conn.onTokenRefreshed };
  if (conn.provider === 'google') return gmail.listMessageAttachments(ctx, messageId);
  if (conn.provider === 'microsoft') return ms.listMessageAttachments(ctx, messageId);
  if (conn.provider === 'yahoo' || conn.provider === 'imap') {
    return { success: false, error: 'IMAP attachments must be fetched via app-local runtime' };
  }
  return { success: false, error: `Attachments not supported for provider: ${conn.provider}` };
}

/**
 * Fetch attachment bytes. The Gmail path leaves filename/mimeType
 * generic — caller should override using the ref it got from
 * listEmailAttachments. Microsoft path returns real filename/mimeType.
 */
export async function fetchEmailAttachment(
  conn: OAuthConnection,
  messageId: string,
  attachmentId: string,
): Promise<IntegrationResult<FetchedAttachment>> {
  const ctx = { accessToken: conn.access_token, refreshToken: conn.refresh_token, metadata: conn.metadata, onTokenRefreshed: conn.onTokenRefreshed };
  if (conn.provider === 'google') return gmail.fetchMessageAttachment(ctx, messageId, attachmentId);
  if (conn.provider === 'microsoft') return ms.fetchMessageAttachment(ctx, messageId, attachmentId);
  if (conn.provider === 'yahoo' || conn.provider === 'imap') {
    return { success: false, error: 'IMAP attachments must be fetched via app-local runtime' };
  }
  return { success: false, error: `Attachments not supported for provider: ${conn.provider}` };
}

// ─── Cloud docs (Story 2.16 Phase 4) ─────────────────────────────────────

/**
 * Search the owner's cloud document storage. Dispatches by connection
 * provider — `google` → Drive (drive.readonly scope), `microsoft` →
 * OneDrive (Files.Read.All scope). Empty query returns recent files.
 */
export async function searchCloudDocs(
  conn: OAuthConnection,
  query: string,
  limit: number = 15,
): Promise<IntegrationResult<CloudDocRef[]>> {
  const ctx = { accessToken: conn.access_token, refreshToken: conn.refresh_token, metadata: conn.metadata, onTokenRefreshed: conn.onTokenRefreshed };
  if (conn.provider === 'google') return cloudDocs.searchDrive(ctx, query, limit);
  if (conn.provider === 'microsoft') return cloudDocs.searchOneDrive(ctx, query, limit);
  return { success: false, error: `Cloud-doc search not supported for ${conn.provider}` };
}

/**
 * Fetch a cloud doc's bytes for analysis. Google Drive native files
 * (Docs, Sheets, Slides) are exported to Office/PDF formats so the
 * downstream analyzer can parse them.
 */
export async function fetchCloudDoc(
  conn: OAuthConnection,
  fileId: string,
): Promise<IntegrationResult<FetchedCloudDoc>> {
  const ctx = { accessToken: conn.access_token, refreshToken: conn.refresh_token, metadata: conn.metadata, onTokenRefreshed: conn.onTokenRefreshed };
  if (conn.provider === 'google') return cloudDocs.fetchDriveFile(ctx, fileId);
  if (conn.provider === 'microsoft') return cloudDocs.fetchOneDriveFile(ctx, fileId);
  return { success: false, error: `Cloud-doc fetch not supported for ${conn.provider}` };
}

// ─── Calendar ───

export async function listCalendarEvents(
  conn: OAuthConnection,
  options?: { from?: Date; to?: Date; limit?: number; calendarId?: string },
): Promise<IntegrationResult<CalendarEvent[]>> {
  const ctx = { accessToken: conn.access_token, refreshToken: conn.refresh_token, metadata: conn.metadata, onTokenRefreshed: conn.onTokenRefreshed };
  if (conn.provider === 'google') return gcal.listEvents(ctx, options);
  if (conn.provider === 'microsoft') return ms.listEvents(ctx, options);
  if (conn.provider === 'apple') {
    if (!conn.account_email) return { success: false, error: 'Apple connection missing account email' };
    return apple.listEvents({ ...ctx, username: conn.account_email }, options);
  }
  return { success: false, error: `Calendar not supported for provider: ${conn.provider}` };
}

/**
 * List every calendar the user is subscribed to (primary, owned, shared,
 * Holidays-in-X subscriptions, sports, etc.). Used by Iris to discover
 * which calendars exist beyond `primary` — most notably the auto-added
 * "Holidays in <country>" calendar Google subscribes new accounts to.
 */
export async function listCalendars(
  conn: OAuthConnection,
): Promise<IntegrationResult<gcal.CalendarListEntry[]>> {
  const ctx = { accessToken: conn.access_token, refreshToken: conn.refresh_token, metadata: conn.metadata, onTokenRefreshed: conn.onTokenRefreshed };
  if (conn.provider === 'google') return gcal.listCalendars(ctx);
  if (conn.provider === 'microsoft') {
    const msResult = await ms.listCalendars(ctx);
    if (!msResult.success) return { success: false, error: msResult.error };
    // Reshape Microsoft entries to match the gcal-shaped union so the
    // router has one cross-provider type for callers.
    return {
      success: true,
      data: (msResult.data ?? []).map((c) => ({
        id: c.id,
        summary: c.summary,
        primary: c.primary,
        isHoliday: c.isHoliday,
      })),
    };
  }
  // Apple CalDAV doesn't yet expose calendar enumeration through our
  // adapter — fall back to primary so callers don't crash.
  return {
    success: true,
    data: [{ id: 'primary', summary: 'Primary calendar', primary: true }],
  };
}

export async function createCalendarEvent(
  conn: OAuthConnection,
  event: CreateCalendarEvent,
): Promise<IntegrationResult<CalendarEvent>> {
  const ctx = { accessToken: conn.access_token, refreshToken: conn.refresh_token, metadata: conn.metadata, onTokenRefreshed: conn.onTokenRefreshed };
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
  const ctx = { accessToken: conn.access_token, refreshToken: conn.refresh_token, metadata: conn.metadata, onTokenRefreshed: conn.onTokenRefreshed };
  if (conn.provider === 'google') return gcal.updateEvent(ctx, eventId, patch);
  if (conn.provider === 'microsoft') return ms.updateEvent(ctx, eventId, patch);
  return { success: false, error: `Update event not supported for provider: ${conn.provider}` };
}

export async function deleteCalendarEvent(
  conn: OAuthConnection,
  eventId: string,
): Promise<IntegrationResult<void>> {
  const ctx = { accessToken: conn.access_token, refreshToken: conn.refresh_token, metadata: conn.metadata, onTokenRefreshed: conn.onTokenRefreshed };
  if (conn.provider === 'google') return gcal.deleteEvent(ctx, eventId);
  if (conn.provider === 'microsoft') return ms.deleteEvent(ctx, eventId);
  return { success: false, error: `Delete event not supported for provider: ${conn.provider}` };
}

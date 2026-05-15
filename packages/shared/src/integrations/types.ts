/**
 * Shared types for external integration clients (Gmail, Outlook, Calendar, etc.)
 *
 * Every provider client returns these normalized shapes so the agents work
 * the same regardless of which underlying service the customer uses.
 */

export interface EmailMessage {
  id: string;
  threadId?: string;
  from: string;
  fromName?: string;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  bodyPreview: string;
  date: string;
  isUnread: boolean;
  hasAttachments: boolean;
  /** Lightweight metadata for attachments on this message — populated
   *  by listUnreadMessages when the provider exposes it cheaply. Use
   *  fetchEmailAttachment() to pull the bytes. */
  attachments?: EmailAttachmentRef[];
  /** Provider-specific raw data for advanced use */
  raw?: any;
}

export interface EmailAttachmentRef {
  /** Provider attachment id (or part id for IMAP) */
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes?: number;
}

export interface FetchedAttachment {
  filename: string;
  mimeType: string;
  /** Raw bytes of the attachment */
  bytes: Uint8Array;
  sizeBytes: number;
}

export interface OutboundAttachment {
  /** Display filename including extension (e.g. "Race-Prep-Guide.docx"). */
  filename: string;
  /** Base64-encoded file contents. Callers responsible for fetching + encoding. */
  contentBase64: string;
  /** MIME type — drives the multipart Content-Type / Graph contentType. */
  mimeType: string;
}

export interface SendEmailRequest {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  /** Reply to a specific message — sets In-Reply-To header */
  inReplyToMessageId?: string;
  /** Story 6.4 / bug fix 2026-05-14 — outbound attachments. Providers
   *  build multipart MIME (Gmail / SMTP) or include in Graph send
   *  (Microsoft). Pass empty array or undefined for no attachments. */
  attachments?: OutboundAttachment[];
}

export interface CalendarEvent {
  id: string;
  title: string;
  description?: string;
  location?: string;
  start: string; // ISO 8601
  end: string;
  attendees?: { email: string; name?: string; status?: 'accepted' | 'declined' | 'tentative' | 'pending' }[];
  organizer?: { email: string; name?: string };
  isAllDay?: boolean;
  recurring?: boolean;
  /** Provider-specific raw data */
  raw?: any;
}

export interface CreateCalendarEvent {
  title: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
  attendees?: { email: string; name?: string }[];
  isAllDay?: boolean;
  /** Optional reminder minutes-before-start */
  reminderMinutes?: number;
}

export interface IntegrationContext {
  accessToken: string;
  /** Refresh token (where the provider supports it, e.g. Google offline_access).
   *  Used by adapters to auto-refresh on 401 instead of failing the call. */
  refreshToken?: string;
  /** Provider-specific extra config (e.g., CalDAV URL for Apple, IG account ID for Meta) */
  metadata?: Record<string, unknown>;
  /** Optional callback fired when the adapter refreshes an expired
   *  access token. Caller can persist the new token to oauth_connections
   *  so subsequent calls reuse it instead of refreshing from scratch
   *  every time. Adapters in packages/shared can't import from apps/web,
   *  so persistence is the caller's responsibility. */
  onTokenRefreshed?: (newAccessToken: string, expiresAtIso: string) => void | Promise<void>;
}

export interface IntegrationResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

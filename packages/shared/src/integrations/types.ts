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

export interface SendEmailRequest {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  /** Reply to a specific message — sets In-Reply-To header */
  inReplyToMessageId?: string;
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
  /** Provider-specific extra config (e.g., CalDAV URL for Apple, IG account ID for Meta) */
  metadata?: Record<string, unknown>;
}

export interface IntegrationResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

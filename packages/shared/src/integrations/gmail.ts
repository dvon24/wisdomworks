/**
 * Gmail API client — read inbox, send messages, draft replies.
 *
 * Uses the customer's Google OAuth access token (stored in oauth_connections table).
 * All endpoints documented at: https://developers.google.com/gmail/api/reference/rest
 */

import type {
  EmailMessage,
  EmailAttachmentRef,
  FetchedAttachment,
  SendEmailRequest,
  IntegrationContext,
  IntegrationResult,
} from './types';

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

interface GmailHeader {
  name: string;
  value: string;
}

interface GmailMessageRaw {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet: string;
  internalDate: string;
  payload: {
    headers: GmailHeader[];
    body?: { data?: string; size?: number };
    parts?: Array<{
      mimeType: string;
      body?: { data?: string; size?: number };
      parts?: any[];
    }>;
    mimeType: string;
  };
}

function getHeader(headers: GmailHeader[] | undefined, name: string): string {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

/** Decode base64url body (Gmail uses base64url, not base64) */
function decodeBody(b64?: string): string {
  if (!b64) return '';
  try {
    const fixed = b64.replace(/-/g, '+').replace(/_/g, '/');
    const padded = fixed + '='.repeat((4 - (fixed.length % 4)) % 4);
    return Buffer.from(padded, 'base64').toString('utf-8');
  } catch {
    return '';
  }
}

/** Recursively extract the plain-text body from a Gmail message payload */
function extractBody(payload: GmailMessageRaw['payload']): string {
  // Direct body
  if (payload.body?.data && payload.mimeType === 'text/plain') {
    return decodeBody(payload.body.data);
  }
  // Multipart — find text/plain part first, fall back to text/html
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return decodeBody(part.body.data);
      }
    }
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        // Strip HTML tags for the agent's reading
        return decodeBody(part.body.data).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
      }
    }
    // Recurse into nested parts (e.g. multipart/alternative inside multipart/mixed)
    for (const part of payload.parts) {
      if (part.parts) {
        const nested = extractBody(part as any);
        if (nested) return nested;
      }
    }
  }
  return '';
}

function parseFromHeader(value: string): { email: string; name?: string } {
  const match = value.match(/^(.+?)\s*<(.+?)>$/);
  if (match) return { name: match[1]!.trim().replace(/^"|"$/g, ''), email: match[2]!.trim() };
  return { email: value.trim() };
}

function rawToEmail(raw: GmailMessageRaw): EmailMessage {
  const headers = raw.payload.headers;
  const fromRaw = getHeader(headers, 'From');
  const from = parseFromHeader(fromRaw);
  const toRaw = getHeader(headers, 'To');
  const ccRaw = getHeader(headers, 'Cc');
  const body = extractBody(raw.payload);

  return {
    id: raw.id,
    threadId: raw.threadId,
    from: from.email,
    fromName: from.name,
    to: toRaw ? toRaw.split(',').map((t) => t.trim()) : [],
    cc: ccRaw ? ccRaw.split(',').map((t) => t.trim()) : undefined,
    subject: getHeader(headers, 'Subject'),
    body,
    bodyPreview: raw.snippet,
    date: new Date(parseInt(raw.internalDate, 10)).toISOString(),
    isUnread: (raw.labelIds ?? []).includes('UNREAD'),
    hasAttachments: !!(raw.payload.parts?.some((p) => p.mimeType.startsWith('application/'))),
    raw,
  };
}

/**
 * List recent unread messages from the inbox.
 * Default: last 24 hours, max 25 messages.
 */
export async function listUnreadMessages(
  ctx: IntegrationContext,
  limit: number = 25,
): Promise<IntegrationResult<EmailMessage[]>> {
  try {
    // Step 1: list message IDs
    const since = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);
    const listRes = await fetch(
      `${GMAIL_BASE}/messages?q=is:unread+after:${since}&maxResults=${limit}`,
      { headers: { Authorization: `Bearer ${ctx.accessToken}` } },
    );

    if (!listRes.ok) {
      return { success: false, error: `Gmail list failed: ${listRes.status}` };
    }
    const listData = await listRes.json();
    const ids: string[] = (listData.messages ?? []).map((m: any) => m.id);

    if (ids.length === 0) return { success: true, data: [] };

    // Step 2: fetch each message in parallel
    const messages = await Promise.all(
      ids.map(async (id) => {
        const msgRes = await fetch(`${GMAIL_BASE}/messages/${id}?format=full`, {
          headers: { Authorization: `Bearer ${ctx.accessToken}` },
        });
        if (!msgRes.ok) return null;
        return rawToEmail(await msgRes.json());
      }),
    );

    return { success: true, data: messages.filter((m): m is EmailMessage => m !== null) };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Send an email. Constructs a raw RFC 2822 message and submits to Gmail.
 */
export async function sendEmail(
  ctx: IntegrationContext,
  req: SendEmailRequest,
): Promise<IntegrationResult<{ messageId: string }>> {
  try {
    // Build the RFC 2822 message
    const headers: string[] = [];
    headers.push(`To: ${req.to.join(', ')}`);
    if (req.cc?.length) headers.push(`Cc: ${req.cc.join(', ')}`);
    if (req.bcc?.length) headers.push(`Bcc: ${req.bcc.join(', ')}`);
    headers.push(`Subject: ${req.subject}`);
    headers.push('Content-Type: text/plain; charset=utf-8');
    if (req.inReplyToMessageId) {
      headers.push(`In-Reply-To: ${req.inReplyToMessageId}`);
      headers.push(`References: ${req.inReplyToMessageId}`);
    }

    const message = headers.join('\r\n') + '\r\n\r\n' + req.body;
    const encoded = Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const sendRes = await fetch(`${GMAIL_BASE}/messages/send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ctx.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: encoded }),
    });

    if (!sendRes.ok) {
      const err = await sendRes.text();
      return { success: false, error: `Gmail send failed: ${sendRes.status} ${err}` };
    }
    const data = await sendRes.json();
    return { success: true, data: { messageId: data.id } };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Mark a message as read.
 */
export async function markAsRead(
  ctx: IntegrationContext,
  messageId: string,
): Promise<IntegrationResult<void>> {
  try {
    const res = await fetch(`${GMAIL_BASE}/messages/${messageId}/modify`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ctx.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
    });
    if (!res.ok) return { success: false, error: `Gmail markAsRead failed: ${res.status}` };
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/** Read-state check — for Phase 2c engagement polling. Gmail tracks read
 *  via the UNREAD label. Cheap (just label list). Returns null if the
 *  message no longer exists (deleted/expunged). */
export async function getMessageReadState(
  ctx: IntegrationContext,
  messageId: string,
): Promise<IntegrationResult<{ isRead: boolean } | null>> {
  try {
    const res = await fetch(
      `${GMAIL_BASE}/messages/${messageId}?format=minimal&fields=labelIds`,
      { headers: { Authorization: `Bearer ${ctx.accessToken}` } },
    );
    if (res.status === 404) return { success: true, data: null };
    if (!res.ok) return { success: false, error: `Gmail readState failed: ${res.status}` };
    const data = await res.json();
    const labels: string[] = Array.isArray(data.labelIds) ? data.labelIds : [];
    return { success: true, data: { isRead: !labels.includes('UNREAD') } };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── Attachments ───────────────────────────────────────────────────────────

interface GmailPart {
  partId: string;
  mimeType: string;
  filename: string;
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: GmailPart[];
}

/** Walk a Gmail message's payload tree, returning every leaf with a filename. */
function flattenParts(part: GmailPart | undefined, out: GmailPart[] = []): GmailPart[] {
  if (!part) return out;
  if (part.filename && part.filename.length > 0 && part.body?.attachmentId) out.push(part);
  for (const child of part.parts ?? []) flattenParts(child, out);
  return out;
}

/** List attachment metadata for a Gmail message. Hits messages.get with
 *  format=full so we can walk the payload tree for filenames. */
export async function listMessageAttachments(
  ctx: IntegrationContext,
  messageId: string,
): Promise<IntegrationResult<EmailAttachmentRef[]>> {
  try {
    const res = await fetch(
      `${GMAIL_BASE}/messages/${messageId}?format=full`,
      { headers: { Authorization: `Bearer ${ctx.accessToken}` } },
    );
    if (!res.ok) return { success: false, error: `Gmail message fetch failed: ${res.status}` };
    const data = await res.json();
    const parts = flattenParts(data.payload);
    const refs: EmailAttachmentRef[] = parts.map((p) => ({
      id: String(p.body!.attachmentId),
      filename: p.filename,
      mimeType: p.mimeType,
      sizeBytes: p.body?.size,
    }));
    return { success: true, data: refs };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/** Fetch attachment bytes — Gmail returns base64url-encoded data. */
export async function fetchMessageAttachment(
  ctx: IntegrationContext,
  messageId: string,
  attachmentId: string,
): Promise<IntegrationResult<FetchedAttachment>> {
  try {
    const res = await fetch(
      `${GMAIL_BASE}/messages/${messageId}/attachments/${attachmentId}`,
      { headers: { Authorization: `Bearer ${ctx.accessToken}` } },
    );
    if (!res.ok) return { success: false, error: `Gmail attachment fetch failed: ${res.status}` };
    const data = await res.json();
    if (!data.data) return { success: false, error: 'Gmail attachment had no data field' };
    // Gmail uses URL-safe base64; normalize before decoding
    const b64 = data.data.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(Buffer.from(b64, 'base64'));
    // Gmail's attachments endpoint doesn't return filename/mime, so we
    // accept those from the caller (who got them from listMessageAttachments).
    // The caller passes through whatever ref they had.
    return {
      success: true,
      data: {
        filename: 'attachment',
        mimeType: 'application/octet-stream',
        bytes,
        sizeBytes: bytes.length,
      },
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

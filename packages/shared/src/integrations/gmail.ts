/**
 * Gmail API client — read inbox, send messages, draft replies.
 *
 * Uses the customer's Google OAuth access token (stored in oauth_connections table).
 * All endpoints documented at: https://developers.google.com/gmail/api/reference/rest
 */

import type {
  EmailMessage,
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

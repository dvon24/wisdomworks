/**
 * IMAP runtime — lives inside apps/web (NOT in @wisdomworks/shared).
 *
 * Reason: shared is a transpiled monorepo package. When Turbopack bundles
 * apps/web, anything in shared that touches imapflow tries to bundle Node
 * modules (dns/net/tls) and explodes. Putting the IMAP loader directly in
 * apps/web lets us use a plain dynamic import, which serverExternalPackages
 * correctly externalises and Vercel's NFT picks up.
 *
 * Used by agent-tools.ts when conn.provider === 'yahoo' or 'imap'.
 */

import type { EmailMessage } from '@wisdomworks/shared';

interface ImapConnection {
  provider: string;
  service: string;
  account_email?: string;
  access_token: string;
  metadata?: {
    imap_host?: string;
    imap_port?: number;
    imap_secure?: boolean;
    smtp_host?: string;
    smtp_port?: number;
  };
}

const YAHOO_HOST = 'imap.mail.yahoo.com';
const YAHOO_SMTP_HOST = 'smtp.mail.yahoo.com';
const YAHOO_SMTP_PORT = 465;

async function loadImapFlow(): Promise<any> {
  const mod: any = await import('imapflow');
  return mod.ImapFlow ?? mod.default?.ImapFlow ?? mod.default;
}

async function loadMailparser(): Promise<any> {
  const mod: any = await import('mailparser');
  return mod.simpleParser ?? mod.default?.simpleParser ?? mod.default;
}

function makeClient(ImapFlow: any, conn: ImapConnection) {
  const host = conn.metadata?.imap_host || YAHOO_HOST;
  const port = conn.metadata?.imap_port || 993;
  const secure = conn.metadata?.imap_secure !== false;
  return new ImapFlow({
    host, port, secure,
    auth: { user: conn.account_email, pass: conn.access_token },
    logger: false,
  });
}

/** Resolve a folder name by SPECIAL-USE attribute (\Sent, \Drafts, etc.).
 * Falls back to a list of common names for the role.
 * Returns the matched path AND the full folder list (for diagnostic logging
 * when nothing matches). */
async function findMailbox(
  client: any,
  attribute: string,
  fallbacks: string[],
): Promise<{ path: string | null; available: string[] }> {
  try {
    const list = await client.list();
    const paths = (list ?? []).map((m: any) => m.path).filter(Boolean);
    // 1. SPECIAL-USE attribute
    const special = list.find((m: any) =>
      Array.isArray(m.specialUse) ? m.specialUse.includes(attribute) : m.specialUse === attribute,
    );
    if (special?.path) return { path: special.path, available: paths };
    // 2. Exact name match against fallbacks (case-insensitive)
    const lowered = paths.map((p: string) => p.toLowerCase());
    for (const name of fallbacks) {
      const idx = lowered.indexOf(name.toLowerCase());
      if (idx >= 0) return { path: paths[idx], available: paths };
    }
    // 3. Substring match — handles namespaces like "INBOX.Sent" or "[Gmail]/Sent Mail"
    for (const name of fallbacks) {
      const idx = lowered.findIndex((p: string) => p.endsWith(name.toLowerCase()) || p.includes(`.${name.toLowerCase()}`) || p.includes(`/${name.toLowerCase()}`));
      if (idx >= 0) return { path: paths[idx], available: paths };
    }
    return { path: null, available: paths };
  } catch (err) {
    return { path: null, available: [] };
  }
}

/** Pull the meaningful message from an IMAPFlow error, which often hides
 * the real cause behind a generic "Command failed". */
function imapErrorDetail(err: any): string {
  if (!err) return 'unknown';
  const parts = [err.message, err.responseText, err.response, err.code, err.serverResponseCode]
    .filter(Boolean)
    .map((p: any) => typeof p === 'string' ? p : JSON.stringify(p));
  return parts.length > 0 ? parts.join(' | ') : String(err);
}

async function parseBody(
  simpleParser: any,
  source: Buffer | undefined,
): Promise<{ text: string; html: string; attachments: ImapAttachmentMeta[] }> {
  if (!source) return { text: '', html: '', attachments: [] };
  try {
    const parsed = await simpleParser(source);
    const attachments: ImapAttachmentMeta[] = (parsed.attachments ?? [])
      .filter((a: any) => a.filename) // skip inline images without filenames
      .map((a: any) => ({
        filename: String(a.filename),
        contentType: String(a.contentType ?? 'application/octet-stream'),
        size: typeof a.size === 'number' ? a.size : undefined,
      }));
    return {
      text: (parsed.text ?? '').slice(0, 10000),
      html: (parsed.html || '').toString().slice(0, 20000),
      attachments,
    };
  } catch {
    return { text: '', html: '', attachments: [] };
  }
}

interface ImapAttachmentMeta {
  filename: string;
  contentType: string;
  size?: number;
}

/**
 * Fetch a specific attachment from an IMAP message. Unlike Gmail/Outlook
 * which have stable attachment ids, IMAP requires re-fetching the
 * message and walking parsed.attachments by filename. Caller should
 * already have the filename from the EmailMessage.attachments[] list.
 *
 * Returns the attachment bytes + the matched filename/contentType.
 */
/**
 * Read-state check for Phase 2c engagement polling — batches multiple
 * uids in one IMAP connection. Returns a Map<uid, isRead>. Yahoo's
 * \Seen flag is the engagement signal — set when the owner opens the
 * email (or marks it read).
 *
 * Designed for the engagement-poll cron which checks dozens of recent
 * messages per tick. Single connection + multi-fetch keeps it cheap.
 */
export async function checkImapReadStates(
  conn: ImapConnection,
  uids: string[],
): Promise<{ success: boolean; data?: Map<string, boolean>; error?: string }> {
  if (!conn.account_email) return { success: false, error: 'IMAP connection missing account email' };
  if (uids.length === 0) return { success: true, data: new Map() };

  let ImapFlow: any;
  try {
    ImapFlow = await loadImapFlow();
    if (!ImapFlow) return { success: false, error: 'imapflow not available' };
  } catch (err: any) {
    return { success: false, error: `imap load failed: ${err?.message ?? err}` };
  }

  const out = new Map<string, boolean>();
  const client = makeClient(ImapFlow, conn);
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const numeric = uids.map((u) => Number(u)).filter((u) => Number.isFinite(u));
      // imapflow fetch by UID — flags only, no source
      for await (const msg of client.fetch(numeric, { flags: true, uid: true })) {
        const flags: Set<string> | undefined = msg.flags;
        const seen = !!flags && (flags.has('\\Seen') || flags.has('\\\\Seen'));
        out.set(String(msg.uid), seen);
      }
      return { success: true, data: out };
    } finally {
      lock.release();
    }
  } catch (err: any) {
    return { success: false, error: `IMAP flag fetch failed: ${imapErrorDetail(err)}` };
  } finally {
    try { await client.logout(); } catch {}
  }
}

export async function fetchImapAttachment(
  conn: ImapConnection,
  uid: string,
  filename: string,
): Promise<{ success: boolean; data?: { filename: string; mimeType: string; bytes: Uint8Array; sizeBytes: number }; error?: string }> {
  if (!conn.account_email) return { success: false, error: 'IMAP connection missing account email' };

  let ImapFlow: any;
  let simpleParser: any;
  try {
    ImapFlow = await loadImapFlow();
    if (!ImapFlow) return { success: false, error: 'imapflow not available' };
    simpleParser = await loadMailparser();
  } catch (err: any) {
    return { success: false, error: `imap deps load failed: ${err?.message ?? err}` };
  }

  const client = makeClient(ImapFlow, conn);
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const numericUid = Number(uid);
      if (!Number.isFinite(numericUid)) return { success: false, error: `invalid uid: ${uid}` };
      const msg = await client.fetchOne(numericUid, { source: true }, { uid: true });
      if (!msg?.source) return { success: false, error: 'message source not returned' };
      const parsed = await simpleParser(msg.source);
      const match = (parsed.attachments ?? []).find((a: any) => a.filename === filename);
      if (!match) return { success: false, error: `attachment "${filename}" not found in message` };
      const content: Buffer = match.content;
      const bytes = new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
      return {
        success: true,
        data: {
          filename: String(match.filename),
          mimeType: String(match.contentType ?? 'application/octet-stream'),
          bytes,
          sizeBytes: bytes.length,
        },
      };
    } finally {
      lock.release();
    }
  } catch (err: any) {
    return { success: false, error: `IMAP attachment fetch failed: ${imapErrorDetail(err)}` };
  } finally {
    try { await client.logout(); } catch {}
  }
}

export async function listImapUnread(conn: ImapConnection, limit = 10): Promise<{ success: boolean; data?: EmailMessage[]; error?: string }> {
  if (!conn.account_email) return { success: false, error: 'IMAP connection missing account email' };

  let ImapFlow: any;
  let simpleParser: any;
  try {
    ImapFlow = await loadImapFlow();
    if (!ImapFlow) return { success: false, error: 'imapflow loaded but ImapFlow constructor not found' };
    simpleParser = await loadMailparser();
  } catch (err: any) {
    return { success: false, error: `imap deps load failed: ${err?.message ?? err}` };
  }

  const client = makeClient(ImapFlow, conn);

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const uids = await client.search({ seen: false, since });
      const slice = (uids ?? []).slice(-limit).reverse();
      const out: EmailMessage[] = [];
      for (const uid of slice) {
        const msg = await client.fetchOne(uid, { envelope: true, source: true });
        if (!msg) continue;
        const env = msg.envelope ?? {};
        const fromAddr = env.from?.[0];
        const body = await parseBody(simpleParser, msg.source);
        const text = body.text || body.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        // For IMAP, the attachment "id" is just the filename — caller
        // re-fetches the message via fetchImapAttachment(uid, filename)
        // to get the bytes. No separate attachment endpoint exists.
        const attachmentRefs = body.attachments.map((a) => ({
          id: a.filename,
          filename: a.filename,
          mimeType: a.contentType,
          sizeBytes: a.size,
        }));
        out.push({
          id: msg.uid?.toString() ?? uid.toString(),
          threadId: env.messageId ?? '',
          from: fromAddr?.address ?? '',
          fromName: fromAddr?.name,
          to: env.to?.map((a: any) => a.address ?? '') ?? [],
          subject: env.subject ?? '(no subject)',
          body: text,
          bodyPreview: text.slice(0, 200),
          date: env.date?.toISOString() ?? new Date().toISOString(),
          isUnread: true,
          hasAttachments: attachmentRefs.length > 0,
          attachments: attachmentRefs,
        });
      }
      return { success: true, data: out };
    } finally {
      lock.release();
    }
  } catch (err: any) {
    return { success: false, error: `IMAP error: ${imapErrorDetail(err)}` };
  } finally {
    try { await client.logout(); } catch {}
  }
}

/**
 * Open-ended IMAP search — finds emails (read or unread) by sender,
 * subject, body keyword, or any combination. Used when the owner says
 * "find John's email about the kitchen rewire" — most often a previously-
 * read message they want to act on later.
 */
export interface ImapSearchQuery {
  /** Optional sender filter — substring match on From address or name. */
  from?: string;
  /** Optional subject substring filter. */
  subject?: string;
  /** Optional body keyword. */
  bodyKeyword?: string;
  /** How far back to search. Default 30 days. */
  sinceDays?: number;
  /** Max results. Default 10. */
  limit?: number;
}

export async function searchImap(conn: ImapConnection, query: ImapSearchQuery): Promise<{ success: boolean; data?: EmailMessage[]; error?: string }> {
  if (!conn.account_email) return { success: false, error: 'IMAP connection missing account email' };

  let ImapFlow: any;
  let simpleParser: any;
  try {
    ImapFlow = await loadImapFlow();
    if (!ImapFlow) return { success: false, error: 'imapflow loaded but ImapFlow constructor not found' };
    simpleParser = await loadMailparser();
  } catch (err: any) {
    return { success: false, error: `imap deps load failed: ${err?.message ?? err}` };
  }

  const client = makeClient(ImapFlow, conn);
  const limit = Math.min(query.limit ?? 10, 25);
  const sinceDays = query.sinceDays ?? 30;

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
      const criteria: any = { since };
      // IMAP supports server-side filters for from/subject/body — much faster
      // than fetching everything then filtering client-side.
      if (query.from) criteria.from = query.from;
      if (query.subject) criteria.subject = query.subject;
      if (query.bodyKeyword) criteria.body = query.bodyKeyword;
      const uids = await client.search(criteria);
      const slice = (uids ?? []).slice(-limit).reverse();
      const out: EmailMessage[] = [];
      for (const uid of slice) {
        try {
          const msg = await client.fetchOne(uid, { envelope: true, source: true, flags: true });
          if (!msg) continue;
          const env = msg.envelope ?? {};
          const fromAddr = env.from?.[0];
          const body = await parseBody(simpleParser, msg.source);
          const text = body.text || body.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          const isUnread = !msg.flags?.has?.('\\Seen');
          out.push({
            id: msg.uid?.toString() ?? uid.toString(),
            threadId: env.messageId ?? '',
            from: fromAddr?.address ?? '',
            fromName: fromAddr?.name,
            to: env.to?.map((a: any) => a.address ?? '') ?? [],
            subject: env.subject ?? '(no subject)',
            body: text,
            bodyPreview: text.slice(0, 200),
            date: env.date?.toISOString() ?? new Date().toISOString(),
            isUnread,
            hasAttachments: false,
          });
        } catch (fetchErr) {
          console.warn('[imap] searchImap fetchOne failed:', imapErrorDetail(fetchErr));
        }
      }
      return { success: true, data: out };
    } finally {
      lock.release();
    }
  } catch (err: any) {
    return { success: false, error: `IMAP error: ${imapErrorDetail(err)}` };
  } finally {
    try { await client.logout(); } catch {}
  }
}

export interface SentEmail {
  id: string;
  to: { address: string; name?: string }[];
  cc: { address: string; name?: string }[];
  subject: string;
  body: string;
  date: string;
}

/** Pull the last N sent emails — used for voice profiling and contact frequency. */
export async function listImapSent(conn: ImapConnection, limit = 50, sinceDays = 90): Promise<{ success: boolean; data?: SentEmail[]; error?: string }> {
  if (!conn.account_email) return { success: false, error: 'IMAP connection missing account email' };

  let ImapFlow: any;
  let simpleParser: any;
  try {
    ImapFlow = await loadImapFlow();
    simpleParser = await loadMailparser();
  } catch (err: any) {
    return { success: false, error: `imap deps load failed: ${err?.message ?? err}` };
  }

  const client = makeClient(ImapFlow, conn);

  try {
    await client.connect();
    const { path: sentPath, available } = await findMailbox(client, '\\Sent', ['Sent', 'Sent Messages', 'Sent Mail', '[Gmail]/Sent Mail', 'INBOX.Sent', 'Sent Items']);
    if (!sentPath) {
      return { success: false, error: `Could not locate Sent folder. Available: ${available.join(', ')}` };
    }
    const lock = await client.getMailboxLock(sentPath);
    try {
      // Try SEARCH first; if Yahoo refuses or times out, fall back to fetching
      // the last N messages by sequence number from the mailbox tail.
      let uidList: number[] = [];
      try {
        const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
        const searched = await client.search({ since });
        uidList = (searched ?? []).slice(-limit).reverse();
      } catch (searchErr) {
        console.warn(`[imap] SENT folder ${sentPath} SEARCH failed (${imapErrorDetail(searchErr)}); falling back to tail-by-sequence`);
        uidList = [];
      }

      const out: SentEmail[] = [];
      const fetchOne = async (uid: number) => {
        try {
          const msg = await client.fetchOne(uid, { envelope: true, source: true });
          if (!msg) return;
          const env = msg.envelope ?? {};
          const body = await parseBody(simpleParser, msg.source);
          const text = body.text || body.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          out.push({
            id: msg.uid?.toString() ?? uid.toString(),
            to: (env.to ?? []).map((a: any) => ({ address: a.address ?? '', name: a.name })),
            cc: (env.cc ?? []).map((a: any) => ({ address: a.address ?? '', name: a.name })),
            subject: env.subject ?? '(no subject)',
            body: text,
            date: env.date?.toISOString() ?? new Date().toISOString(),
          });
        } catch (fetchErr) {
          console.warn(`[imap] SENT fetchOne(${uid}) failed: ${imapErrorDetail(fetchErr)}`);
        }
      };

      if (uidList.length > 0) {
        for (const uid of uidList) await fetchOne(uid);
      } else {
        // Tail fallback: use mailbox.exists message count to grab the last N.
        const exists = client.mailbox?.exists ?? 0;
        if (exists === 0) return { success: true, data: [] };
        const start = Math.max(1, exists - limit + 1);
        const range = `${start}:${exists}`;
        try {
          for await (const msg of client.fetch(range, { envelope: true, source: true })) {
            const env = msg.envelope ?? {};
            const body = await parseBody(simpleParser, msg.source);
            const text = body.text || body.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            out.push({
              id: msg.uid?.toString() ?? msg.seq?.toString() ?? '',
              to: (env.to ?? []).map((a: any) => ({ address: a.address ?? '', name: a.name })),
              cc: (env.cc ?? []).map((a: any) => ({ address: a.address ?? '', name: a.name })),
              subject: env.subject ?? '(no subject)',
              body: text,
              date: env.date?.toISOString() ?? new Date().toISOString(),
            });
          }
          out.reverse();
        } catch (rangeErr) {
          return { success: false, error: `Sent fetch range failed for ${sentPath}: ${imapErrorDetail(rangeErr)}` };
        }
      }
      return { success: true, data: out };
    } finally {
      lock.release();
    }
  } catch (err: any) {
    return { success: false, error: `IMAP sent error: ${imapErrorDetail(err)}` };
  } finally {
    try { await client.logout(); } catch {}
  }
}

export interface SeenInboxEmail {
  id: string;
  from: string;
  fromName?: string;
  subject: string;
  date: string;
}

/** Pull recently READ inbox messages — proxy for "trusted senders" (people
 * the owner actually opens). Lighter than listImapUnread — envelope only. */
export async function listImapSeen(conn: ImapConnection, limit = 50, sinceDays = 30): Promise<{ success: boolean; data?: SeenInboxEmail[]; error?: string }> {
  if (!conn.account_email) return { success: false, error: 'IMAP connection missing account email' };

  let ImapFlow: any;
  try {
    ImapFlow = await loadImapFlow();
  } catch (err: any) {
    return { success: false, error: `imap deps load failed: ${err?.message ?? err}` };
  }

  const client = makeClient(ImapFlow, conn);

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
      const uids = await client.search({ seen: true, since });
      const slice = (uids ?? []).slice(-limit).reverse();
      const out: SeenInboxEmail[] = [];
      for (const uid of slice) {
        const msg = await client.fetchOne(uid, { envelope: true, source: false, headers: ['from', 'subject', 'date'] });
        if (!msg) continue;
        const env = msg.envelope ?? {};
        const fromAddr = env.from?.[0];
        out.push({
          id: msg.uid?.toString() ?? uid.toString(),
          from: fromAddr?.address ?? '',
          fromName: fromAddr?.name,
          subject: env.subject ?? '(no subject)',
          date: env.date?.toISOString() ?? new Date().toISOString(),
        });
      }
      return { success: true, data: out };
    } finally {
      lock.release();
    }
  } catch (err: any) {
    return { success: false, error: `IMAP seen error: ${imapErrorDetail(err)}` };
  } finally {
    try { await client.logout(); } catch {}
  }
}

/** Lightweight inbox scan — pulls envelope-only metadata for ALL messages
 * (read or unread) in the time window. Used by email-followup to detect
 * which sent emails got a reply. */
export async function listImapInboxSince(conn: ImapConnection, sinceDays = 14): Promise<{ success: boolean; data?: SeenInboxEmail[]; error?: string }> {
  if (!conn.account_email) return { success: false, error: 'IMAP connection missing account email' };

  let ImapFlow: any;
  try {
    ImapFlow = await loadImapFlow();
  } catch (err: any) {
    return { success: false, error: `imap deps load failed: ${err?.message ?? err}` };
  }

  const client = makeClient(ImapFlow, conn);

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
      let uidList: number[] = [];
      try {
        const searched = await client.search({ since });
        uidList = searched ?? [];
      } catch (searchErr) {
        console.warn(`[imap] INBOX SEARCH failed (${imapErrorDetail(searchErr)}); falling back to tail-by-sequence`);
        const exists = client.mailbox?.exists ?? 0;
        const start = Math.max(1, exists - 200);
        try {
          const out: SeenInboxEmail[] = [];
          for await (const msg of client.fetch(`${start}:${exists}`, { envelope: true, source: false })) {
            const env = msg.envelope ?? {};
            const date = env.date ? new Date(env.date) : null;
            if (date && date < since) continue;
            const fromAddr = env.from?.[0];
            out.push({
              id: msg.uid?.toString() ?? msg.seq?.toString() ?? '',
              from: fromAddr?.address ?? '',
              fromName: fromAddr?.name,
              subject: env.subject ?? '(no subject)',
              date: date?.toISOString() ?? new Date().toISOString(),
            });
          }
          return { success: true, data: out };
        } catch (rangeErr) {
          return { success: false, error: `Inbox range fetch failed: ${imapErrorDetail(rangeErr)}` };
        }
      }

      const out: SeenInboxEmail[] = [];
      for (const uid of uidList) {
        try {
          const msg = await client.fetchOne(uid, { envelope: true, source: false, headers: ['from', 'subject', 'date'] });
          if (!msg) continue;
          const env = msg.envelope ?? {};
          const fromAddr = env.from?.[0];
          out.push({
            id: msg.uid?.toString() ?? uid.toString(),
            from: fromAddr?.address ?? '',
            fromName: fromAddr?.name,
            subject: env.subject ?? '(no subject)',
            date: env.date?.toISOString() ?? new Date().toISOString(),
          });
        } catch (fetchErr) {
          console.warn(`[imap] INBOX fetchOne(${uid}) failed: ${imapErrorDetail(fetchErr)}`);
        }
      }
      return { success: true, data: out };
    } finally {
      lock.release();
    }
  } catch (err: any) {
    return { success: false, error: `IMAP inbox-since error: ${imapErrorDetail(err)}` };
  } finally {
    try { await client.logout(); } catch {}
  }
}

interface SendRequest {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  inReplyToMessageId?: string;
}

/**
 * Send an email via SMTP. Uses the user's stored app password (same one as IMAP).
 * Yahoo SMTP: smtp.mail.yahoo.com:465 (SSL).
 */
export async function sendImap(conn: ImapConnection, req: SendRequest): Promise<{ success: boolean; data?: { messageId: string }; error?: string }> {
  if (!conn.account_email) return { success: false, error: 'IMAP connection missing account email' };
  if (!req.to?.length) return { success: false, error: 'No recipients' };

  let nodemailer: any;
  try {
    nodemailer = (await import('nodemailer')).default ?? (await import('nodemailer'));
  } catch (err: any) {
    return { success: false, error: `nodemailer load failed: ${err?.message ?? err}` };
  }

  const host = conn.metadata?.smtp_host || YAHOO_SMTP_HOST;
  const port = conn.metadata?.smtp_port || YAHOO_SMTP_PORT;
  const secure = port === 465;

  const transporter = nodemailer.createTransport({
    host, port, secure,
    auth: { user: conn.account_email, pass: conn.access_token },
  });

  try {
    const info = await transporter.sendMail({
      from: conn.account_email,
      to: req.to.join(', '),
      cc: req.cc?.join(', '),
      bcc: req.bcc?.join(', '),
      subject: req.subject,
      text: req.body,
      inReplyTo: req.inReplyToMessageId,
      references: req.inReplyToMessageId,
    });
    return { success: true, data: { messageId: info.messageId } };
  } catch (err: any) {
    return { success: false, error: `SMTP error: ${err?.message ?? err}` };
  }
}

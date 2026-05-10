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
 * Falls back to a list of common names for the role. */
async function findMailbox(client: any, attribute: string, fallbacks: string[]): Promise<string | null> {
  try {
    const list = await client.list();
    const match = list.find((m: any) => Array.isArray(m.specialUse) ? m.specialUse.includes(attribute) : m.specialUse === attribute);
    if (match) return match.path;
    for (const name of fallbacks) {
      const hit = list.find((m: any) => m.path === name || m.name === name);
      if (hit) return hit.path;
    }
  } catch {
    // ignore
  }
  return null;
}

async function parseBody(simpleParser: any, source: Buffer | undefined): Promise<{ text: string; html: string }> {
  if (!source) return { text: '', html: '' };
  try {
    const parsed = await simpleParser(source);
    return {
      text: (parsed.text ?? '').slice(0, 10000),
      html: (parsed.html || '').toString().slice(0, 20000),
    };
  } catch {
    return { text: '', html: '' };
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
          hasAttachments: false,
        });
      }
      return { success: true, data: out };
    } finally {
      lock.release();
    }
  } catch (err: any) {
    return { success: false, error: `IMAP error: ${err?.message ?? err}` };
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
    const sentPath = await findMailbox(client, '\\Sent', ['Sent', 'Sent Messages', 'Sent Mail', '[Gmail]/Sent Mail', 'INBOX.Sent']);
    if (!sentPath) {
      return { success: false, error: 'Could not locate Sent folder' };
    }
    const lock = await client.getMailboxLock(sentPath);
    try {
      const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
      const uids = await client.search({ since });
      const slice = (uids ?? []).slice(-limit).reverse();
      const out: SentEmail[] = [];
      for (const uid of slice) {
        const msg = await client.fetchOne(uid, { envelope: true, source: true });
        if (!msg) continue;
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
      }
      return { success: true, data: out };
    } finally {
      lock.release();
    }
  } catch (err: any) {
    return { success: false, error: `IMAP sent error: ${err?.message ?? err}` };
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
    return { success: false, error: `IMAP seen error: ${err?.message ?? err}` };
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

/**
 * Generic IMAP client — used for any provider that doesn't have OAuth (Yahoo, generic IMAP).
 *
 * The customer authenticates with email + app-specific password (NOT their main password).
 * Yahoo: https://help.yahoo.com/kb/SLN15241.html
 * Generic IMAP: any host + port + creds.
 *
 * Connection metadata expected on the OAuth row:
 *   metadata.imap_host   — e.g. imap.mail.yahoo.com
 *   metadata.imap_port   — e.g. 993
 *   metadata.imap_secure — true for TLS (default true)
 */

import type {
  EmailMessage,
  IntegrationContext,
  IntegrationResult,
} from './types';

interface ImapContext extends IntegrationContext {
  username: string;
  metadata?: {
    imap_host?: string;
    imap_port?: number;
    imap_secure?: boolean;
    [key: string]: unknown;
  };
}

const YAHOO_HOST = 'imap.mail.yahoo.com';

/**
 * Connect to IMAP, fetch unread messages from the last 24 hours, and return them
 * as normalized EmailMessage objects.
 */
export async function listUnreadMessages(
  ctx: ImapContext,
  limit = 10,
): Promise<IntegrationResult<EmailMessage[]>> {
  // imapflow uses Node-only modules (dns/net/tls). The eval('require') trick
  // hides the dependency from Turbopack/webpack static analysis so it isn't
  // pulled into the bundle. This file is only ever called from server-side
  // routes (cron, webhook, deck chat) — the runtime is always Node.
  let ImapFlow: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ImapFlow = (eval('require'))('imapflow').ImapFlow;
  } catch (err) {
    return { success: false, error: `imapflow not installed: ${err}` };
  }

  const host = ctx.metadata?.imap_host || YAHOO_HOST;
  const port = ctx.metadata?.imap_port || 993;
  const secure = ctx.metadata?.imap_secure !== false;

  if (!host) return { success: false, error: 'No IMAP host configured.' };
  if (!ctx.username) return { success: false, error: 'No IMAP username.' };
  if (!ctx.accessToken) return { success: false, error: 'No IMAP password (stored as access_token).' };

  const client = new ImapFlow({
    host,
    port,
    secure,
    auth: { user: ctx.username, pass: ctx.accessToken },
    logger: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      // Search for unseen messages from the last 24h
      const uids = await client.search({ seen: false, since });
      const slice = uids.slice(-limit).reverse();

      const out: EmailMessage[] = [];
      for (const uid of slice) {
        const msg = await client.fetchOne(uid, { envelope: true, source: false, bodyStructure: true, headers: ['from', 'subject', 'date'] });
        if (!msg) continue;
        const env = msg.envelope ?? {};
        const fromAddr = env.from?.[0];
        out.push({
          id: msg.uid?.toString() ?? uid.toString(),
          threadId: env.messageId ?? '',
          from: fromAddr?.address ?? '',
          fromName: fromAddr?.name,
          to: env.to?.map((a: any) => a.address ?? '') ?? [],
          subject: env.subject ?? '(no subject)',
          body: '', // body not fetched in this lightweight pass
          bodyPreview: '', // imapflow's preview requires fetching body — keep light for now
          date: env.date?.toISOString() ?? new Date().toISOString(),
          isUnread: true,
          hasAttachments: false,
        });
      }
      return { success: true, data: out };
    } finally {
      lock.release();
    }
  } catch (err) {
    return { success: false, error: `IMAP error: ${err}` };
  } finally {
    try {
      await client.logout();
    } catch {}
  }
}

/**
 * Verify IMAP credentials by attempting a login. Used by the OAuth route to validate
 * what the user entered before saving to oauth_connections.
 */
export async function verifyImapLogin(
  host: string,
  port: number,
  username: string,
  password: string,
  secure = true,
): Promise<{ ok: boolean; error?: string }> {
  let ImapFlow: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ImapFlow = (eval('require'))('imapflow').ImapFlow;
  } catch (err) {
    return { ok: false, error: `imapflow not installed: ${err}` };
  }

  const client = new ImapFlow({
    host,
    port,
    secure,
    auth: { user: username, pass: password },
    logger: false,
  });

  try {
    await client.connect();
    await client.logout();
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

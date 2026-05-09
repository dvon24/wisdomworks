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
  metadata?: { imap_host?: string; imap_port?: number; imap_secure?: boolean };
}

const YAHOO_HOST = 'imap.mail.yahoo.com';

export async function listImapUnread(conn: ImapConnection, limit = 10): Promise<{ success: boolean; data?: EmailMessage[]; error?: string }> {
  if (!conn.account_email) return { success: false, error: 'IMAP connection missing account email' };

  let ImapFlow: any;
  try {
    const mod: any = await import('imapflow');
    ImapFlow = mod.ImapFlow ?? mod.default?.ImapFlow ?? mod.default;
    if (!ImapFlow) return { success: false, error: 'imapflow loaded but ImapFlow constructor not found' };
  } catch (err: any) {
    return { success: false, error: `imapflow load failed: ${err?.message ?? err}` };
  }

  const host = conn.metadata?.imap_host || YAHOO_HOST;
  const port = conn.metadata?.imap_port || 993;
  const secure = conn.metadata?.imap_secure !== false;

  const client = new ImapFlow({
    host, port, secure,
    auth: { user: conn.account_email, pass: conn.access_token },
    logger: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const uids = await client.search({ seen: false, since });
      const slice = (uids ?? []).slice(-limit).reverse();
      const out: EmailMessage[] = [];
      for (const uid of slice) {
        const msg = await client.fetchOne(uid, { envelope: true, source: false, headers: ['from', 'subject', 'date'] });
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
          body: '',
          bodyPreview: '',
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

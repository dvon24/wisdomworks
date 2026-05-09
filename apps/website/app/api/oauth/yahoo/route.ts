/**
 * Yahoo Mail connection — uses IMAP with an app-specific password.
 *
 * POST /api/oauth/yahoo
 * { phoneNumber, yahooEmail, appPassword }
 *
 * Yahoo doesn't expose third-party OAuth for IMAP; users must generate an
 * app password at https://login.yahoo.com/account/security → "Generate app password".
 * We verify by attempting an IMAP login, then save.
 */

import { saveConnection } from '../_lib/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

const YAHOO_IMAP_HOST = 'imap.mail.yahoo.com';
const YAHOO_IMAP_PORT = 993;

async function verifyImapLogin(host: string, port: number, username: string, password: string): Promise<{ ok: boolean; error?: string }> {
  // Hide the import from Turbopack's static analysis — imapflow uses Node-only
  // modules (dns/net/tls) that shouldn't be bundled. The eval keeps the require
  // out of the build graph; this file is server-only (runtime = 'nodejs').
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ImapFlow } = (eval('require'))('imapflow') as any;
  const client = new ImapFlow({
    host,
    port,
    secure: true,
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

export async function POST(request: Request) {
  try {
    const { phoneNumber, yahooEmail, appPassword } = await request.json();

    if (!phoneNumber || !yahooEmail || !appPassword) {
      return Response.json({ error: 'Missing fields' }, { status: 400 });
    }

    const cleanPassword = appPassword.replace(/\s/g, '');
    if (cleanPassword.length < 12) {
      return Response.json(
        { error: 'Yahoo app passwords are 16 characters. Generate one at login.yahoo.com → Account Security.' },
        { status: 400 },
      );
    }

    const verify = await verifyImapLogin(YAHOO_IMAP_HOST, YAHOO_IMAP_PORT, yahooEmail, cleanPassword);
    if (!verify.ok) {
      console.error('[yahoo-imap] Verification failed:', verify.error);
      return Response.json(
        { error: `Could not log in. ${verify.error ?? 'Check the email and app password.'}` },
        { status: 401 },
      );
    }

    const cleanPhone = phoneNumber.replace(/[\s\-\+\(\)]/g, '');
    await saveConnection({
      phone_number: cleanPhone,
      provider: 'yahoo',
      service: 'email',
      account_email: yahooEmail,
      account_name: yahooEmail.split('@')[0],
      access_token: cleanPassword,
      metadata: { imap_host: YAHOO_IMAP_HOST, imap_port: YAHOO_IMAP_PORT, imap_secure: true },
    });

    console.log(`[yahoo-imap] Connected ${yahooEmail} for ${cleanPhone}`);
    return Response.json({ success: true, accountEmail: yahooEmail });
  } catch (err) {
    console.error('[yahoo-imap] Error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

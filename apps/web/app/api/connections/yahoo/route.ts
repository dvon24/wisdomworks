/**
 * Connect Yahoo Mail from the Command Deck.
 * Same logic as apps/website/api/oauth/yahoo, but lives on the deck so users
 * can add a connection without going back through onboarding.
 *
 * POST /api/connections/yahoo
 * { phone, email, appPassword }
 */

import { saveConnection } from '../_lib/save';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

const YAHOO_IMAP_HOST = 'imap.mail.yahoo.com';
const YAHOO_IMAP_PORT = 993;

async function verifyImap(host: string, port: number, user: string, pass: string): Promise<{ ok: boolean; error?: string }> {
  // Plain dynamic import — apps/web routes are not transpiled by the monorepo
  // packager, so serverExternalPackages: ['imapflow'] correctly externalises
  // and Vercel's NFT picks up the import.
  const mod: any = await import('imapflow');
  const ImapFlow = mod.ImapFlow ?? mod.default?.ImapFlow ?? mod.default;
  const client = new ImapFlow({ host, port, secure: true, auth: { user, pass }, logger: false });
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
    const { phone, email, appPassword } = await request.json();
    if (!phone || !email || !appPassword) {
      return Response.json({ error: 'phone, email, and appPassword required' }, { status: 400 });
    }
    const cleanPassword = appPassword.replace(/\s/g, '');
    if (cleanPassword.length < 12) {
      return Response.json(
        { error: 'Yahoo app passwords are 16 characters. Generate one at login.yahoo.com → Account Security.' },
        { status: 400 },
      );
    }

    const verify = await verifyImap(YAHOO_IMAP_HOST, YAHOO_IMAP_PORT, email, cleanPassword);
    if (!verify.ok) {
      return Response.json({ error: `Could not log in. ${verify.error ?? 'Check email + password.'}` }, { status: 401 });
    }

    const cleanPhone = phone.replace(/[\s\-+()]/g, '');
    const saved = await saveConnection({
      phone_number: cleanPhone,
      provider: 'yahoo',
      service: 'email',
      account_email: email,
      account_name: email.split('@')[0],
      access_token: cleanPassword,
      metadata: { imap_host: YAHOO_IMAP_HOST, imap_port: YAHOO_IMAP_PORT, imap_secure: true },
    });
    if (!saved.ok) {
      return Response.json(
        { error: `IMAP login worked but the database write failed. ${saved.error ?? ''}`.trim() },
        { status: 500 },
      );
    }
    return Response.json({ success: true, accountEmail: email });
  } catch (err) {
    console.error('[connections/yahoo]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

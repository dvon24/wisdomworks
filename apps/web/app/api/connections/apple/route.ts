/**
 * Connect Apple iCloud Calendar from the Command Deck.
 *
 * POST /api/connections/apple
 * { phone, email, appPassword }
 */

import { saveConnection } from '../_lib/save';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

const CALDAV_URL = 'https://caldav.icloud.com';

export async function POST(request: Request) {
  try {
    const { phone, email, appPassword } = await request.json();
    if (!phone || !email || !appPassword) {
      return Response.json({ error: 'phone, email, and appPassword required' }, { status: 400 });
    }
    const cleanPassword = appPassword.replace(/[\s\-]/g, '');
    if (cleanPassword.length !== 16) {
      return Response.json(
        { error: 'Apple app-specific passwords are 16 characters (xxxx-xxxx-xxxx-xxxx).' },
        { status: 400 },
      );
    }

    // Verify by attempting a CalDAV PROPFIND
    const auth = Buffer.from(`${email}:${cleanPassword}`).toString('base64');
    const verifyRes = await fetch(`${CALDAV_URL}/.well-known/caldav`, {
      method: 'PROPFIND',
      headers: {
        Authorization: `Basic ${auth}`,
        Depth: '0',
        'Content-Type': 'application/xml',
      },
      body: `<?xml version="1.0" encoding="utf-8"?>
<propfind xmlns="DAV:">
  <prop>
    <current-user-principal/>
  </prop>
</propfind>`,
      redirect: 'follow',
    });
    if (verifyRes.status !== 207 && verifyRes.status !== 200) {
      return Response.json({ error: 'Could not connect. Check email and app-specific password.' }, { status: 401 });
    }

    const cleanPhone = phone.replace(/[\s\-+()]/g, '');
    const saved = await saveConnection({
      phone_number: cleanPhone,
      provider: 'apple',
      service: 'calendar',
      account_email: email,
      account_name: email.split('@')[0],
      access_token: cleanPassword,
      metadata: { caldav_url: CALDAV_URL },
    });
    if (!saved.ok) {
      return Response.json(
        { error: `CalDAV login worked but the database write failed. ${saved.error ?? ''}`.trim() },
        { status: 500 },
      );
    }
    return Response.json({ success: true, accountEmail: email });
  } catch (err) {
    console.error('[connections/apple]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

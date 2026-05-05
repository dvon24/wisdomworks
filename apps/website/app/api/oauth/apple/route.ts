/**
 * Apple iCloud connection — uses CalDAV with app-specific password.
 *
 * POST /api/oauth/apple
 * { phoneNumber, iCloudEmail, appPassword }
 *
 * Apple doesn't have OAuth — instead, the user generates an app-specific password
 * at appleid.apple.com. We verify it works by attempting a CalDAV PROPFIND, then save.
 */

import { saveConnection } from '../_lib/store';

export const dynamic = 'force-dynamic';

const CALDAV_URL = 'https://caldav.icloud.com';

export async function POST(request: Request) {
  try {
    const { phoneNumber, iCloudEmail, appPassword } = await request.json();

    if (!phoneNumber || !iCloudEmail || !appPassword) {
      return Response.json({ error: 'Missing fields' }, { status: 400 });
    }

    // Clean app password — Apple shows it with dashes, accept either
    const cleanPassword = appPassword.replace(/[\s\-]/g, '');
    if (cleanPassword.length !== 16) {
      return Response.json(
        { error: 'App-specific password should be 16 characters (xxxx-xxxx-xxxx-xxxx)' },
        { status: 400 },
      );
    }

    // Verify by attempting a PROPFIND on the principal URL
    const auth = Buffer.from(`${iCloudEmail}:${cleanPassword}`).toString('base64');
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
      console.error('[apple-caldav] Verification failed:', verifyRes.status);
      return Response.json(
        { error: 'Could not connect. Check email and app-specific password.' },
        { status: 401 },
      );
    }

    // Save — Apple connection covers calendar (no email via CalDAV)
    const cleanPhone = phoneNumber.replace(/[\s\-\+\(\)]/g, '');
    await saveConnection({
      phone_number: cleanPhone,
      provider: 'apple',
      service: 'calendar',
      account_email: iCloudEmail,
      account_name: iCloudEmail.split('@')[0],
      // Store the app password as the "access token" — Basic auth, no expiry
      access_token: cleanPassword,
      metadata: { caldav_url: CALDAV_URL },
    });

    console.log(`[apple-caldav] Connected ${iCloudEmail} for ${cleanPhone}`);
    return Response.json({ success: true, accountEmail: iCloudEmail });
  } catch (err) {
    console.error('[apple-caldav] Error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

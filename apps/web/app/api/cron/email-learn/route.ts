/**
 * Daily email-learn cron — refresh voice profile + contact frequency.
 *
 * Walks every tenant with an IMAP/Yahoo connection. For each:
 *   1. Pull last 50 sent emails → ingestSentEmails (contact frequency) +
 *      refreshVoiceProfile (mine writing style with Sonnet, once per day).
 *   2. Pull last 50 read inbox messages → ingestSeenInbox (trusted senders).
 *
 * Cost: one Sonnet call per tenant per day, plus the IMAP fetches. Bounded.
 */

import { NextResponse } from 'next/server';
import { listImapSent, listImapSeen } from '../../_lib/imap-runtime';
import { ingestSentEmails, ingestSeenInbox, refreshVoiceProfile } from '../../_lib/email-intelligence';

// Make sure NFT picks up these deps in the Vercel lambda.
import 'imapflow';
import 'mailparser';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

interface OauthConn {
  phone_number: string;
  provider: string;
  service: string;
  account_email: string;
  access_token: string;
  metadata: any;
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  try {
    const connRes = await fetch(
      `${SUPABASE_URL}/rest/v1/oauth_connections?status=eq.active&select=phone_number,provider,service,account_email,access_token,metadata&service=eq.email`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
    );
    const conns: OauthConn[] = connRes.ok ? await connRes.json() : [];
    const imapConns = conns.filter((c) => c.provider === 'yahoo' || c.provider === 'imap' || c.provider === 'apple');

    let voiceBuilt = 0;
    let totalSent = 0;
    let totalSeen = 0;
    let failures = 0;

    for (const conn of imapConns) {
      try {
        // Sent — drives both contact frequency and voice profile
        const sent = await listImapSent({
          provider: conn.provider,
          service: conn.service,
          account_email: conn.account_email,
          access_token: conn.access_token,
          metadata: conn.metadata,
        }, 50, 90);

        if (sent.success && sent.data && sent.data.length > 0) {
          const ing = await ingestSentEmails(conn.phone_number, sent.data);
          totalSent += ing.recipients;
          const refreshed = await refreshVoiceProfile(conn.phone_number, sent.data);
          if (refreshed.built) voiceBuilt++;
        } else if (!sent.success) {
          console.warn(`[email-learn] sent fetch failed for ${conn.phone_number}: ${sent.error}`);
        }

        // Seen inbox — trusted senders
        const seen = await listImapSeen({
          provider: conn.provider,
          service: conn.service,
          account_email: conn.account_email,
          access_token: conn.access_token,
          metadata: conn.metadata,
        }, 50, 30);

        if (seen.success && seen.data && seen.data.length > 0) {
          const ing = await ingestSeenInbox(conn.phone_number, seen.data);
          totalSeen += ing.contacts;
        }
      } catch (err) {
        failures++;
        console.warn(`[email-learn] tenant ${conn.phone_number} failed:`, err);
      }
    }

    console.log(`[email-learn] tenants=${imapConns.length} voiceBuilt=${voiceBuilt} sentRecipients=${totalSent} seenContacts=${totalSeen} failures=${failures}`);
    return NextResponse.json({
      ok: true,
      tenants: imapConns.length,
      voiceBuilt,
      sentRecipients: totalSent,
      seenContacts: totalSeen,
      failures,
    });
  } catch (err) {
    console.error('[email-learn] error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

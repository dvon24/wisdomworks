/**
 * Daily email-followup cron — propose follow-ups for stale sent emails.
 *
 * For each tenant with an IMAP connection:
 *   1. Pull last 14 days of sent emails (listImapSent)
 *   2. Pull last 14 days of received emails (listImapInboxSince)
 *   3. Detect candidates: sent 5+ days ago, no reply received, single
 *      recipient, not a reply/forward, recipient isn't a no-reply address
 *   4. For each candidate, draft a follow-up using the voice profile
 *   5. Insert into email_followup_proposals (partial-unique on PENDING
 *      dedups so we don't re-prompt the same thread daily)
 *   6. Push a WhatsApp message to the owner with the pre-drafted text
 *
 * Owner replies via WhatsApp using list_pending_followups / approve_followup
 * / decline_followup tools.
 */

import { NextResponse } from 'next/server';
import { decryptToken } from '@wisdomworks/shared';
import { listImapSent, listImapInboxSince } from '../../_lib/imap-runtime';
import {
  detectFollowupCandidates,
  draftFollowup,
  persistProposal,
  expireStaleFollowups,
} from '../../_lib/email-followup';
import { enqueueNotification } from '../../_lib/notifications';

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

/** Enqueue the follow-up as a notification — drained into the next
 * scheduled digest (morning / lunch / afternoon). User replies 'send [id]'
 * later to actually send. */
async function enqueueFollowupPrompt(tenantPhone: string, proposalId: string, recipientLabel: string, days: number, subject: string): Promise<void> {
  // Dedup keys — recipient + a distinguishing subject token. If the
  // owner recently said "already sent <recipient>" or "done <token>",
  // the enqueue pre-flight drops this notification.
  const subjectKeyword = subject.split(/\s+/).filter((w) => w.length >= 4).slice(0, 2).join(' ');
  await enqueueNotification({
    tenantPhone,
    kind: 'followup_prompt',
    severity: days >= 14 ? 'high' : 'medium',
    title: `Follow up with ${recipientLabel} on "${subject}"`,
    body: `${days} days since you sent. Reply 'send ${proposalId.slice(0, 8)}' to send the drafted follow-up, or 'show ${proposalId.slice(0, 8)}' to review it first.`,
    sourceAgent: 'email-followup',
    sourceId: proposalId,
    metadata: { days_since_sent: days, recipient: recipientLabel },
    topicKeywords: [recipientLabel, subjectKeyword].filter((s) => s && s.length >= 3),
  });
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
    // Expire stale pending proposals first so the slots free up
    const expired = await expireStaleFollowups();

    const connRes = await fetch(
      `${SUPABASE_URL}/rest/v1/oauth_connections?status=eq.active&service=eq.email&select=phone_number,provider,service,account_email,access_token,metadata`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
    );
    const conns: OauthConn[] = connRes.ok ? await connRes.json() : [];
    const imapConns = conns.filter((c) => c.provider === 'yahoo' || c.provider === 'imap' || c.provider === 'apple');

    let candidatesFound = 0;
    let proposalsCreated = 0;
    let dedups = 0;
    let whatsappSent = 0;
    let failures = 0;

    for (const conn of imapConns) {
      try {
        const password = await decryptToken(conn.access_token);
        const imapConn = {
          provider: conn.provider,
          service: conn.service,
          account_email: conn.account_email,
          access_token: password,
          metadata: conn.metadata,
        };

        const [sentRes, inboxRes] = await Promise.all([
          listImapSent(imapConn, 50, 21),
          listImapInboxSince(imapConn, 21),
        ]);

        if (!sentRes.success || !sentRes.data) {
          console.warn(`[email-followup] sent fetch failed for ${conn.phone_number}: ${sentRes.error}`);
          failures++;
          continue;
        }
        if (!inboxRes.success || !inboxRes.data) {
          console.warn(`[email-followup] inbox fetch failed for ${conn.phone_number}: ${inboxRes.error}`);
          // We can still detect — just won't know who replied. Be conservative and skip.
          failures++;
          continue;
        }

        const candidates = detectFollowupCandidates(sentRes.data, inboxRes.data);
        candidatesFound += candidates.length;
        console.log(`[email-followup] tenant ${conn.phone_number}: ${sentRes.data.length} sent, ${inboxRes.data.length} inbox, ${candidates.length} candidates after dedup+filter+reply-check`);

        for (const candidate of candidates) {
          const draft = await draftFollowup({
            tenantPhone: conn.phone_number,
            recipientName: candidate.recipient_name,
            recipientAddress: candidate.recipient_address,
            originalSubject: candidate.original_subject,
            originalSnippet: candidate.original_snippet,
            daysSinceSent: candidate.days_since_sent,
          });
          if (!draft) continue;

          const persist = await persistProposal(conn.phone_number, candidate, draft);
          if (persist.deduped) {
            dedups++;
            continue;
          }
          if (persist.error || !persist.id) {
            console.warn(`[email-followup] persist failed for ${conn.phone_number}: ${persist.error}`);
            failures++;
            continue;
          }
          proposalsCreated++;

          await enqueueFollowupPrompt(
            conn.phone_number,
            persist.id,
            candidate.recipient_name ? `${candidate.recipient_name} <${candidate.recipient_address}>` : candidate.recipient_address,
            candidate.days_since_sent,
            candidate.original_subject,
          );
          whatsappSent++; // counter name kept; tracks queued items now
        }
      } catch (err) {
        failures++;
        console.warn(`[email-followup] tenant ${conn.phone_number} failed:`, err);
      }
    }

    console.log(`[email-followup] tenants=${imapConns.length} candidates=${candidatesFound} created=${proposalsCreated} deduped=${dedups} pushed=${whatsappSent} expired=${expired} failures=${failures}`);
    return NextResponse.json({
      ok: true,
      tenants: imapConns.length,
      candidates: candidatesFound,
      created: proposalsCreated,
      deduped: dedups,
      pushed: whatsappSent,
      expired,
      failures,
    });
  } catch (err) {
    console.error('[email-followup] error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

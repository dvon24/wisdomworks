/**
 * Email follow-up reminders.
 *
 * Detect sent emails that haven't been replied to after N days, draft a
 * polite follow-up using the owner's voice profile, store as a pending
 * proposal, and push to WhatsApp pre-drafted. Owner reviews and either
 * sends, declines, or edits.
 */

import type { SentEmail, SeenInboxEmail } from './imap-runtime';
import { getVoiceProfile, renderVoiceForDraft } from './email-intelligence';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

/** Threshold knobs — keep in one place so we can tune without hunting. */
const FOLLOWUP_DAYS_MIN = 5; // earliest we'll suggest a follow-up
const FOLLOWUP_DAYS_MAX = 21; // beyond this it's stale, skip
const MAX_RECIPIENTS_FOR_FOLLOWUP = 3; // anything above looks like a blast
const NO_REPLY_PATTERNS = [
  /^no[\-_]?reply@/i,
  /^do[\-_]?not[\-_]?reply@/i,
  /^notifications?@/i,
  /^automated?@/i,
  /^mailer[\-_]?daemon@/i,
  /^postmaster@/i,
  /^bounce/i,
  /^updates?@/i,
  /^newsletter@/i,
  /^marketing@/i,
];

export interface FollowupCandidate {
  recipient_address: string;
  recipient_name?: string;
  original_message_id?: string;
  original_subject: string;
  original_sent_at: string;
  original_snippet: string;
  days_since_sent: number;
}

export interface FollowupProposal {
  id: string;
  tenant_phone: string;
  recipient_address: string;
  recipient_name?: string;
  original_message_id?: string;
  original_subject: string;
  original_sent_at: string;
  original_snippet: string;
  days_since_sent: number;
  draft_subject?: string;
  draft_body: string;
  status: 'pending' | 'sent' | 'declined' | 'expired';
  proposed_at: string;
}

/** Strip "Re:", "RE:", "Fwd:", "FW:" etc. so a thread groups under one key. */
function normalizeSubject(subject: string): string {
  return subject.replace(/^(re|fw|fwd|aw|sv)\s*:\s*/gi, '').trim().toLowerCase();
}

/** Static filter — recipient/subject/age sanity checks that don't depend
 * on whether they replied. */
function passesStaticFilters(sent: SentEmail): { ok: boolean; reason?: string } {
  const sentAt = new Date(sent.date);
  const ageDays = (Date.now() - sentAt.getTime()) / (1000 * 60 * 60 * 24);

  if (ageDays < FOLLOWUP_DAYS_MIN) return { ok: false, reason: `too recent (${ageDays.toFixed(1)}d)` };
  if (ageDays > FOLLOWUP_DAYS_MAX) return { ok: false, reason: `too old (${ageDays.toFixed(1)}d)` };

  const recipients = sent.to.filter((r) => r.address);
  if (recipients.length === 0) return { ok: false, reason: 'no recipients' };
  if (recipients.length > MAX_RECIPIENTS_FOR_FOLLOWUP) {
    return { ok: false, reason: `${recipients.length} recipients (looks like blast)` };
  }
  for (const r of recipients) {
    if (NO_REPLY_PATTERNS.some((p) => p.test(r.address))) {
      return { ok: false, reason: `automated address: ${r.address}` };
    }
  }
  return { ok: true };
}

export function detectFollowupCandidates(sent: SentEmail[], inbox: SeenInboxEmail[]): FollowupCandidate[] {
  // 1. Thread dedup: group sent emails by (primary recipient, normalized subject)
  // and keep only the LATEST one per thread. We never want to propose follow-ups
  // for two messages in the same conversation.
  const byThread = new Map<string, SentEmail>();
  for (const email of sent) {
    const primary = email.to.find((r) => r.address) ?? email.cc[0];
    if (!primary?.address) continue;
    const key = `${primary.address.toLowerCase()}|${normalizeSubject(email.subject)}`;
    const existing = byThread.get(key);
    if (!existing || new Date(email.date) > new Date(existing.date)) {
      byThread.set(key, email);
    }
  }

  const candidates: FollowupCandidate[] = [];
  for (const email of byThread.values()) {
    const filterResult = passesStaticFilters(email);
    if (!filterResult.ok) continue;

    const primary = email.to.find((r) => r.address) ?? email.cc[0];
    if (!primary) continue;
    const recipientAddr = primary.address.toLowerCase();
    const sentAt = new Date(email.date);

    // 2. Reply detection: did the recipient email back about THIS THREAD
    // since the sent date? Match by sender AND normalized subject so a
    // reply to a different thread doesn't false-positive.
    const sentNormSubject = normalizeSubject(email.subject);
    const replied = inbox.some((inboxMsg) => {
      if (!inboxMsg.from) return false;
      if (inboxMsg.from.toLowerCase() !== recipientAddr) return false;
      if (new Date(inboxMsg.date) <= sentAt) return false;
      // Subject match — both should normalize to the same thread
      if (normalizeSubject(inboxMsg.subject) !== sentNormSubject) return false;
      return true;
    });
    if (replied) continue;

    const ageDays = Math.floor((Date.now() - sentAt.getTime()) / (1000 * 60 * 60 * 24));
    candidates.push({
      recipient_address: recipientAddr,
      recipient_name: primary.name,
      original_message_id: email.id,
      original_subject: email.subject,
      original_sent_at: email.date,
      original_snippet: email.body.replace(/\s+/g, ' ').slice(0, 600),
      days_since_sent: ageDays,
    });
  }
  return candidates;
}

/**
 * Generate the follow-up draft text using the owner's voice profile.
 * Returns null if Anthropic isn't configured or generation fails.
 */
export async function draftFollowup(args: {
  tenantPhone: string;
  recipientName?: string;
  recipientAddress: string;
  originalSubject: string;
  originalSnippet: string;
  daysSinceSent: number;
}): Promise<{ subject: string; body: string } | null> {
  if (!ANTHROPIC_API_KEY) return null;

  const profile = await getVoiceProfile(args.tenantPhone);
  const voiceBlock = renderVoiceForDraft(profile);

  const subject = /^re:\s/i.test(args.originalSubject) ? args.originalSubject : `Re: ${args.originalSubject}`;

  const system = `You draft a polite follow-up email to someone who hasn't replied to a prior message. Keep it short, low-pressure, and natural — the goal is to gently bring the thread back to their attention, not to apply pressure.

Rules:
- 2-4 sentences total. Anything longer reads as begging.
- Reference the prior email briefly (1 phrase) so they can re-orient.
- Do NOT guilt-trip ("haven't heard from you", "wondering if you got my email"). Use lighter phrasing ("circling back", "wanted to bump this up", "in case this got buried").
- End with a clear ask or next step that's easy to respond to.
- Match the OWNER VOICE PROFILE precisely — if they're casual, be casual; if formal, formal.
- No greeting/sign-off scaffolding (the SMTP layer adds those). Just the body.
- Return ONLY the email body. No preamble, no "Subject:" line.${voiceBlock}`;

  const userMsg = `Recipient: ${args.recipientName ? `${args.recipientName} <${args.recipientAddress}>` : args.recipientAddress}
Original subject: ${args.originalSubject}
Sent ${args.daysSinceSent} days ago.
Original message snippet (for context):
${args.originalSnippet}

Draft a follow-up.`;

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 350,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userMsg }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const body = (data.content?.[0]?.text ?? '').trim();
    if (!body) return null;
    return { subject, body };
  } catch (err) {
    console.warn('[email-followup] draftFollowup failed:', err);
    return null;
  }
}

/** Insert the proposal — uses partial-unique index to dedup pending entries. */
export async function persistProposal(tenantPhone: string, candidate: FollowupCandidate, draft: { subject: string; body: string }): Promise<{ id?: string; deduped?: boolean; error?: string }> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { error: 'supabase not configured' };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/email_followup_proposals`, {
      method: 'POST',
      headers: { ...headers(), Prefer: 'return=representation' },
      body: JSON.stringify({
        tenant_phone: tenantPhone,
        recipient_address: candidate.recipient_address,
        recipient_name: candidate.recipient_name ?? null,
        original_message_id: candidate.original_message_id ?? null,
        original_subject: candidate.original_subject,
        original_sent_at: candidate.original_sent_at,
        original_snippet: candidate.original_snippet,
        days_since_sent: candidate.days_since_sent,
        draft_subject: draft.subject,
        draft_body: draft.body,
        status: 'pending',
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      // 23505 = unique constraint = there's already a pending proposal for this thread
      if (txt.includes('23505') || res.status === 409) return { deduped: true };
      return { error: `Supabase ${res.status}: ${txt.slice(0, 200)}` };
    }
    const rows = await res.json();
    return { id: rows[0]?.id };
  } catch (err: any) {
    return { error: err?.message ?? String(err) };
  }
}

export async function listPendingFollowups(tenantPhone: string): Promise<FollowupProposal[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/email_followup_proposals?tenant_phone=eq.${tenantPhone}&status=eq.pending&order=days_since_sent.desc&select=*`,
      { headers: headers() },
    );
    return res.ok ? await res.json() : [];
  } catch {
    return [];
  }
}

export async function getFollowupById(proposalId: string): Promise<FollowupProposal | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/email_followup_proposals?id=eq.${proposalId}&select=*`,
      { headers: headers() },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function markFollowupSent(proposalId: string, sentMessageId?: string): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/email_followup_proposals?id=eq.${proposalId}`, {
      method: 'PATCH',
      headers: { ...headers(), Prefer: 'return=minimal' },
      body: JSON.stringify({
        status: 'sent',
        decided_at: new Date().toISOString(),
        sent_message_id: sentMessageId ?? null,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function markFollowupDeclined(proposalId: string): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/email_followup_proposals?id=eq.${proposalId}`, {
      method: 'PATCH',
      headers: { ...headers(), Prefer: 'return=minimal' },
      body: JSON.stringify({
        status: 'declined',
        decided_at: new Date().toISOString(),
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function expireStaleFollowups(): Promise<number> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return 0;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/expire_stale_followups`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ p_max_age_days: 14 }),
    });
    if (!res.ok) return 0;
    const txt = (await res.text()).trim();
    return parseInt(txt, 10) || 0;
  } catch {
    return 0;
  }
}

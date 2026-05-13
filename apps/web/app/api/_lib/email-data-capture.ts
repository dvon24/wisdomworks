/**
 * Story 2.16 Phase 2a — Email data capture framework.
 *
 * Devon's framing: "a lot of data exists in emails and never gets to a
 * database — we need a framework for that and how the data the AI sees
 * in email helps its learning and collection." Same for Yahoo / Gmail /
 * Outlook (they share the email-sift code path via the provider router).
 *
 * email-sift already extracts people/projects/dates/actionItems per email
 * via the classifier and maps them to ontology_entities (which the
 * knowledge-refresh cron embeds for RAG). That covers the SLOW
 * semantic-recall path.
 *
 * This module covers the FAST in-prompt-context path + sender memory +
 * proactive insight emission, all of which were missing:
 *
 *   1. captureAtomsFromEmails — upserts extracted entities to
 *      knowledge_atoms with appropriate kinds (person/event/goal/fact).
 *      These show up in agent system prompts every tick, not just on
 *      explicit RAG retrieval.
 *
 *   2. enrichKnownPeopleFromEmails — for senders we've seen ≥3 times in
 *      the last 30 days, write/update known_people with frequency,
 *      last-seen, and topic signal so agents have sender context next
 *      time those emails arrive.
 *
 *   3. emitInsightsFromEmails — high-signal items (urgent + overdue
 *      keywords + named dates close to today) fire business_insights so
 *      the owner gets a proactive nudge in the next digest.
 *
 * Privacy: all three paths skip privacyClass='personal' and 'uncertain'.
 * Only business mail contributes to the learning surface.
 */

import { upsertAtom } from './knowledge-atoms';
import { definePerson } from './known-people';
import { emitInsight } from './business-insights';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

export interface EmailForCapture {
  id: string;
  from: string;
  fromName?: string;
  subject: string;
  preview: string;
  date: string;
  classification: 'urgent' | 'needs_response' | 'informational' | 'spam';
  privacyClass: 'business' | 'personal' | 'uncertain';
  extracted?: {
    people: string[];
    projects: string[];
    dates: string[];
    actionItems: string[];
  };
  lane?: string;
}

/**
 * Top-level entrypoint — runs all three captures in parallel. Each is
 * best-effort; one path failing doesn't block the others.
 *
 * Caller passes ONLY business-class emails (privacy filter happens
 * upstream).
 */
export async function captureEmailDataForLearning(
  tenantPhone: string,
  emails: EmailForCapture[],
): Promise<{ atoms: number; people: number; insights: number; errors: string[] }> {
  const businessOnly = emails.filter((e) => e.privacyClass === 'business');
  if (businessOnly.length === 0) {
    return { atoms: 0, people: 0, insights: 0, errors: [] };
  }
  const [atoms, people, insights] = await Promise.all([
    captureAtomsFromEmails(tenantPhone, businessOnly).catch((err) => ({ count: 0, error: String(err) })),
    enrichKnownPeopleFromEmails(tenantPhone, businessOnly).catch((err) => ({ count: 0, error: String(err) })),
    emitInsightsFromEmails(tenantPhone, businessOnly).catch((err) => ({ count: 0, error: String(err) })),
  ]);
  const errors: string[] = [];
  if ('error' in atoms && atoms.error) errors.push(`atoms: ${atoms.error}`);
  if ('error' in people && people.error) errors.push(`people: ${people.error}`);
  if ('error' in insights && insights.error) errors.push(`insights: ${insights.error}`);
  return { atoms: atoms.count, people: people.count, insights: insights.count, errors };
}

// ─── 1. Atoms ─────────────────────────────────────────────────────────────

/**
 * Convert extracted entities into knowledge_atoms keyed by kind:
 *   - person → kind='person'
 *   - actionItem → kind='event' (a thing the owner needs to do)
 *   - date → kind='event' if associated with an action; kind='fact' if standalone
 *   - project → kind='fact'
 *
 * Atoms feed into the agent's system prompt via recentAtomsForPrompt(),
 * so the next tick of every lane agent sees the new context.
 */
async function captureAtomsFromEmails(
  tenantPhone: string,
  emails: EmailForCapture[],
): Promise<{ count: number; error?: string }> {
  let count = 0;
  for (const e of emails) {
    const ext = e.extracted;
    if (!ext) continue;
    const fromCtx = e.fromName ? `${e.fromName} <${e.from}>` : e.from;
    const subjectCtx = e.subject.slice(0, 100);

    // People — kind 'person', short fact
    for (const p of (ext.people ?? []).slice(0, 5)) {
      try {
        const id = await upsertAtom({
          tenantPhone,
          kind: 'person',
          content: `${p} — mentioned in email "${subjectCtx}" from ${fromCtx}`.slice(0, 600),
          source: 'email',
          sourceMessageId: e.id,
          confidence: 0.6,
          tags: ['from_email', 'mentioned_person'],
        });
        if (id) count++;
      } catch {}
    }

    // Action items — kind 'event' (something to do)
    for (const a of (ext.actionItems ?? []).slice(0, 5)) {
      try {
        const id = await upsertAtom({
          tenantPhone,
          kind: 'event',
          content: `${a} — from email "${subjectCtx}" (${fromCtx})`.slice(0, 600),
          source: 'email',
          sourceMessageId: e.id,
          confidence: 0.7,
          tags: ['from_email', 'action_item', e.classification],
        });
        if (id) count++;
      } catch {}
    }

    // Projects — kind 'fact'
    for (const proj of (ext.projects ?? []).slice(0, 5)) {
      try {
        const id = await upsertAtom({
          tenantPhone,
          kind: 'fact',
          content: `Project mentioned: ${proj} (email subject: "${subjectCtx}", from ${fromCtx})`.slice(0, 600),
          source: 'email',
          sourceMessageId: e.id,
          confidence: 0.65,
          tags: ['from_email', 'project'],
        });
        if (id) count++;
      } catch {}
    }

    // Dates — kind 'event' (likely deadline-shaped)
    for (const d of (ext.dates ?? []).slice(0, 5)) {
      try {
        const id = await upsertAtom({
          tenantPhone,
          kind: 'event',
          content: `Date mentioned: ${d} — context: "${subjectCtx}" from ${fromCtx}`.slice(0, 600),
          source: 'email',
          sourceMessageId: e.id,
          confidence: 0.65,
          tags: ['from_email', 'date_reference'],
        });
        if (id) count++;
      } catch {}
    }
  }
  return { count };
}

// ─── 2. Known-people enrichment ───────────────────────────────────────────

/**
 * For senders we've seen ≥3 times in the last 30 days, write/update a
 * known_people entry. Captures sender frequency + sample topics so
 * agents have sender context in their prompts.
 */
async function enrichKnownPeopleFromEmails(
  tenantPhone: string,
  emails: EmailForCapture[],
): Promise<{ count: number; error?: string }> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { count: 0, error: 'no supabase' };

  // Bucket emails by sender
  const bySender = new Map<string, EmailForCapture[]>();
  for (const e of emails) {
    if (!e.from) continue;
    const senderKey = e.from.toLowerCase();
    const arr = bySender.get(senderKey) ?? [];
    arr.push(e);
    bySender.set(senderKey, arr);
  }

  let count = 0;
  for (const [sender, senderEmails] of bySender) {
    // Pull 30-day sample count from email_classification_samples so we
    // get a real frequency, not just this batch
    let count30d = senderEmails.length;
    try {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/email_classification_samples?tenant_phone=eq.${tenantPhone}&email_from=eq.${encodeURIComponent(sender)}&created_at=gte.${since}&select=count`,
        { headers: { ...headers(), Prefer: 'count=exact' } },
      );
      const n = parseInt(res.headers.get('content-range')?.split('/')[1] ?? '0', 10);
      if (!Number.isNaN(n)) count30d = Math.max(count30d, n);
    } catch {}

    if (count30d < 3) continue; // Threshold: ≥3 emails in 30 days

    // Use the most-recent fromName if present
    const friendlyName = senderEmails
      .map((e) => e.fromName)
      .filter((n): n is string => !!n && n.length > 0)[0];

    // Topic signal: most common subject tokens
    const topicTokens = senderEmails
      .flatMap((e) => e.subject.split(/\s+/))
      .filter((w) => w.length >= 5)
      .slice(0, 5);

    try {
      // definePerson is the public API for known_people upserts
      await definePerson({
        tenantPhone,
        displayName: friendlyName ?? sender,
        role: 'email_contact',
        email: sender,
        notes: `${count30d} emails in last 30d. Recent subjects: ${topicTokens.slice(0, 3).join(', ')}`.slice(0, 600),
        source: 'auto:agent_extraction',
        confidence: Math.min(0.95, 0.5 + count30d * 0.05),
      });
      count++;
    } catch {}
  }
  return { count };
}

// ─── 3. High-signal insights ──────────────────────────────────────────────

const OVERDUE_PATTERNS = /\b(overdue|past due|final notice|second notice|reminder.*invoice|invoice.*reminder|late payment)\b/i;
const URGENT_PATTERNS = /\b(urgent|asap|today|tomorrow|by end of day|by friday|by monday|deadline)\b/i;
const PAYMENT_PATTERNS = /\b(invoice|payment|amount due|balance|wire transfer)\b/i;
const CONTRACT_PATTERNS = /\b(contract|agreement|nda|terms|expires|renewal|auto-renew)\b/i;

/**
 * Scan recent emails for high-signal patterns and fire insights. These
 * become approve/dismiss-able cards in the deck + a digest entry.
 *
 * Conservative — only fires when the signal is strong (urgent classification
 * OR explicit pattern match in subject/preview). Otherwise the inbox would
 * generate insights on every routine email.
 */
async function emitInsightsFromEmails(
  tenantPhone: string,
  emails: EmailForCapture[],
): Promise<{ count: number; error?: string }> {
  let count = 0;
  for (const e of emails) {
    const haystack = `${e.subject} ${e.preview}`;
    const isOverdue = OVERDUE_PATTERNS.test(haystack);
    const isUrgent = e.classification === 'urgent' || URGENT_PATTERNS.test(haystack);
    const isPayment = PAYMENT_PATTERNS.test(haystack);
    const isContract = CONTRACT_PATTERNS.test(haystack);

    // Match the most specific pattern. Order matters — overdue invoice
    // is higher-severity than a vanilla "urgent" reply request.
    let kind: string | null = null;
    let severity: 'low' | 'medium' | 'high' | 'critical' = 'medium';
    let title = '';
    let recommended = '';

    if (isOverdue && isPayment) {
      kind = 'overdue_invoice';
      severity = 'high';
      title = `Overdue invoice: ${e.subject.slice(0, 80)}`;
      recommended = `Open the email from ${e.from} and reconcile. If a payment was sent, reply confirming. If not, decide on extension or escalation.`;
    } else if (isContract && /\b(expires|renewal|auto-renew|expir)\b/i.test(haystack)) {
      kind = 'contract_renewal';
      severity = 'high';
      title = `Contract renewal: ${e.subject.slice(0, 80)}`;
      recommended = `Review the renewal terms in the email from ${e.from}. Flag any auto-renewal language and decide whether to renew, renegotiate, or cancel.`;
    } else if (isUrgent && e.classification === 'urgent') {
      kind = 'urgent_email';
      severity = 'medium';
      title = `Urgent: ${e.subject.slice(0, 80)}`;
      recommended = `Reply to ${e.from}. The classifier marked this urgent — same-day response keeps the relationship healthy.`;
    }

    if (!kind) continue;

    try {
      const id = await emitInsight({
        tenantPhone,
        detector: `email.${kind}`,
        severity,
        title,
        why: `From ${e.from}: ${e.preview.slice(0, 200)}`,
        recommendedAction: recommended,
        confidence: 0.8,
        payload: {
          email_id: e.id,
          email_from: e.from,
          email_subject: e.subject,
          classification: e.classification,
          lane: e.lane ?? null,
        },
        // Dedup signature so the same email doesn't fire repeatedly across
        // cron runs while still proposed
        signature: `email.${kind}.${e.id}`,
      });
      if (id) count++;
    } catch {}
  }
  return { count };
}

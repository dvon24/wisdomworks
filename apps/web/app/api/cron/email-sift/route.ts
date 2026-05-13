/**
 * Email Sift Cron — processes every active customer's inbox.
 *
 * Runs every 30 minutes (configured in vercel.json).
 * For each customer with an email OAuth connection:
 *   1. Fetch unread emails (last 24h) via Gmail API or Microsoft Graph
 *   2. Classify with Claude: urgent / needs_response / informational / spam
 *   3. Draft replies for actionable emails
 *   4. Send a WhatsApp summary to the owner with approve/edit/skip options
 *
 * Multi-tenant: routes by oauth_connections.provider — Google, Microsoft, or fallback IMAP.
 */

import { NextResponse } from 'next/server';
import { listEmails, decryptToken, type EmailMessage, type OAuthConnection } from '@wisdomworks/shared';
import { listImapUnread } from '../../_lib/imap-runtime';
import { logSample, buildFewShotExamples } from '../../_lib/classification-learning';
import { getTopContacts, renderTrustedContactsForClassifier } from '../../_lib/email-intelligence';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const GRAPH_API = 'https://graph.facebook.com/v25.0';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

interface EmailSummary {
  id: string;
  from: string;
  subject: string;
  preview: string;
  date: string;
  classification: 'urgent' | 'needs_response' | 'informational' | 'spam';
  draftReply?: string;
  // Story 2.3 — privacy classification at the boundary
  privacyClass: 'business' | 'personal' | 'uncertain';
  privacyConfidence: number; // 0-1
  // Story 2.5 — structured extraction (business mail only; null for personal/uncertain)
  extracted?: {
    people: string[];
    projects: string[];
    dates: string[];
    actionItems: string[];
  };
  /** Lane routing — which agent on the tenant's team owns this email.
   *  Mirrors the lane categorization used by agent_configs. */
  lane?: 'scheduler' | 'customer_service' | 'finance' | 'marketing' | 'operations' | 'analytics' | 'orchestrator' | 'specialist';
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  try {
    // Get all active email connections (Google + Microsoft)
    const connections = await fetchActiveEmailConnections();
    if (!connections.length) {
      console.log('[email-sift] No active email connections');
      return NextResponse.json({ processed: 0, customers: 0 });
    }

    let totalProcessed = 0;
    let totalActionable = 0;

    for (const conn of connections) {
      try {
        const result = await processCustomer(conn);
        totalProcessed += result.processed;
        totalActionable += result.actionable;
      } catch (err) {
        console.error(`[email-sift] Failed for ${conn.phone_number} (${conn.provider}):`, err);
      }
    }

    console.log(`[email-sift] Processed ${totalProcessed} emails across ${connections.length} customers, ${totalActionable} actionable`);
    return NextResponse.json({ processed: totalProcessed, actionable: totalActionable, customers: connections.length });
  } catch (error) {
    console.error('[email-sift] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

/** Fetch active email OAuth connections — Google, Microsoft, Yahoo, generic IMAP */
async function fetchActiveEmailConnections(): Promise<(OAuthConnection & { phone_number: string })[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/oauth_connections?service=eq.email&status=eq.active&provider=in.(google,microsoft,yahoo,imap)&select=*`,
    {
      headers: {
        apikey: SUPABASE_KEY!,
        Authorization: `Bearer ${SUPABASE_KEY!}`,
      },
    },
  );
  if (!res.ok) return [];
  return res.json();
}

async function processCustomer(
  conn: OAuthConnection & { phone_number: string },
): Promise<{ processed: number; actionable: number }> {
  // Decrypt the access token before passing to API client
  const decrypted: OAuthConnection = {
    ...conn,
    access_token: await decryptToken(conn.access_token),
    refresh_token: conn.refresh_token ? await decryptToken(conn.refresh_token) : undefined,
  };
  // Yahoo + generic IMAP go through the local app runtime (the shared
  // router can't bundle imapflow); Google + Microsoft go through the
  // shared router as before.
  const result = (decrypted.provider === 'yahoo' || decrypted.provider === 'imap')
    ? await listImapUnread(decrypted as any, 10)
    : await listEmails(decrypted, 10);
  if (!result.success || !result.data?.length) {
    // Story 2.2: still log a 'no new mail' signal so the timeline shows
    // the cron ran. Skip if the underlying call failed entirely (we don't
    // want to noise up agent_runs with infra errors).
    if (result.success) {
      await logEmailSignal(conn.phone_number, decrypted.provider, [], 0);
    }
    return { processed: 0, actionable: 0 };
  }

  const emails = result.data;
  const processed = await classifyAndDraft(emails, conn.phone_number);

  // Story 2.13 — log samples for QA scanning (PII-safe metadata only).
  await logSample(conn.phone_number, processed.map((e) => ({
    email_id: e.id,
    privacy_class: e.privacyClass,
    privacy_confidence: e.privacyConfidence,
    classification: e.classification,
    email_from: e.from,
    email_subject: e.privacyClass === 'business' ? e.subject : '(redacted)',
    has_draft: !!e.draftReply,
  })));

  // Story 2.3 — privacy boundary: only business mail flows through to
  // actionable processing. Personal mail stays private (no draft, no
  // metadata extraction). Uncertain mail is held for the morning briefing
  // (Story 2.6).
  const businessOnly = processed.filter((e) => e.privacyClass === 'business');
  const actionable = businessOnly.filter(
    (e) => e.classification === 'urgent' || e.classification === 'needs_response',
  );
  const personalCount = processed.filter((e) => e.privacyClass === 'personal').length;
  const uncertainCount = processed.filter((e) => e.privacyClass === 'uncertain').length;

  if (actionable.length > 0) {
    await sendEmailSummary(conn.phone_number, actionable);
    await storePendingDrafts(conn.phone_number, actionable);
  }

  // Story 2.2 + 2.3 — log this batch as a 'signal' run with privacy counts.
  await logEmailSignal(conn.phone_number, decrypted.provider, processed, actionable.length, { personalCount, uncertainCount });

  // Story 2.5 — fold extracted business entities into the ontology so
  // future agent prompts know about the people, projects, and tasks
  // mentioned. Personal/uncertain mail never reaches this step.
  await mapExtractionsToOntology(conn.phone_number, businessOnly);

  return { processed: emails.length, actionable: actionable.length };
}

/**
 * Story 2.5 — upsert extracted entities (people, projects, action items,
 * dates) into the tenant's ontology via the existing upsert_ontology RPC.
 * Idempotent (the function dedupes by (entity_type, name)).
 */
async function mapExtractionsToOntology(tenantPhone: string, emails: EmailSummary[]): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  const entities: any[] = [];
  const seen = new Set<string>();
  const add = (entity_type: string, name: string, metadata: Record<string, unknown> = {}) => {
    const trimmed = (name || '').trim();
    if (!trimmed) return;
    const key = `${entity_type}:${trimmed.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    entities.push({ entity_type, name: trimmed.slice(0, 200), metadata, source: 'agent_inferred' });
  };
  for (const e of emails) {
    const ext = e.extracted;
    if (!ext) continue;
    for (const p of ext.people ?? []) add('employee', p, { mentioned_in_email: true });
    for (const p of ext.projects ?? []) add('project', p, { mentioned_in_email: true });
    for (const a of ext.actionItems ?? []) add('task', a, { from_email_subject: e.subject });
    for (const d of ext.dates ?? []) add('decision', `Date mentioned: ${d}`, { date_string: d });
  }
  if (entities.length === 0) return;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/upsert_ontology`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        p_tenant_phone: tenantPhone,
        p_entities: entities,
        p_relationships: [],
      }),
    });
    if (!res.ok) console.warn('[email-sift] ontology mapping failed:', res.status);
  } catch (err) {
    console.warn('[email-sift] ontology mapping error:', err);
  }
}

/**
 * Story 2.2 — log one 'signal' row per email batch on the agent that owns
 * email for this tenant (operations/support/orchestrator, in that order of
 * preference). Lets the orchestrator see new inbox activity in its tick
 * context and surface it in the next digest.
 */
async function logEmailSignal(tenantPhone: string, provider: string, emails: EmailSummary[], actionable: number, privacy?: { personalCount: number; uncertainCount: number }): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    // Find which agent owns email — by category preference. Uses the
    // category we set in Story 1.11/categories.
    const cfgRes = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_configs?tenant_phone=eq.${tenantPhone}&select=id,agent_name,config`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
    );
    if (!cfgRes.ok) return;
    const configs = await cfgRes.json();
    if (configs.length === 0) return;

    // Preference order: support → operations → orchestrator → first agent
    const pref = ['support', 'operations', 'orchestrator'];
    let owner = null;
    for (const cat of pref) {
      owner = configs.find((c: any) => c.config?.category === cat);
      if (owner) break;
    }
    if (!owner) owner = configs[0];

    // Look up the matching agent_instance for the owner config
    const instRes = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_instances?agent_config_id=eq.${owner.id}&select=id,status`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
    );
    const instRows = instRes.ok ? await instRes.json() : [];
    const instance = instRows[0];
    if (!instance) return; // No instance = nothing to log against

    const privacySuffix = privacy && (privacy.personalCount > 0 || privacy.uncertainCount > 0)
      ? ` (${privacy.personalCount} personal kept private, ${privacy.uncertainCount} uncertain held for review)`
      : '';
    const summary = emails.length === 0
      ? `Polled ${provider} inbox — no new unread mail.`
      : `Polled ${provider} inbox — ${emails.length} new email${emails.length > 1 ? 's' : ''}, ${actionable} actionable${privacySuffix}.`;

    await fetch(`${SUPABASE_URL}/rest/v1/agent_runs`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        tenant_phone: tenantPhone,
        agent_instance_id: instance.id,
        trigger: 'signal',
        phase: 'observe',
        outcome: emails.length === 0 ? 'no_op' : actionable > 0 ? 'proposed' : 'observed',
        input_summary: `Email-sift cron polled ${provider}.`,
        output_summary: summary,
        metadata: {
          source: 'email-sift',
          provider,
          email_count: emails.length,
          actionable_count: actionable,
          // Story 2.3 — privacy boundary, only business subjects flow up
          subjects: emails
            .filter((e) => e.privacyClass === 'business')
            .slice(0, 5)
            .map((e) => e.subject),
          personal_count: privacy?.personalCount ?? 0,
          uncertain_count: privacy?.uncertainCount ?? 0,
        },
      }),
    });
  } catch (err) {
    console.warn('[email-sift] signal log failed:', err);
  }
}

async function classifyAndDraft(emails: EmailMessage[], tenantPhone?: string): Promise<EmailSummary[]> {
  // Story 2.13 — pull recent corrections as few-shot examples so the
  // classifier learns from the user's corrections over time.
  const fewShot = tenantPhone ? await buildFewShotExamples(tenantPhone) : '';
  // Email intelligence — trusted senders bias classification toward business
  // and away from spam, even when subject lines look promotional.
  const trustedContacts = tenantPhone ? await getTopContacts(tenantPhone, 30) : [];
  const trustBlock = renderTrustedContactsForClassifier(trustedContacts);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return emails.map((e) => ({
      id: e.id,
      from: e.from,
      subject: e.subject,
      preview: e.bodyPreview ?? e.body.slice(0, 100),
      date: e.date,
      classification: 'informational' as const,
      privacyClass: 'uncertain' as const,
      privacyConfidence: 0,
    }));
  }

  const emailList = emails
    .map(
      (e, i) =>
        `Email ${i + 1}:\nFrom: ${e.fromName ? `${e.fromName} <${e.from}>` : e.from}\nSubject: ${e.subject}\nPreview: ${(e.body || e.bodyPreview).slice(0, 300)}\nDate: ${e.date}`,
    )
    .join('\n\n---\n\n');

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        system: [
          {
            type: 'text',
            text: `You are an email classifier with two responsibilities — privacy classification (FIRST, defense-in-depth) and action classification (only for business mail).

Return ONLY a valid JSON array. Each item:
{
  "index": number,
  "privacyClass": "business" | "personal" | "uncertain",
  "privacyConfidence": 0..1,
  "classification": "urgent" | "needs_response" | "informational" | "spam",
  "lane": "scheduler" | "customer_service" | "finance" | "marketing" | "operations" | "analytics" | "orchestrator" | "specialist",
  "draftReply": "reply text or null",
  "extracted": { "people": ["full names mentioned"], "projects": ["named projects/initiatives"], "dates": ["yyyy-mm-dd or natural-language dates"], "actionItems": ["action item phrases"] }
}

PRIVACY RULES (defense-in-depth — Story 2.3):
- "business": work-related (clients, vendors, internal collaboration, professional newsletters). Full processing allowed.
- "personal": friends, family, personal admin (banking, healthcare, dating, hobbies, social plans not tied to work). DO NOT generate a draft reply. Set classification to "informational". Set draftReply to null. The message body MUST stay private — your job here is JUST to flag the boundary.
- "uncertain": ambiguous (e.g. could be a client or could be a friend). Set classification to "informational". Set draftReply to null. The system surfaces these to the owner for clarification.
- privacyConfidence: how confident you are in the privacy classification. Below 0.7 → use "uncertain".

ACTION RULES (only when privacyClass is "business"):
- urgent: time-sensitive, deadlines, escalations
- needs_response: a real human is asking the owner a specific question or needs a decision
- informational: FYI from a known source, no action required (newsletters from people the owner reads, system notifications, automated reports)
- spam: classify as spam if ANY of these apply:
    * sender domain doesn't match the brand they claim to represent
    * generic salutation ("Hi {name}", "Dear customer", or no salutation)
    * primary CTA is a marketing link (unsubscribe footer is the giveaway)
    * cold outreach / sales pitch from someone not in the trusted senders list
    * appears in the UNREAD-ONLY SENDERS block below (owner ignores these)
    * unsolicited promotional content, even from a real company
- Default to spam over needs_response when uncertain — false positives waste the owner's attention. The owner can always recover a misclassified spam email; they cannot un-read a spammed needs_response.
- Draft reply ONLY for urgent + needs_response. Professional, concise.${fewShot}

EXTRACTION (Story 2.5 — structured signal, business mail only):
- For privacyClass "business" only, populate extracted with names of people mentioned, projects/initiatives referenced, dates that matter (deadlines, meetings), and action items.
- For "personal" or "uncertain", set extracted to null. NEVER extract names or other identifying info from personal mail (privacy boundary).
- Keep arrays short — 5 items max each.

LANE ROUTING (which agent handles this on the tenant's team):
- scheduler: appointment requests, booking confirmations, scheduling conflicts, calendar invites
- customer_service: client inquiries, follow-up questions, complaints, general support, returning customers
- finance: invoices, payment confirmations, billing questions, statements, expense receipts
- marketing: review notifications, social mentions, partnership/collab inquiries, advertising
- operations: vendor/supplier comms, internal logistics, permit / inspection notices, supply orders
- analytics: reports, dashboards, performance summaries from connected tools
- orchestrator: anything addressed personally to the owner that needs their attention (most personal-tinged business mail)
- specialist: anything else / vertical-specific that doesn't fit cleanly above

For "personal" or "uncertain" privacy mail, set lane to "orchestrator" (owner's eyes only).${trustBlock}`,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [
          {
            role: 'user',
            content: `Classify these emails and draft replies where needed:\n\n${emailList}`,
          },
        ],
      }),
    });

    if (!response.ok) throw new Error(`API error: ${response.status}`);

    const data = await response.json();
    const text = data.content?.[0]?.text ?? '[]';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    const results: {
      index: number;
      classification: string;
      draftReply: string | null;
      privacyClass?: string;
      privacyConfidence?: number;
      lane?: string;
      extracted?: { people?: string[]; projects?: string[]; dates?: string[]; actionItems?: string[] } | null;
    }[] = jsonMatch ? JSON.parse(jsonMatch[0]) : [];

    return emails.map((e, i) => {
      const result = results.find((r) => r.index === i + 1);
      const privacyClass = (result?.privacyClass ?? 'uncertain') as EmailSummary['privacyClass'];
      const privacyConfidence = result?.privacyConfidence ?? 0.5;
      // Story 2.3 — privacy boundary: personal mail gets minimal metadata
      // and never carries body content into agent_runs / extraction.
      const isPrivate = privacyClass === 'personal' || privacyClass === 'uncertain';
      const validLanes = ['scheduler', 'customer_service', 'finance', 'marketing', 'operations', 'analytics', 'orchestrator', 'specialist'];
      const rawLane = result?.lane;
      const lane = (isPrivate ? 'orchestrator' : (validLanes.includes(rawLane ?? '') ? rawLane : 'orchestrator')) as EmailSummary['lane'];
      return {
        id: e.id,
        from: e.fromName ? `${e.fromName} <${e.from}>` : e.from,
        subject: isPrivate ? '(private — held for review)' : e.subject,
        preview: isPrivate ? '' : (e.body || e.bodyPreview).slice(0, 100),
        date: e.date,
        classification: (result?.classification ?? 'informational') as EmailSummary['classification'],
        draftReply: isPrivate ? undefined : (result?.draftReply ?? undefined),
        privacyClass,
        privacyConfidence,
        lane,
        // Story 2.5 — extraction only on business mail (privacy boundary)
        extracted: isPrivate ? undefined : {
          people: result?.extracted?.people ?? [],
          projects: result?.extracted?.projects ?? [],
          dates: result?.extracted?.dates ?? [],
          actionItems: result?.extracted?.actionItems ?? [],
        },
      };
    });
  } catch (error) {
    console.error('[email-sift] Classification error:', error);
    return emails.map((e) => ({
      id: e.id,
      from: e.from,
      subject: e.subject,
      preview: e.bodyPreview,
      date: e.date,
      classification: 'informational' as const,
      privacyClass: 'uncertain' as const,
      privacyConfidence: 0,
    }));
  }
}

async function sendEmailSummary(phoneNumber: string, emails: EmailSummary[]): Promise<void> {
  // Enqueue ONE notification per email (or one summary if there are many)
  // so the next scheduled digest bundles them together. No more individual
  // texts each time email-sift runs.
  const cleanPhone = phoneNumber.replace(/[\s\-\+\(\)]/g, '');
  const { enqueueNotification } = await import('../../_lib/notifications');

  if (emails.length <= 3) {
    for (const e of emails) {
      const sev = e.classification === 'urgent' ? 'high' : 'medium';
      await enqueueNotification({
        tenantPhone: cleanPhone,
        kind: 'email_attention',
        severity: sev,
        title: `${e.classification === 'urgent' ? 'Urgent email' : 'Email needs reply'} from ${e.from}`,
        body: `Subject: ${e.subject}${e.draftReply ? ` — draft ready: "${e.draftReply.slice(0, 80)}${e.draftReply.length > 80 ? '...' : ''}"` : ''}`,
        sourceAgent: 'email-sift',
        sourceId: e.id,
        metadata: { from: e.from, subject: e.subject, has_draft: !!e.draftReply },
      });
    }
  } else {
    // Aggregate when there's a flood — one bullet for the whole batch
    const urgent = emails.filter((e) => e.classification === 'urgent').length;
    const fromList = Array.from(new Set(emails.map((e) => e.from))).slice(0, 5).join(', ');
    await enqueueNotification({
      tenantPhone: cleanPhone,
      kind: 'email_attention',
      severity: urgent > 0 ? 'high' : 'medium',
      title: `${emails.length} emails need attention${urgent > 0 ? ` (${urgent} urgent)` : ''}`,
      body: `From: ${fromList}${emails.length > 5 ? ` and ${emails.length - 5} more` : ''}. Ask 'show inbox' for the full list.`,
      sourceAgent: 'email-sift',
      metadata: { count: emails.length, urgent_count: urgent },
    });
  }
}

async function storePendingDrafts(phoneNumber: string, emails: EmailSummary[]): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;

  const cleanPhone = phoneNumber.replace(/[\s\-\+\(\)]/g, '');
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${cleanPhone}`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    },
  );

  if (!res.ok) return;
  const rows = await res.json();
  if (!rows.length) return;

  const profile = rows[0].profile ?? { preferences: {}, activeTopics: [] };
  profile.pendingEmailDrafts = emails.map((e) => ({
    id: e.id,
    from: e.from,
    subject: e.subject,
    draftReply: e.draftReply,
    classification: e.classification,
    lane: e.lane ?? 'orchestrator',
  }));

  await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${cleanPhone}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ profile }),
  });
}

async function sendWhatsApp(to: string, message: string): Promise<void> {
  const cleanTo = to.replace(/[\s\-\+\(\)]/g, '');
  // Honor DND — email digests are proactive
  const { isMuted } = await import('../../_lib/mute-state');
  const mute = await isMuted(cleanTo);
  if (mute.muted) {
    console.log(`[email-sift] WhatsApp digest suppressed for ${cleanTo} (muted${mute.reason ? `: ${mute.reason}` : ''})`);
    return;
  }
  const { sendOwnerMessage } = await import('../../_lib/owner-message');
  await sendOwnerMessage({ tenantPhone: cleanTo, body: message, source: 'email-sift' });
}

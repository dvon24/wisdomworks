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
import { listEmails, decryptToken, redactPII, type EmailMessage, type OAuthConnection } from '@wisdomworks/shared';
import { listImapUnread } from '../../_lib/imap-runtime';
import { logSample, buildFewShotExamples, buildProfessionalContext } from '../../_lib/classification-learning';
import { getSenderRules, matchSenderRule, classifyByRule } from '../../_lib/sender-rules';
import { recordClassifiedForEngagement, buildEngagementContext } from '../../_lib/email-engagement';
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

  // Surface-time attachment analysis — Devon's rule
  // (feedback_attachment_consent.md): when Iris is bringing an email to
  // the owner's attention, that's the consent signal. Pull the PDF
  // attachments for actionable emails and weave the analyses into the
  // notification + draft so the owner sees the doc context inline.
  let surfaceAttachments: Map<string, Array<{ filename: string; analysis: any }>> | undefined;
  if (actionable.length > 0) {
    const actionableIds = new Set(actionable.map((e) => e.id));
    const hasSurfacedAttachments = emails.some((e) => actionableIds.has(e.id) && e.hasAttachments);
    if (hasSurfacedAttachments) {
      try {
        const { analyzeAttachmentsForSurfacedEmails } = await import('../../_lib/email-attachment-ingestion');
        surfaceAttachments = await analyzeAttachmentsForSurfacedEmails({
          conn: { ...decrypted, phone_number: conn.phone_number },
          surfacedEmailIds: Array.from(actionableIds),
          originalEmails: emails,
        });
        if (surfaceAttachments.size > 0) {
          console.log(`[email-sift] surface attachments analyzed for ${conn.phone_number}: ${surfaceAttachments.size} email${surfaceAttachments.size === 1 ? '' : 's'}`);
        }
      } catch (err) {
        console.warn('[email-sift] surface attachment analysis failed (non-blocking):', err);
      }
    }
    await sendEmailSummary(conn.phone_number, actionable, surfaceAttachments);
    await storePendingDrafts(conn.phone_number, actionable, surfaceAttachments);
  }

  // Story 2.2 + 2.3 — log this batch as a 'signal' run with privacy counts.
  await logEmailSignal(conn.phone_number, decrypted.provider, processed, actionable.length, { personalCount, uncertainCount });

  // Story 2.5 — fold extracted business entities into the ontology so
  // future agent prompts know about the people, projects, and tasks
  // mentioned. Personal/uncertain mail never reaches this step.
  await mapExtractionsToOntology(conn.phone_number, businessOnly);

  // Phase 2c — seed engagement tracking rows for ALL classified emails
  // (not just business). We want the open-rate signal across the whole
  // inbox so the classifier learns which senders the owner reliably
  // engages with vs ignores. The engagement-poll cron flips
  // currently_unread → false when the owner reads them.
  try {
    const seeded = await recordClassifiedForEngagement({
      tenantPhone: conn.phone_number,
      provider: decrypted.provider,
      emails: emails.map((e) => ({ id: e.id, from: e.from, subject: e.subject, date: e.date, isUnread: e.isUnread })),
    });
    if (seeded > 0) {
      console.log(`[email-sift] engagement tracking seeded for ${conn.phone_number}: ${seeded}`);
    }
  } catch (err) {
    console.warn('[email-sift] engagement seed failed (non-blocking):', err);
  }

  // Story 2.16 Phase 2a — email data capture framework. Folds the same
  // extracted entities into knowledge_atoms (fast in-prompt context),
  // enriches known_people for recurring senders (frequency + topics),
  // and emits business_insights for high-signal items (overdue invoices,
  // contract renewals, urgent emails). Same code path serves Gmail,
  // Outlook, Yahoo, and generic IMAP since they all flow through here.
  try {
    const { captureEmailDataForLearning } = await import('../../_lib/email-data-capture');
    const capture = await captureEmailDataForLearning(conn.phone_number, businessOnly);
    if (capture.atoms > 0 || capture.people > 0 || capture.insights > 0) {
      console.log(`[email-sift] data capture for ${conn.phone_number}: ${capture.atoms} atoms, ${capture.people} known_people, ${capture.insights} insights`);
    }
    if (capture.errors.length > 0) {
      console.warn(`[email-sift] data capture errors for ${conn.phone_number}:`, capture.errors);
    }
  } catch (err) {
    console.warn('[email-sift] data capture failed (non-blocking):', err);
  }

  // Story 2.16 Phase 2b — attachments are capability-only.
  // Per feedback_attachment_consent.md, email-sift does NOT touch
  // attachments automatically. Iris has the analyze_email_attachment
  // agent tool to fetch + analyze on demand when the owner explicitly
  // asks. No background detection, no pending queue, no approval cards.

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
        input_summary: redactPII(`Email-sift cron polled ${provider}.`).redacted,
        output_summary: redactPII(summary).redacted,
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
  // Sender rules — owner-defined deterministic classification. Emails matching
  // a rule (e.g. "block change.org", "personal joyce@example.com") skip the
  // LLM entirely. This is the primary remediation for the 238-low-confidence
  // problem: recurring ambiguous senders get a permanent verdict and stop
  // wasting LLM cycles.
  const rules = tenantPhone ? await getSenderRules(tenantPhone) : [];

  const ruleResults = new Map<string, EmailSummary>();
  const remaining: EmailMessage[] = [];
  if (rules.length > 0) {
    for (const e of emails) {
      const fromHeader = e.fromName ? `${e.fromName} <${e.from}>` : e.from;
      const matched = matchSenderRule(fromHeader, rules);
      if (matched) {
        const verdict = classifyByRule(matched);
        const isPrivate = verdict.privacyClass === 'personal' || verdict.privacyClass === 'uncertain';
        ruleResults.set(e.id, {
          id: e.id,
          from: fromHeader,
          subject: isPrivate ? '(private — held for review)' : e.subject,
          preview: isPrivate ? '' : (e.body || e.bodyPreview || '').slice(0, 100),
          date: e.date,
          classification: verdict.classification,
          privacyClass: verdict.privacyClass,
          privacyConfidence: verdict.privacyConfidence,
          // verdict actions all imply "no auto-draft" — sender rules are
          // owner-set classifications, not response prompts. If the owner
          // wants a draft, they'll ask Iris directly.
          draftReply: undefined,
          lane: 'orchestrator',
          extracted: isPrivate ? undefined : { people: [], projects: [], dates: [], actionItems: [] },
        });
      } else {
        remaining.push(e);
      }
    }
  } else {
    remaining.push(...emails);
  }

  // Short-circuit: if every email matched a rule, no LLM call needed.
  if (remaining.length === 0) {
    return emails.map((e) => ruleResults.get(e.id)!);
  }

  // Story 2.13 — pull recent corrections as few-shot examples so the
  // classifier learns from the user's corrections over time.
  const fewShot = tenantPhone ? await buildFewShotExamples(tenantPhone) : '';
  // FR102 — professional context atoms so the classifier knows the user's
  // role / focus / responsibilities when disambiguating
  const profContext = tenantPhone ? await buildProfessionalContext(tenantPhone) : '';
  // Phase 2c — sender engagement context. Senders the owner reliably
  // opens get classified toward business; senders they ignore drift
  // toward spam. Passive learning, no notifications.
  const engagementContext = tenantPhone ? await buildEngagementContext(tenantPhone) : '';
  // Email intelligence — trusted senders bias classification toward business
  // and away from spam, even when subject lines look promotional.
  const trustedContacts = tenantPhone ? await getTopContacts(tenantPhone, 30) : [];
  const trustBlock = renderTrustedContactsForClassifier(trustedContacts);
  // 2026-05-25 — disposition propagation. Email-sift produces drafts
  // and classifications the owner sees; it MUST respect owner corrections
  // ("stop drafting replies to X", "always treat Y as spam", "this tone
  // is too formal"). Without this, the cron happily violates rules Iris
  // already learned in chat, breaking trust.
  let dispositionBlock = '';
  if (tenantPhone) {
    try {
      const { buildDispositionContext } = await import('../../_lib/disposition-mining');
      dispositionBlock = await buildDispositionContext(tenantPhone, { lane: 'email-sift', limit: 10 });
    } catch (err) {
      console.warn('[email-sift] disposition fetch failed (non-blocking):', err);
    }
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return emails.map((e) => ruleResults.get(e.id) ?? ({
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

  // The LLM only sees `remaining` (emails without a matching sender rule);
  // rule-matched ones get merged back in by id at the return step.
  const emailList = remaining
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
        model: 'claude-sonnet-4-6',
        // 2026-05-30: was 1500 — far too low. The classifier returns one rich
        // JSON object per email (privacy + action + lane + draft + extracted),
        // ~150-300 tokens each, so ~6-8 emails overflowed 1500 and the array
        // truncated mid-object → JSON.parse died → the catch fell the WHOLE
        // batch back to a mislabeled default (which nullified the engagement /
        // trusted-sender signals). 8000 covers ~30 emails; the salvage-parse
        // below is the safety net.
        max_tokens: 8000,
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

For "personal" or "uncertain" privacy mail, set lane to "orchestrator" (owner's eyes only).${profContext}${engagementContext}${trustBlock}${dispositionBlock}`,
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

    if (!response.ok) {
      // Capture the body so a 400 is diagnosable instead of an opaque status
      // (the old `API error: 400` discarded the actual reason).
      const errBody = await response.text().catch(() => '<no body>');
      throw new Error(`API error: ${response.status} ${errBody.slice(0, 400)}`);
    }

    const data = await response.json();
    // 2026-05-27 — record classifier's Sonnet cost. Runs every 30 min
    // when there are unread emails; was the largest untracked sink.
    if (tenantPhone) {
      void (async () => {
        try {
          const { recordLlmCall } = await import('../../_lib/chat-cost-tracker');
          await recordLlmCall({
            tenantPhone,
            surface: 'email-sift',
            model: 'claude-sonnet-4-6',
            tokensIn: data.usage?.input_tokens ?? 0,
            tokensOut: data.usage?.output_tokens ?? 0,
            cachedTokensIn: data.usage?.cache_read_input_tokens ?? 0,
            toolsUsed: [],
          });
        } catch (err) {
          console.warn('[email-sift] cost record failed:', err);
        }
      })();
    }
    const text = data.content?.[0]?.text ?? '[]';
    type ClassifierResult = {
      index: number;
      classification: string;
      draftReply: string | null;
      privacyClass?: string;
      privacyConfidence?: number;
      lane?: string;
      extracted?: { people?: string[]; projects?: string[]; dates?: string[]; actionItems?: string[] } | null;
    };
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    let results: ClassifierResult[] = [];
    if (jsonMatch) {
      try {
        results = JSON.parse(jsonMatch[0]);
      } catch (parseErr: any) {
        // Malformed/truncated classifier JSON. Don't lose the WHOLE batch (the
        // old behavior fell every email back to a mislabeled default). Salvage
        // every COMPLETE object by trimming to the last closing brace and
        // re-closing the array — better to classify 8 of 10 than mislabel all.
        const lastObj = jsonMatch[0].lastIndexOf('}');
        if (lastObj > 0) {
          try {
            results = JSON.parse(jsonMatch[0].slice(0, lastObj + 1) + ']');
            console.warn(`[email-sift] classifier JSON malformed — salvaged ${results.length} of ~${remaining.length} (trimmed to last complete object).`);
          } catch {
            console.error(`[email-sift] classifier JSON unparseable even after salvage (text len ${text.length}): ${parseErr?.message}`);
          }
        } else {
          console.error(`[email-sift] classifier JSON unparseable, nothing salvageable (text len ${text.length}): ${parseErr?.message}`);
        }
      }
    }

    // Build LLM verdicts keyed by email id (LLM indexes were 1..remaining.length).
    const llmVerdicts = new Map<string, EmailSummary>();
    remaining.forEach((e, i) => {
      const result = results.find((r) => r.index === i + 1);
      const privacyClass = (result?.privacyClass ?? 'uncertain') as EmailSummary['privacyClass'];
      const privacyConfidence = result?.privacyConfidence ?? 0.5;
      // Story 2.3 — privacy boundary: personal mail gets minimal metadata
      // and never carries body content into agent_runs / extraction.
      const isPrivate = privacyClass === 'personal' || privacyClass === 'uncertain';
      const validLanes = ['scheduler', 'customer_service', 'finance', 'marketing', 'operations', 'analytics', 'orchestrator', 'specialist'];
      const rawLane = result?.lane;
      const lane = (isPrivate ? 'orchestrator' : (validLanes.includes(rawLane ?? '') ? rawLane : 'orchestrator')) as EmailSummary['lane'];
      llmVerdicts.set(e.id, {
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
      });
    });

    // ──────────────────────────────────────────────────────────────────
    // AXIS AUDIT — email-sift draft replies
    // 2026-05-27 — audit each LLM-generated draft reply against the
    // owner's disposition rules. Drafts are owner-reviewed before
    // sending so we don't MODIFY them — we just persist violations to
    // axis_critiques so patterns surface in show_axis_audit_summary
    // ("Iris drafted 8 apologetic openings this week" → owner can tune
    // the classifier prompt). Fire-and-forget per-draft; never blocks
    // classification. Skipped when tenantPhone is unset (test paths).
    // ──────────────────────────────────────────────────────────────────
    if (tenantPhone) {
      void (async () => {
        try {
          const { critiqueResponse, persistCritique } = await import('../../_lib/axis-critic');
          const auditTasks = Array.from(llmVerdicts.entries())
            .filter(([_, v]) => v.draftReply && v.draftReply.length > 60)
            .map(async ([emailId, v]) => {
              const sourceEmail = remaining.find((e) => e.id === emailId);
              if (!sourceEmail) return;
              const subjectLine = `Email from ${sourceEmail.fromName ?? sourceEmail.from}: ${sourceEmail.subject}`;
              const critique = await critiqueResponse({
                surface: 'email-sift',
                ownerMessage: subjectLine,
                draft: v.draftReply!,
                recentTurns: [],
                toolsUsedThisTurn: [],
                tenantPhone,
              });
              await persistCritique({
                tenantPhone,
                surface: 'email-sift',
                critique,
                sourceMessage: subjectLine,
                draft: v.draftReply!,
                revisionAttempted: false,
              });
              if (!critique.passes) {
                const highCount = critique.violations.filter((vv: any) => vv.severity === 'high').length;
                console.warn(`[email-sift] Axis flagged ${critique.violations.length} (${highCount} high) on draft for ${sourceEmail.from}: ${JSON.stringify(critique.violations.map((vv: any) => `${vv.severity}:${vv.rule}`))}`);
              }
            });
          await Promise.allSettled(auditTasks);
        } catch (err: any) {
          console.warn(`[email-sift] Axis audit batch failed (non-blocking): ${err?.message ?? String(err)}`);
        }
      })();
    }

    // Stitch rule-matched + LLM-classified back into original input order.
    return emails.map((e) => ruleResults.get(e.id) ?? llmVerdicts.get(e.id)!);
  } catch (error) {
    console.error('[email-sift] Classification error:', error);
    // Failure fallback: rule matches still honored; the rest fall through to
    // 'uncertain' so the morning briefing surfaces them.
    return emails.map((e) => ruleResults.get(e.id) ?? ({
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

async function sendEmailSummary(
  phoneNumber: string,
  emails: EmailSummary[],
  attachmentAnalyses?: Map<string, Array<{ filename: string; analysis: any }>>,
): Promise<void> {
  // Enqueue ONE notification per email (or one summary if there are many)
  // so the next scheduled digest bundles them together. No more individual
  // texts each time email-sift runs.
  const cleanPhone = phoneNumber.replace(/[\s\-\+\(\)]/g, '');
  const { enqueueNotification } = await import('../../_lib/notifications');

  if (emails.length <= 3) {
    for (const e of emails) {
      const sev = e.classification === 'urgent' ? 'high' : 'medium';
      // Surface-time attachment analysis — if the email has PDFs and
      // Iris already decided to surface it (urgent / needs_response),
      // include a one-line attachment summary so the owner sees the
      // doc context in the same notification.
      const analyses = attachmentAnalyses?.get(e.id) ?? [];
      const attachmentLine = analyses.length > 0
        ? `\n📎 ${analyses.map((a) => `${a.filename}: ${(a.analysis?.summary ?? '').slice(0, 140)}`).join('; ')}`
        : '';
      await enqueueNotification({
        tenantPhone: cleanPhone,
        kind: 'email_attention',
        severity: sev,
        title: `${e.classification === 'urgent' ? 'Urgent email' : 'Email needs reply'} from ${e.from}`,
        body: `Subject: ${e.subject}${e.draftReply ? ` — draft ready: "${e.draftReply.slice(0, 80)}${e.draftReply.length > 80 ? '...' : ''}"` : ''}${attachmentLine}`,
        sourceAgent: 'email-sift',
        sourceId: e.id,
        metadata: {
          from: e.from,
          subject: e.subject,
          has_draft: !!e.draftReply,
          attachment_count: analyses.length,
          attachment_summaries: analyses.map((a) => ({ filename: a.filename, summary: a.analysis?.summary })),
        },
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

async function storePendingDrafts(
  phoneNumber: string,
  emails: EmailSummary[],
  attachmentAnalyses?: Map<string, Array<{ filename: string; analysis: any }>>,
): Promise<void> {
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
  // Timestamps (2026-05-30): this rebuilds pendingEmailDrafts from the current
  // inbox every run, so a naive createdAt would reset each cron. Carry
  // firstSeenAt forward (matched by draft id) so the deck + aging can show how
  // long a draft has ACTUALLY been pending; updatedAt marks the latest refresh;
  // emailDate anchors to the underlying email's received time.
  const prevDrafts: Array<{ id: string; firstSeenAt?: string; emailDate?: string }> =
    Array.isArray(profile.pendingEmailDrafts) ? profile.pendingEmailDrafts : [];
  const prevById = new Map(prevDrafts.map((d) => [d.id, d]));
  const nowIso = new Date().toISOString();
  profile.pendingEmailDrafts = emails.map((e) => {
    const analyses = attachmentAnalyses?.get(e.id) ?? [];
    const prev = prevById.get(e.id);
    return {
      id: e.id,
      from: e.from,
      subject: e.subject,
      draftReply: e.draftReply,
      classification: e.classification,
      lane: e.lane ?? 'orchestrator',
      emailDate: e.date ?? prev?.emailDate ?? null,
      firstSeenAt: prev?.firstSeenAt ?? nowIso,
      updatedAt: nowIso,
      attachmentAnalyses: analyses.length > 0 ? analyses.map((a) => ({
        filename: a.filename,
        summary: a.analysis?.summary,
        keyDates: a.analysis?.keyDates,
        risks: a.analysis?.risks,
      })) : undefined,
    };
  });

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

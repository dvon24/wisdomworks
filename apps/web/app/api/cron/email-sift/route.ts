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

/** Fetch active email OAuth connections (Google or Microsoft) */
async function fetchActiveEmailConnections(): Promise<(OAuthConnection & { phone_number: string })[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/oauth_connections?service=eq.email&status=eq.active&provider=in.(google,microsoft)&select=*`,
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
  const result = await listEmails(decrypted, 10);
  if (!result.success || !result.data?.length) {
    return { processed: 0, actionable: 0 };
  }

  const emails = result.data;
  const processed = await classifyAndDraft(emails);
  const actionable = processed.filter(
    (e) => e.classification === 'urgent' || e.classification === 'needs_response',
  );

  if (actionable.length > 0) {
    await sendEmailSummary(conn.phone_number, actionable);
    await storePendingDrafts(conn.phone_number, actionable);
  }

  return { processed: emails.length, actionable: actionable.length };
}

async function classifyAndDraft(emails: EmailMessage[]): Promise<EmailSummary[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return emails.map((e) => ({
      id: e.id,
      from: e.from,
      subject: e.subject,
      preview: e.bodyPreview ?? e.body.slice(0, 100),
      date: e.date,
      classification: 'informational' as const,
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
            text: `You classify emails and draft replies. Return ONLY a valid JSON array. Each item: { "index": number, "classification": "urgent"|"needs_response"|"informational"|"spam", "draftReply": "reply text or null" }. Draft replies should be professional and concise. Only draft replies for urgent and needs_response emails.`,
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
    const results: { index: number; classification: string; draftReply: string | null }[] = jsonMatch
      ? JSON.parse(jsonMatch[0])
      : [];

    return emails.map((e, i) => {
      const result = results.find((r) => r.index === i + 1);
      return {
        id: e.id,
        from: e.fromName ? `${e.fromName} <${e.from}>` : e.from,
        subject: e.subject,
        preview: (e.body || e.bodyPreview).slice(0, 100),
        date: e.date,
        classification: (result?.classification ?? 'informational') as EmailSummary['classification'],
        draftReply: result?.draftReply ?? undefined,
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
    }));
  }
}

async function sendEmailSummary(phoneNumber: string, emails: EmailSummary[]): Promise<void> {
  const lines = [`You have ${emails.length} email${emails.length > 1 ? 's' : ''} that need attention:`, ''];

  emails.forEach((e, i) => {
    const tag = e.classification === 'urgent' ? 'URGENT' : 'Reply needed';
    lines.push(`${i + 1}. [${tag}] From: ${e.from}`);
    lines.push(`   Subject: ${e.subject}`);
    if (e.draftReply) {
      lines.push(`   Draft: "${e.draftReply.slice(0, 120)}${e.draftReply.length > 120 ? '...' : ''}"`);
    }
    lines.push('');
  });

  lines.push('Reply with:');
  lines.push('- "approve 1" to send draft');
  lines.push('- "edit 1 [text]" to modify');
  lines.push('- "skip 1" to ignore');

  await sendWhatsApp(phoneNumber, lines.join('\n'));
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
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneId || !accessToken) return;

  const cleanTo = to.replace(/[\s\-\+\(\)]/g, '');

  await fetch(`${GRAPH_API}/${phoneId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: cleanTo,
      type: 'text',
      text: { body: message },
    }),
  });
}

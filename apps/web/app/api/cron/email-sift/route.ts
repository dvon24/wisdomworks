/**
 * Email Sift Cron — reads inbox, classifies emails, drafts responses.
 *
 * Runs every 30 minutes (configured in vercel.json).
 * 1. Connects to Yahoo IMAP inbox
 * 2. Fetches unread emails from last 24 hours
 * 3. Uses Claude to classify: urgent, needs-response, informational, spam
 * 4. For emails needing response: generates a draft reply
 * 5. Sends draft to owner via WhatsApp for approval
 *
 * The owner replies with "approve 1", "edit 2", or "skip 3" to handle each email.
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const GRAPH_API = 'https://graph.facebook.com/v25.0';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Devon's phone number for WhatsApp notifications
const OWNER_PHONE = '491703604562';

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

  try {
    // Fetch unread emails via IMAP
    const emails = await fetchUnreadEmails();

    if (!emails.length) {
      console.log('[email-sift] No unread emails');
      return NextResponse.json({ processed: 0 });
    }

    // Classify and draft responses using AI
    const processed = await classifyAndDraft(emails);

    // Filter emails that need the owner's attention
    const actionable = processed.filter(
      (e) => e.classification === 'urgent' || e.classification === 'needs_response',
    );

    if (actionable.length > 0) {
      // Send summary to owner via WhatsApp
      await sendEmailSummary(actionable);

      // Store pending drafts in Supabase for approval
      await storePendingDrafts(actionable);
    }

    console.log(`[email-sift] Processed ${emails.length} emails, ${actionable.length} need attention`);
    return NextResponse.json({
      processed: emails.length,
      actionable: actionable.length,
    });
  } catch (error) {
    console.error('[email-sift] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

async function fetchUnreadEmails(): Promise<{ from: string; subject: string; text: string; date: string; messageId: string }[]> {
  const host = process.env.IMAP_HOST ?? 'imap.mail.yahoo.com';
  const port = parseInt(process.env.IMAP_PORT ?? '993', 10);
  const user = process.env.EMAIL_USER;
  const pass = process.env.IMAP_PASSWORD ?? process.env.EMAIL_APP_PASSWORD;

  if (!user || !pass) {
    console.warn('[email-sift] No IMAP credentials configured');
    return [];
  }

  try {
    // Dynamic import to avoid build issues
    const { ImapFlow } = await import('imapflow');

    const client = new ImapFlow({
      host,
      port,
      secure: true,
      auth: { user, pass },
      logger: false,
    });

    await client.connect();

    const lock = await client.getMailboxLock('INBOX');
    const emails: { from: string; subject: string; text: string; date: string; messageId: string }[] = [];

    try {
      // Fetch unseen messages from last 24 hours
      const since = new Date();
      since.setHours(since.getHours() - 24);

      for await (const message of client.fetch(
        { seen: false, since },
        { envelope: true, source: true },
      )) {
        const envelope = message.envelope;
        if (!envelope) continue;

        const from = envelope.from?.[0]?.address ?? 'unknown';
        const subject = envelope.subject ?? '(no subject)';
        const date = envelope.date?.toISOString() ?? new Date().toISOString();
        const messageId = envelope.messageId ?? message.uid.toString();

        // Get text preview from source (first 500 chars)
        let text = '';
        if (message.source) {
          const sourceStr = message.source.toString();
          // Simple text extraction — get the plain text part
          const textMatch = sourceStr.match(/Content-Type: text\/plain[\s\S]*?\r\n\r\n([\s\S]*?)(?:\r\n--|\r\n\.\r\n|$)/i);
          text = (textMatch?.[1] ?? sourceStr.slice(-500)).slice(0, 500);
        }

        emails.push({ from, subject, text, date, messageId });

        // Limit to 10 emails per run
        if (emails.length >= 10) break;
      }
    } finally {
      lock.release();
    }

    await client.logout();
    return emails;
  } catch (error) {
    console.error('[email-sift] IMAP error:', error);
    return [];
  }
}

async function classifyAndDraft(
  emails: { from: string; subject: string; text: string; date: string; messageId: string }[],
): Promise<EmailSummary[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return emails.map((e) => ({
      id: e.messageId,
      from: e.from,
      subject: e.subject,
      preview: e.text.slice(0, 100),
      date: e.date,
      classification: 'informational' as const,
    }));
  }

  const emailList = emails
    .map((e, i) => `Email ${i + 1}:\nFrom: ${e.from}\nSubject: ${e.subject}\nPreview: ${e.text.slice(0, 300)}\nDate: ${e.date}`)
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
        system: [{
          type: 'text',
          text: `You classify emails and draft replies. Return ONLY valid JSON array. Each item: { "index": number, "classification": "urgent"|"needs_response"|"informational"|"spam", "draftReply": "reply text or null" }. Draft replies should be professional and concise. Only draft replies for urgent and needs_response emails.`,
          cache_control: { type: 'ephemeral' },
        }],
        messages: [{
          role: 'user',
          content: `Classify these emails and draft replies where needed:\n\n${emailList}`,
        }],
      }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    const text = data.content?.[0]?.text ?? '[]';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    const results: { index: number; classification: string; draftReply: string | null }[] =
      jsonMatch ? JSON.parse(jsonMatch[0]) : [];

    return emails.map((e, i) => {
      const result = results.find((r) => r.index === i + 1);
      return {
        id: e.messageId,
        from: e.from,
        subject: e.subject,
        preview: e.text.slice(0, 100),
        date: e.date,
        classification: (result?.classification ?? 'informational') as EmailSummary['classification'],
        draftReply: result?.draftReply ?? undefined,
      };
    });
  } catch (error) {
    console.error('[email-sift] Classification error:', error);
    return emails.map((e) => ({
      id: e.messageId,
      from: e.from,
      subject: e.subject,
      preview: e.text.slice(0, 100),
      date: e.date,
      classification: 'informational' as const,
    }));
  }
}

async function sendEmailSummary(emails: EmailSummary[]): Promise<void> {
  const lines = [
    `You have ${emails.length} email${emails.length > 1 ? 's' : ''} that need attention:`,
    '',
  ];

  emails.forEach((e, i) => {
    const tag = e.classification === 'urgent' ? 'URGENT' : 'Reply needed';
    lines.push(`${i + 1}. [${tag}] From: ${e.from}`);
    lines.push(`   Subject: ${e.subject}`);
    if (e.draftReply) {
      lines.push(`   Draft reply: "${e.draftReply.slice(0, 100)}${e.draftReply.length > 100 ? '...' : ''}"`);
    }
    lines.push('');
  });

  lines.push('Reply with:');
  lines.push('- "approve 1" to send draft reply');
  lines.push('- "edit 1 [your text]" to modify and send');
  lines.push('- "skip 1" to ignore');

  await sendWhatsApp(OWNER_PHONE, lines.join('\n'));
}

async function storePendingDrafts(emails: EmailSummary[]): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;

  // Store in the user's context profile as active topics
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${OWNER_PHONE}`,
    {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
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

  await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${OWNER_PHONE}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({ profile }),
  });
}

async function sendWhatsApp(to: string, message: string): Promise<void> {
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneId || !accessToken) return;

  await fetch(`${GRAPH_API}/${phoneId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: message },
    }),
  });
}

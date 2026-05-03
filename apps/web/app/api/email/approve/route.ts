/**
 * Email Approve — sends a drafted email reply after owner approves via WhatsApp.
 *
 * POST /api/email/approve
 * { emailIndex, action: 'approve' | 'skip', editedText? }
 */

import { NextResponse } from 'next/server';
import { createTransport } from 'nodemailer';

export const dynamic = 'force-dynamic';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OWNER_PHONE = '491703604562';

const transporter = createTransport({
  service: 'yahoo',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_APP_PASSWORD,
  },
});

export async function POST(request: Request) {
  try {
    const { emailIndex, action, editedText } = await request.json();

    if (action === 'skip') {
      return NextResponse.json({ status: 'skipped' });
    }

    // Get pending drafts from Supabase
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      return NextResponse.json({ error: 'No Supabase configured' }, { status: 500 });
    }

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${OWNER_PHONE}&select=profile`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        },
      },
    );

    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to fetch drafts' }, { status: 500 });
    }

    const rows = await res.json();
    const profile = rows[0]?.profile;
    const drafts = profile?.pendingEmailDrafts ?? [];
    const draft = drafts[emailIndex - 1];

    if (!draft) {
      return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
    }

    // Send the email
    const replyText = editedText ?? draft.draftReply;
    if (!replyText) {
      return NextResponse.json({ error: 'No reply text' }, { status: 400 });
    }

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: draft.from,
      subject: `Re: ${draft.subject}`,
      text: replyText,
    });

    // Remove from pending
    drafts.splice(emailIndex - 1, 1);
    profile.pendingEmailDrafts = drafts;

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

    console.log(`[email-approve] Sent reply to ${draft.from} re: ${draft.subject}`);
    return NextResponse.json({ status: 'sent', to: draft.from });
  } catch (error) {
    console.error('[email-approve] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

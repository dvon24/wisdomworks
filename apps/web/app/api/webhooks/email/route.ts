/**
 * Email Webhook — receives inbound emails as commands.
 *
 * Works with email forwarding services (SendGrid Inbound Parse,
 * Mailgun Routes, or a simple IMAP polling service).
 *
 * Devon sends email to: commands@wisdomworks.com
 * Email service forwards to this webhook as JSON.
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

interface IncomingEmail {
  from: string;
  to: string;
  subject: string;
  body: string;
  timestamp: string;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const email: IncomingEmail = {
      from: body.from ?? body.sender ?? '',
      to: body.to ?? body.recipient ?? '',
      subject: body.subject ?? '',
      body: body.text ?? body.body ?? body['stripped-text'] ?? '',
      timestamp: new Date().toISOString(),
    };

    console.log('[email-webhook]', JSON.stringify({
      from: email.from,
      subject: email.subject,
      bodyPreview: email.body.slice(0, 100),
      timestamp: email.timestamp,
    }));

    // The command is in the email body (or subject for quick commands)
    const commandText = email.body.trim() || email.subject.trim();

    if (!commandText) {
      return NextResponse.json({ status: 'ignored', reason: 'empty message' });
    }

    // TODO: Verify sender against registered sources
    // TODO: Parse command
    // TODO: Check authorization + scope
    // TODO: Execute command
    // TODO: Send reply email with results

    return NextResponse.json({
      status: 'received',
      command: commandText.slice(0, 200),
      from: email.from,
      message: 'Command received. Execution pipeline coming soon.',
    });
  } catch (error) {
    console.error('[email-webhook] Error:', error);
    return NextResponse.json({ error: 'Webhook error' }, { status: 500 });
  }
}

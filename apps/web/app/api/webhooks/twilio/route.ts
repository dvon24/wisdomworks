/**
 * Twilio Webhook — receives inbound SMS/WhatsApp messages.
 * Parses commands, verifies security, executes, responds.
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// In production, import from services/agents/src/remote/
// For now, inline the logic to keep it self-contained

interface IncomingMessage {
  From: string;
  Body: string;
  MessageSid: string;
  AccountSid: string;
  To: string;
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const message: IncomingMessage = {
      From: formData.get('From') as string ?? '',
      Body: formData.get('Body') as string ?? '',
      MessageSid: formData.get('MessageSid') as string ?? '',
      AccountSid: formData.get('AccountSid') as string ?? '',
      To: formData.get('To') as string ?? '',
    };

    console.log('[twilio-webhook]', JSON.stringify({
      from: message.From,
      body: message.Body.slice(0, 100),
      timestamp: new Date().toISOString(),
    }));

    // TODO: Verify Twilio signature for production
    // TODO: Look up registered sources from database
    // TODO: Parse command, check authorization, execute
    // TODO: Send response via Twilio API

    // For now, log and acknowledge
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>WisdomWorks received your message. Remote commands coming soon!</Message>
</Response>`;

    return new Response(twiml, {
      headers: { 'Content-Type': 'application/xml' },
    });
  } catch (error) {
    console.error('[twilio-webhook] Error:', error);
    return NextResponse.json({ error: 'Webhook error' }, { status: 500 });
  }
}

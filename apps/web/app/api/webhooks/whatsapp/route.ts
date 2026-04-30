/**
 * WhatsApp Webhook — receives messages from Meta Cloud API.
 *
 * GET: Meta verification handshake
 * POST: Incoming messages from customers
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN ?? 'wisdomworks-whatsapp-verify';
const GRAPH_API = 'https://graph.facebook.com/v25.0';

/**
 * GET — Meta webhook verification.
 * Meta sends this when you register the webhook URL.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[whatsapp-webhook] Verified');
    return new Response(challenge, { status: 200 });
  }

  return new Response('Forbidden', { status: 403 });
}

/**
 * POST — Incoming WhatsApp messages.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Parse incoming message
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];
    const contact = value?.contacts?.[0];

    if (!message) {
      // Status update (delivered, read, etc.) — acknowledge
      return NextResponse.json({ status: 'ok' });
    }

    const from = message.from; // phone number
    const text = message.text?.body ?? '';
    const name = contact?.profile?.name ?? 'Customer';

    console.log(`[whatsapp] 📩 ${name} (${from}): ${text}`);

    // Process the message and generate agent response
    const agentResponse = processAgentMessage(text, name);

    // Send reply via Meta API
    const phoneId = process.env.WHATSAPP_PHONE_ID;
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

    if (phoneId && accessToken) {
      await fetch(`${GRAPH_API}/${phoneId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: from,
          type: 'text',
          text: { body: agentResponse },
        }),
      });
      console.log(`[whatsapp] 📤 Replied to ${name}`);
    }

    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    console.error('[whatsapp-webhook] Error:', error);
    return NextResponse.json({ status: 'error' }, { status: 500 });
  }
}

/**
 * Process message and generate agent response.
 * In production: routes to the personal assistant agent via LangGraph.
 */
function processAgentMessage(text: string, name: string): string {
  const input = text.toLowerCase().trim();

  if (input.includes('status') || input.includes('update')) {
    return `📊 Hi ${name}! Here's your status:\n\n✅ All systems operational\n📅 3 appointments today\n💬 2 new inquiries\n\nReply with any question!`;
  }

  if (input.includes('book') || input.includes('appointment') || input.includes('schedule')) {
    return `📅 I'd love to help you book! What service are you looking for and what day/time works best?\n\nOur available times:\n• Tomorrow 10am, 2pm, 4pm\n• Thursday 9am, 11am, 3pm`;
  }

  if (input.includes('price') || input.includes('cost') || input.includes('how much')) {
    return `💰 Here are our services:\n\n• Eyebrow styling: $45-65\n• Bridal makeup: $150-250\n• Trial session: $75\n\nWould you like to book?`;
  }

  if (input.includes('hello') || input.includes('hi') || input.includes('hey')) {
    return `✨ Hi ${name}! Welcome to WisdomWorks.\n\nI'm your AI assistant. I can help with:\n• 📅 Booking appointments\n• 💬 Answering questions\n• 📊 Business updates\n\nWhat can I do for you?`;
  }

  return `✨ Hi ${name}! I received your message: "${text}"\n\nI can help with:\n• 📅 Book an appointment\n• 💰 Service pricing\n• 📊 Status update\n\nJust let me know what you need!`;
}

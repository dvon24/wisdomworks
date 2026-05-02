/**
 * WhatsApp Webhook — receives messages from Meta Cloud API.
 *
 * GET: Meta verification handshake
 * POST: Incoming messages from customers
 *
 * Security:
 * - HMAC-SHA256 signature verification on every POST (Meta app secret)
 * - Input length limits
 * - Sanitized user input before any processing
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const VERIFY_TOKEN = 'wisdomworks-whatsapp-verify';
const GRAPH_API = 'https://graph.facebook.com/v25.0';
const MAX_MESSAGE_LENGTH = 4096;

/**
 * Verify Meta webhook signature (HMAC-SHA256).
 * Meta signs every POST with your app secret.
 */
async function verifySignature(
  request: Request,
  rawBody: string,
): Promise<boolean> {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) {
    console.warn('[whatsapp-webhook] WHATSAPP_APP_SECRET not set — signature verification disabled');
    return true; // Allow in dev; block in production by setting the secret
  }

  const signature = request.headers.get('x-hub-signature-256');
  if (!signature) return false;

  const expectedSig = signature.replace('sha256=', '');

  // Use Web Crypto API (works in Vercel Edge + Node)
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
  const hexSig = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return hexSig === expectedSig;
}

/**
 * Sanitize user input — strip control characters, enforce length.
 */
function sanitizeInput(text: string): string {
  // Strip control characters except newlines
  const cleaned = text.replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g, '');
  return cleaned.slice(0, MAX_MESSAGE_LENGTH);
}

/**
 * Sanitize display name — prevent injection via contact profile.
 */
function sanitizeName(name: string): string {
  return name.replace(/[<>&"'\/\\]/g, '').slice(0, 100);
}

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
    // Read raw body for signature verification
    const rawBody = await request.text();

    // Verify Meta signature
    if (!(await verifySignature(request, rawBody))) {
      console.warn('[whatsapp-webhook] Invalid signature — rejecting');
      return new Response('Unauthorized', { status: 401 });
    }

    const body = JSON.parse(rawBody);

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
    const rawText = message.text?.body ?? '';
    const rawName = contact?.profile?.name ?? 'Customer';

    // Sanitize inputs
    const text = sanitizeInput(rawText);
    const name = sanitizeName(rawName);

    if (!text) {
      return NextResponse.json({ status: 'ok' });
    }

    console.log(`[whatsapp] Message from ${name} (${from}): ${text.slice(0, 100)}`);

    // Process the message and generate agent response
    const agentResponse = await processAgentMessage(text, name);

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
      console.log(`[whatsapp] Replied to ${name}`);
    }

    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    console.error('[whatsapp-webhook] Error:', error);
    return NextResponse.json({ status: 'error' }, { status: 500 });
  }
}

/**
 * Process message and generate agent response.
 *
 * Current: keyword-based responses for testing.
 * Next: routes to personal assistant agent via AI with full context.
 */
async function processAgentMessage(text: string, name: string): Promise<string> {
  const input = text.toLowerCase().trim();

  if (input.includes('status') || input.includes('update')) {
    return `Hi ${name}! Here's your status:\n\nAll systems operational\n3 appointments today\n2 new inquiries\n\nReply with any question!`;
  }

  if (input.includes('book') || input.includes('appointment') || input.includes('schedule')) {
    return `I'd love to help you book! What service are you looking for and what day/time works best?\n\nOur available times:\n- Tomorrow 10am, 2pm, 4pm\n- Thursday 9am, 11am, 3pm`;
  }

  if (input.includes('price') || input.includes('cost') || input.includes('how much')) {
    return `Here are our services:\n\n- Eyebrow styling: $45-65\n- Bridal makeup: $150-250\n- Trial session: $75\n\nWould you like to book?`;
  }

  if (input.includes('hello') || input.includes('hi') || input.includes('hey')) {
    return `Hi ${name}! Welcome to WisdomWorks.\n\nI'm your AI assistant. I can help with:\n- Booking appointments\n- Answering questions\n- Business updates\n\nWhat can I do for you?`;
  }

  return `Hi ${name}! I received your message.\n\nI can help with:\n- Book an appointment\n- Service pricing\n- Status update\n\nJust let me know what you need!`;
}

/**
 * WhatsApp Webhook — receives messages from Meta Cloud API.
 *
 * GET: Meta verification handshake
 * POST: Incoming messages → persistent context → AI brain → auto-reply
 *
 * Security: HMAC-SHA256 signatures, input sanitization, user identification
 * Context: Database-backed persistent memory per user (survives cold starts)
 * Caching: Anthropic prompt caching on system prompt (5min TTL, saves ~80% input tokens)
 * Languages: Auto-detects user language, responds in same language
 */

import { NextResponse } from 'next/server';
import { loadUserContext, type UserContext } from './context-store';
import { generateIrisReply } from './iris-brain';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const VERIFY_TOKEN = 'wisdomworks-whatsapp-verify';
const GRAPH_API = 'https://graph.facebook.com/v25.0';
const MAX_MESSAGE_LENGTH = 4096;

// ─── Security ───

async function verifySignature(request: Request, rawBody: string): Promise<boolean> {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) return true;

  const signature = request.headers.get('x-hub-signature-256');
  if (!signature) return false;

  const expectedSig = signature.replace('sha256=', '');
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
  const hexSig = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0')).join('');

  return hexSig === expectedSig;
}

function sanitizeInput(text: string): string {
  return text.replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g, '').slice(0, MAX_MESSAGE_LENGTH);
}

function sanitizeName(name: string): string {
  return name.replace(/[<>&"'\/\\]/g, '').slice(0, 100);
}


// ─── Routes ───

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

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();

    if (!(await verifySignature(request, rawBody))) {
      console.warn('[whatsapp-webhook] Invalid signature');
      return new Response('Unauthorized', { status: 401 });
    }

    const body = JSON.parse(rawBody);
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];
    const contact = value?.contacts?.[0];

    if (!message) {
      return NextResponse.json({ status: 'ok' });
    }

    const from = message.from;
    const text = sanitizeInput(message.text?.body ?? '');
    const name = sanitizeName(contact?.profile?.name ?? 'Customer');

    if (!text) {
      return NextResponse.json({ status: 'ok' });
    }

    console.log(`[whatsapp] Message from ${name} (${from}): ${text.slice(0, 100)}`);

    // Load persistent user context (survives Vercel cold starts)
    const user = await loadUserContext(from, name);

    // Generate AI response with full context (shared brain — same path as Command Deck)
    const agentResponse = await generateIrisReply(text, user, 'whatsapp');

    // Send reply
    const phoneId = process.env.WHATSAPP_PHONE_ID;
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

    if (phoneId && accessToken) {
      const sendResult = await fetch(`${GRAPH_API}/${phoneId}/messages`, {
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

      if (!sendResult.ok) {
        const err = await sendResult.json();
        console.error('[whatsapp] Send failed:', err);
      } else {
        console.log(`[whatsapp] Replied to ${name}`);
      }
    }

    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    console.error('[whatsapp-webhook] Error:', error);
    return NextResponse.json({ status: 'error' }, { status: 500 });
  }
}

/**
 * Command Deck chat endpoint.
 *
 * POST /api/chat
 * { phone: "491703604562", message: "Marcus needs GitHub" }
 *
 * Loads the user's context, runs the same Iris brain that powers WhatsApp,
 * and returns the assistant's reply. Conversation history is shared with
 * WhatsApp via whatsapp_contexts.conversation_history, so what Iris hears on
 * the deck she also remembers on WhatsApp and vice-versa.
 */

import { NextResponse } from 'next/server';
import { loadUserContext } from '../webhooks/whatsapp/context-store';
import { generateIrisReply } from '../webhooks/whatsapp/iris-brain';
// Force-include imapflow — see whatsapp/route.ts for rationale.
import * as _imapflow from 'imapflow';
void _imapflow;

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const phoneRaw = (body.phone || '').toString();
    const message = (body.message || '').toString().trim();

    if (!phoneRaw || !message) {
      return NextResponse.json({ error: 'phone and message required' }, { status: 400 });
    }

    const phone = phoneRaw.replace(/[\s\-+()]/g, '');
    const user = await loadUserContext(phone, body.name || 'Owner');
    const reply = await generateIrisReply(message, user, 'deck');

    return NextResponse.json({
      reply,
      // Surface team after possible mutations so the deck can refresh its hierarchy
      team: user.profile?.team ?? [],
    });
  } catch (err) {
    console.error('[chat] Error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

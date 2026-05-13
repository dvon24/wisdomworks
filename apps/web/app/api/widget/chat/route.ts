/**
 * Widget Chat API — public chat endpoint for the embedded widget.
 *
 * POST /api/widget/chat
 *   Headers: X-API-Key: wk_...
 *   Body: { message: string, visitor_id: string, visitor_name?, visitor_email? }
 *   Returns: { reply: string, conversation_id: string }
 *
 * Routes the visitor's message through the customer_service lane on the
 * owner's team. The conversation history is stored in
 * widget_conversations, scoped to (api_key_id, visitor_id) so repeat
 * visitors get continuity.
 *
 * CORS is enabled for any origin — the API key + origin allowlist on
 * the key row is the security boundary, not CORS.
 */

import { NextResponse } from 'next/server';
import { verifyApiKey } from '../../_lib/widget-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CHAT_MODEL = 'claude-sonnet-4-20250514';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: Request) {
  const apiKey = request.headers.get('x-api-key') ?? '';
  const origin = request.headers.get('origin') ?? undefined;
  const verified = await verifyApiKey(apiKey, origin);
  if (!verified) {
    return NextResponse.json({ error: 'invalid api key' }, { status: 401, headers: CORS_HEADERS });
  }
  if (!verified.scopes.includes('chat')) {
    return NextResponse.json({ error: 'key lacks chat scope' }, { status: 403, headers: CORS_HEADERS });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400, headers: CORS_HEADERS });
  }

  const message = String(body.message ?? '').trim().slice(0, 4000);
  const visitorId = String(body.visitor_id ?? '').trim().slice(0, 100);
  if (!message || !visitorId) {
    return NextResponse.json({ error: 'message and visitor_id required' }, { status: 400, headers: CORS_HEADERS });
  }

  // Load or create the conversation row
  const conversation = await loadOrCreateConversation({
    tenantPhone: verified.tenant_phone,
    apiKeyId: verified.id,
    visitorId,
    origin,
    visitorName: body.visitor_name,
    visitorEmail: body.visitor_email,
    visitorPhone: body.visitor_phone,
  });
  if (!conversation) {
    return NextResponse.json({ error: 'failed to start conversation' }, { status: 500, headers: CORS_HEADERS });
  }

  // Build the prompt — we're the OWNER's customer_service lane talking to a
  // VISITOR on the owner's website. Different role than Iris talking to the
  // owner directly.
  const messages = [
    ...conversation.messages,
    { role: 'user', content: message },
  ];

  const reply = await generateReply({
    tenantPhone: verified.tenant_phone,
    visitor: { name: body.visitor_name, email: body.visitor_email },
    origin,
    messages,
  });

  // Persist the new turn
  const updatedMessages = [
    ...messages,
    { role: 'assistant', content: reply, timestamp: new Date().toISOString() },
  ];
  await persistConversation(conversation.id, updatedMessages, {
    visitorName: body.visitor_name,
    visitorEmail: body.visitor_email,
    visitorPhone: body.visitor_phone,
  });

  return NextResponse.json(
    { reply, conversation_id: conversation.id },
    { headers: CORS_HEADERS },
  );
}

async function loadOrCreateConversation(input: {
  tenantPhone: string;
  apiKeyId: string;
  visitorId: string;
  origin?: string;
  visitorName?: string;
  visitorEmail?: string;
  visitorPhone?: string;
}): Promise<{ id: string; messages: any[] } | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };
  try {
    // Look up existing open conversation for this visitor
    const findRes = await fetch(
      `${SUPABASE_URL}/rest/v1/widget_conversations?api_key_id=eq.${input.apiKeyId}&visitor_id=eq.${encodeURIComponent(input.visitorId)}&status=eq.open&select=id,messages&order=last_message_at.desc&limit=1`,
      { headers },
    );
    const existing = findRes.ok ? await findRes.json() : [];
    if (existing[0]) return existing[0];

    // Create new
    const createRes = await fetch(`${SUPABASE_URL}/rest/v1/widget_conversations`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({
        tenant_phone: input.tenantPhone,
        api_key_id: input.apiKeyId,
        visitor_id: input.visitorId,
        origin: input.origin ?? null,
        visitor_name: input.visitorName ?? null,
        visitor_email: input.visitorEmail ?? null,
        visitor_phone: input.visitorPhone ?? null,
        messages: [],
      }),
    });
    if (!createRes.ok) return null;
    const created = await createRes.json();
    return { id: created[0]?.id, messages: [] };
  } catch (err) {
    console.warn('[widget-chat] conversation load/create failed:', err);
    return null;
  }
}

async function persistConversation(conversationId: string, messages: any[], visitorInfo: {
  visitorName?: string;
  visitorEmail?: string;
  visitorPhone?: string;
}): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    const patch: any = {
      messages,
      message_count: messages.length,
      last_message_at: new Date().toISOString(),
    };
    if (visitorInfo.visitorName) patch.visitor_name = visitorInfo.visitorName;
    if (visitorInfo.visitorEmail) patch.visitor_email = visitorInfo.visitorEmail;
    if (visitorInfo.visitorPhone) patch.visitor_phone = visitorInfo.visitorPhone;
    await fetch(`${SUPABASE_URL}/rest/v1/widget_conversations?id=eq.${conversationId}`, {
      method: 'PATCH',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(patch),
    });
  } catch {
    // non-fatal
  }
}

async function generateReply(input: {
  tenantPhone: string;
  visitor: { name?: string; email?: string };
  origin?: string;
  messages: any[];
}): Promise<string> {
  if (!ANTHROPIC_API_KEY) {
    return "We've received your message and will get back to you shortly.";
  }

  // Load tenant context for personality + grounding
  let businessName = 'this business';
  let businessType = '';
  let verticalLabel = '';
  let recentAtoms: string[] = [];

  if (SUPABASE_URL && SUPABASE_KEY) {
    try {
      const ctxRes = await fetch(
        `${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${input.tenantPhone}&select=business_name,business_type,profile`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
      );
      const rows = ctxRes.ok ? await ctxRes.json() : [];
      if (rows[0]) {
        businessName = rows[0].business_name ?? businessName;
        businessType = rows[0].business_type ?? '';
        verticalLabel = rows[0].profile?.vertical_template?.label ?? '';
      }
      const atomsRes = await fetch(
        `${SUPABASE_URL}/rest/v1/tenant_knowledge_atoms?tenant_phone=eq.${input.tenantPhone}&kind=in.(fact,goal,preference)&owner_confirmed=eq.true&order=updated_at.desc&limit=10&select=content`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
      );
      const atoms = atomsRes.ok ? await atomsRes.json() : [];
      recentAtoms = atoms.map((a: any) => a.content);
    } catch {}
  }

  const systemPrompt = `You're the customer-facing chat assistant for ${businessName}${businessType ? ` (a ${businessType})` : ''}.

You're talking to a website visitor — likely a prospective or existing customer. Be warm, brief, and useful. NEVER claim to be a real human; if asked directly, be honest you're the business's AI assistant but say you can route them to the owner if they need a human.

WHAT YOU KNOW about this business:
${recentAtoms.length > 0 ? recentAtoms.map((a) => `  - ${a}`).join('\n') : '  (limited — keep responses general)'}

WHAT YOU CAN DO:
- Answer questions about hours, services, pricing IF you know them
- Capture name + contact info so the business can follow up
- Pass leads to the owner via the customer_service lane (every conversation lands in the owner's WhatsApp/deck)

WHAT YOU CAN'T DO:
- Book appointments directly (this widget version is chat-only; future booking widget handles that)
- Quote firm prices unless they're in the WHAT YOU KNOW section
- Promise things the business hasn't authorized

If a visitor asks something you can't answer confidently, say so and tell them you'll have the owner follow up — then explicitly ask for their email or phone if you don't have it yet.

Keep replies short (2-3 sentences) and conversational. Visitor: ${input.visitor.name ?? '(anonymous)'}${input.visitor.email ? ` <${input.visitor.email}>` : ''}.`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: CHAT_MODEL,
        max_tokens: 500,
        system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
        messages: input.messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });
    if (!res.ok) {
      console.warn('[widget-chat] anthropic error:', res.status);
      return "Thanks — we've received your message and will get back to you shortly.";
    }
    const data = await res.json();
    const text = data.content?.find((b: any) => b.type === 'text')?.text;
    return text ?? "Thanks — we'll be in touch.";
  } catch (err) {
    console.warn('[widget-chat] reply exception:', err);
    return "Thanks — we've received your message and will get back to you shortly.";
  }
}

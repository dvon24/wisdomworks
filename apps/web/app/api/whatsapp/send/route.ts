/**
 * Send WhatsApp message — test endpoint.
 * POST /api/whatsapp/send { to: "phone", message: "text" }
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const GRAPH_API = 'https://graph.facebook.com/v25.0';

export async function POST(request: Request) {
  try {
    // Story 6.1 deadbolt — this is a server-to-server test/admin endpoint
    // that can spend WhatsApp credits to any number. Lock it to the admin
    // token; never expose it to public callers.
    const auth = request.headers.get('authorization');
    const ownerToken = process.env.OWNER_API_TOKEN;
    if (!ownerToken || !auth?.startsWith('Bearer ') || auth.slice(7) !== ownerToken) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const { to, message, template } = await request.json();
    const phoneId = process.env.WHATSAPP_PHONE_ID;
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

    if (!phoneId || !accessToken) {
      return NextResponse.json({ error: 'WhatsApp not configured' }, { status: 400 });
    }

    const cleanTo = (to ?? '').replace(/[\s\-\+]/g, '');

    // Template sends (session-initiation, keep-alive) skip conversation
    // history — they're not freeform. Plain text routes through the
    // universal owner-message helper so it lands in Iris's memory.
    if (template) {
      const response = await fetch(`${GRAPH_API}/${phoneId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: cleanTo,
          type: 'template',
          template: { name: template, language: { code: 'en_US' } },
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        return NextResponse.json({ error: data.error?.message, details: data }, { status: response.status });
      }
      return NextResponse.json({ success: true, messageId: data.messages?.[0]?.id });
    }

    const { sendOwnerMessage } = await import('../../_lib/owner-message');
    const result = await sendOwnerMessage({ tenantPhone: cleanTo, body: message ?? '', source: 'manual' });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }
    return NextResponse.json({ success: true, messageId: result.messageId });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

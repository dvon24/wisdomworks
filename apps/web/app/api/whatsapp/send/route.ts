/**
 * Send WhatsApp message — test endpoint.
 * POST /api/whatsapp/send { to: "phone", message: "text" }
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const GRAPH_API = 'https://graph.facebook.com/v25.0';

export async function POST(request: Request) {
  try {
    const { to, message, template } = await request.json();
    const phoneId = process.env.WHATSAPP_PHONE_ID;
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

    if (!phoneId || !accessToken) {
      return NextResponse.json({ error: 'WhatsApp not configured' }, { status: 400 });
    }

    const cleanTo = (to ?? '').replace(/[\s\-\+]/g, '');

    // Send template or text message
    const body = template
      ? {
          messaging_product: 'whatsapp',
          to: cleanTo,
          type: 'template',
          template: { name: template, language: { code: 'en_US' } },
        }
      : {
          messaging_product: 'whatsapp',
          to: cleanTo,
          type: 'text',
          text: { body: message },
        };

    const response = await fetch(`${GRAPH_API}/${phoneId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json({ error: data.error?.message, details: data }, { status: response.status });
    }

    return NextResponse.json({ success: true, messageId: data.messages?.[0]?.id });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

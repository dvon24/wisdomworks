/**
 * WhatsApp Connection API — generates QR codes for customer onboarding.
 *
 * GET /api/whatsapp?tenantId=xxx → SSE stream that sends QR code data URLs
 * POST /api/whatsapp → send a message from the agent
 *
 * Uses Baileys (WhatsApp Web protocol) — same as WhatsApp Web.
 * Customer scans QR code → agent is connected to their WhatsApp.
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// In-memory session store (production: database)
const sessions = new Map<string, {
  status: 'waiting_qr' | 'connected' | 'disconnected';
  qrCode?: string;
  phoneNumber?: string;
  connectedAt?: string;
}>();

/**
 * GET — Stream QR code for WhatsApp connection.
 * Returns SSE with QR code data URL that the browser renders.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const tenantId = url.searchParams.get('tenantId') ?? 'default';

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Dynamic import Baileys to avoid build-time issues
        const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = await import('@whiskeysockets/baileys');
        const { Boom } = await import('@hapi/boom');
        const QRCode = await import('qrcode');

        const authDir = `.whatsapp-sessions/${tenantId}`;

        // Ensure directory exists
        const fs = await import('fs');
        if (!fs.existsSync(authDir)) {
          fs.mkdirSync(authDir, { recursive: true });
        }

        const { state, saveCreds } = await useMultiFileAuthState(authDir);

        const sock = makeWASocket({
          auth: state,
          printQRInTerminal: false,
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update: any) => {
          const { connection, lastDisconnect, qr } = update;

          if (qr) {
            // Generate QR code as data URL and send to browser
            const qrDataUrl = await QRCode.toDataURL(qr, { width: 256, margin: 2 });
            sessions.set(tenantId, { status: 'waiting_qr', qrCode: qrDataUrl });
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'qr', qrDataUrl })}\n\n`));
          }

          if (connection === 'open') {
            const phoneNumber = sock.user?.id?.split(':')[0] ?? 'unknown';
            sessions.set(tenantId, {
              status: 'connected',
              phoneNumber,
              connectedAt: new Date().toISOString(),
            });
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'connected', phoneNumber })}\n\n`));
          }

          if (connection === 'close') {
            const reason = (lastDisconnect?.error as any)?.output?.statusCode;
            if (reason === DisconnectReason.loggedOut) {
              sessions.set(tenantId, { status: 'disconnected' });
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'disconnected', reason: 'logged_out' })}\n\n`));
            }
            controller.close();
          }
        });

        // Handle incoming messages — forward to agent
        sock.ev.on('messages.upsert', (m: any) => {
          for (const msg of m.messages) {
            if (!msg.key.fromMe && msg.message) {
              const text = msg.message.conversation ?? msg.message.extendedTextMessage?.text ?? '';
              const from = msg.key.remoteJid ?? '';
              console.log(`[whatsapp] Message from ${from}: ${text}`);

              // TODO: Route to command executor / personal assistant agent
              // For now, auto-reply
              sock.sendMessage(from, {
                text: `✨ WisdomWorks received your message: "${text}"\n\nYour AI team is being set up. Full agent responses coming soon!`,
              });
            }
          }
        });

        // Clean up on client disconnect
        request.signal.addEventListener('abort', () => {
          controller.close();
        });

      } catch (error) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: String(error) })}\n\n`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

/**
 * POST — Send a WhatsApp message from the agent.
 */
export async function POST(request: Request) {
  try {
    const { tenantId, to, message } = await request.json();

    const session = sessions.get(tenantId ?? 'default');
    if (!session || session.status !== 'connected') {
      return NextResponse.json({ error: 'WhatsApp not connected for this tenant' }, { status: 400 });
    }

    // TODO: use the stored socket to send message
    // For now, acknowledge
    return NextResponse.json({
      status: 'queued',
      to,
      message: message.slice(0, 100),
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

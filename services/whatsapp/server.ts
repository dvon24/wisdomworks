/**
 * Standalone WhatsApp Server — runs outside Next.js.
 * Manages Baileys connections, generates QR codes, handles messages.
 *
 * Run: npx tsx services/whatsapp/server.ts
 * Exposes HTTP API on port 3002 for the Next.js app to call.
 */

import { createServer } from 'http';
import { URL } from 'url';
import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';

const PORT = 3002;

interface Session {
  sock: ReturnType<typeof makeWASocket> | null;
  status: 'disconnected' | 'waiting_qr' | 'connected';
  qrDataUrl: string | null;
  phoneNumber: string | null;
  sseClients: Set<import('http').ServerResponse>;
}

const sessions = new Map<string, Session>();

function getSession(tenantId: string): Session {
  if (!sessions.has(tenantId)) {
    sessions.set(tenantId, {
      sock: null,
      status: 'disconnected',
      qrDataUrl: null,
      phoneNumber: null,
      sseClients: new Set(),
    });
  }
  return sessions.get(tenantId)!;
}

async function startWhatsAppSession(tenantId: string) {
  const session = getSession(tenantId);
  if (session.status === 'connected' || session.status === 'waiting_qr') return;

  const authDir = `.whatsapp-sessions/${tenantId}`;
  const fs = await import('fs');
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true, // also show in terminal for debugging
  });

  session.sock = sock;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      const qrDataUrl = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
      session.status = 'waiting_qr';
      session.qrDataUrl = qrDataUrl;
      // Notify all SSE clients
      for (const client of session.sseClients) {
        client.write(`data: ${JSON.stringify({ type: 'qr', qrDataUrl })}\n\n`);
      }
      console.log(`[${tenantId}] QR code generated — waiting for scan`);
    }

    if (connection === 'open') {
      session.status = 'connected';
      session.phoneNumber = sock.user?.id?.split(':')[0] ?? null;
      session.qrDataUrl = null;
      for (const client of session.sseClients) {
        client.write(`data: ${JSON.stringify({ type: 'connected', phoneNumber: session.phoneNumber })}\n\n`);
      }
      console.log(`[${tenantId}] ✅ Connected! Phone: ${session.phoneNumber}`);
    }

    if (connection === 'close') {
      const reason = (lastDisconnect?.error as any)?.output?.statusCode;
      console.log(`[${tenantId}] Disconnected. Reason: ${reason}`);
      session.status = 'disconnected';
      session.sock = null;
      for (const client of session.sseClients) {
        client.write(`data: ${JSON.stringify({ type: 'disconnected', reason })}\n\n`);
      }
      // Auto-reconnect if not logged out
      if (reason !== DisconnectReason.loggedOut) {
        console.log(`[${tenantId}] Reconnecting...`);
        setTimeout(() => startWhatsAppSession(tenantId), 3000);
      }
    }
  });

  // Handle incoming messages
  sock.ev.on('messages.upsert', async (m) => {
    for (const msg of m.messages) {
      if (!msg.key.fromMe && msg.message) {
        const text = msg.message.conversation ?? msg.message.extendedTextMessage?.text ?? '';
        const from = msg.key.remoteJid ?? '';
        console.log(`[${tenantId}] 📩 Message from ${from}: ${text}`);

        // Auto-reply from agent
        await sock.sendMessage(from, {
          text: `✨ Hi! I'm your WisdomWorks AI assistant. I received: "${text}"\n\nI'll be fully operational soon. For now, your message is logged and your team is being set up!`,
        });
      }
    }
  });
}

// HTTP Server
const server = createServer(async (req, res) => {
  const url = new URL(req.url!, `http://localhost:${PORT}`);

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  // GET /connect?tenantId=xxx — SSE stream for QR codes
  if (url.pathname === '/connect' && req.method === 'GET') {
    const tenantId = url.searchParams.get('tenantId') ?? 'default';
    const session = getSession(tenantId);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    session.sseClients.add(res);
    req.on('close', () => session.sseClients.delete(res));

    // If already connected, tell the client immediately
    if (session.status === 'connected') {
      res.write(`data: ${JSON.stringify({ type: 'connected', phoneNumber: session.phoneNumber })}\n\n`);
      return;
    }

    // If QR already available, send it
    if (session.qrDataUrl) {
      res.write(`data: ${JSON.stringify({ type: 'qr', qrDataUrl: session.qrDataUrl })}\n\n`);
    }

    // Start session if not already running
    startWhatsAppSession(tenantId);
    return;
  }

  // GET /status?tenantId=xxx — check connection status
  if (url.pathname === '/status' && req.method === 'GET') {
    const tenantId = url.searchParams.get('tenantId') ?? 'default';
    const session = getSession(tenantId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      tenantId,
      status: session.status,
      phoneNumber: session.phoneNumber,
    }));
    return;
  }

  // POST /send — send a message
  if (url.pathname === '/send' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => body += c);
    req.on('end', async () => {
      try {
        const { tenantId, to, message } = JSON.parse(body);
        const session = getSession(tenantId ?? 'default');
        if (!session.sock || session.status !== 'connected') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not connected' }));
          return;
        }
        await session.sock.sendMessage(to, { text: message });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'sent' }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(e) }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\n🟢 WhatsApp server running on http://localhost:${PORT}`);
  console.log(`\nEndpoints:`);
  console.log(`  GET  /connect?tenantId=xxx  — SSE stream (QR codes)`);
  console.log(`  GET  /status?tenantId=xxx   — connection status`);
  console.log(`  POST /send                  — send message\n`);
});

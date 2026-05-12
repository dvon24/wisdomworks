/**
 * Telegram Webhook — receives messages from the WisdomWorks Telegram bot.
 *
 * Setup (one-time, per env):
 *   1. Create a bot via BotFather, get TELEGRAM_BOT_TOKEN
 *   2. Set webhook:
 *        curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://app.../api/webhooks/telegram&secret_token=<SECRET>"
 *   3. Set TELEGRAM_BOT_TOKEN + TELEGRAM_WEBHOOK_SECRET in env
 *
 * Linking: owner texts Sophia on WhatsApp "give me a telegram link code",
 * gets back e.g. "ABC23XYZ", then says "/link ABC23XYZ" to the Telegram
 * bot. Bot resolves code → tenant and binds chat_id → tenant_phone.
 */

import { NextResponse } from 'next/server';
import { loadUserContext } from '../whatsapp/context-store';
import { generateIrisReply } from '../whatsapp/iris-brain';
import { resolveTenantForChannel, redeemLinkCode, sendOnChannel, touchChannel } from '../../_lib/messaging-adapters';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_MESSAGE_LENGTH = 4096;
const LINK_INSTRUCTIONS =
  "👋 I'm Sophia from WisdomWorks. To start, link this chat to your WisdomWorks account:\n\n" +
  "1. Open WhatsApp and message me there: \"give me a telegram link code\"\n" +
  "2. Reply here with: /link CODE\n\n" +
  "Once linked, you can manage your business from this chat too.";

function sanitize(text: string): string {
  return text.replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g, '').slice(0, MAX_MESSAGE_LENGTH);
}

function verifySecret(request: Request): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected) return true; // dev mode
  const got = request.headers.get('x-telegram-bot-api-secret-token');
  return got === expected;
}

export async function POST(request: Request) {
  try {
    if (!verifySecret(request)) {
      console.warn('[telegram-webhook] invalid secret');
      return new Response('Unauthorized', { status: 401 });
    }

    const update = await request.json();
    const message = update.message ?? update.edited_message;
    if (!message?.text) {
      return NextResponse.json({ ok: true });
    }

    const chatId = String(message.chat?.id ?? '');
    if (!chatId) return NextResponse.json({ ok: true });

    const text = sanitize(message.text);
    const fromName = sanitize(
      message.from?.first_name
        ? `${message.from.first_name}${message.from.last_name ? ' ' + message.from.last_name : ''}`
        : message.chat?.title ?? 'Telegram User',
    );
    const display = message.from?.username ? `@${message.from.username}` : fromName;

    console.log(`[telegram] from ${display} (chat ${chatId}): ${text.slice(0, 100)}`);

    // ─── /link handling — bind this chat to a tenant ──────────────────
    if (text.startsWith('/link') || text.startsWith('/start')) {
      const match = text.match(/^\/(?:link|start)\s+([A-Z0-9]{6,12})\s*$/i);
      if (!match) {
        await sendOnChannel('telegram', chatId, LINK_INSTRUCTIONS);
        return NextResponse.json({ ok: true });
      }
      const code = match[1]!.toUpperCase();
      const tenant = await redeemLinkCode(code, 'telegram', chatId, display);
      if (!tenant) {
        await sendOnChannel(
          'telegram',
          chatId,
          "That code is invalid or expired. Codes last 15 minutes — ask me for a fresh one on WhatsApp.",
        );
        return NextResponse.json({ ok: true });
      }
      await sendOnChannel(
        'telegram',
        chatId,
        `✅ Linked! This Telegram chat is now connected. You can manage your business here just like on WhatsApp.`,
      );
      return NextResponse.json({ ok: true });
    }

    // ─── Tenant lookup ────────────────────────────────────────────────
    const mapping = await resolveTenantForChannel('telegram', chatId);
    if (!mapping) {
      await sendOnChannel('telegram', chatId, LINK_INSTRUCTIONS);
      return NextResponse.json({ ok: true });
    }

    void touchChannel('telegram', chatId);

    // ─── Run through the same iris-brain pipeline ─────────────────────
    // loadUserContext is keyed by phone_number — we feed the tenant's
    // canonical phone so the brain reads/writes the same whatsapp_contexts
    // row regardless of which surface the message came in on.
    const user = await loadUserContext(mapping.tenantPhone, mapping.displayName ?? display);

    // Fire-and-forget atom extraction (same as WhatsApp webhook)
    (async () => {
      try {
        const { extractAtomsFromMessage } = await import('../../_lib/knowledge-atoms');
        const recentHistory = user.conversationHistory?.slice(-6)
          ?.map((m: any) => `${m.role ?? 'user'}: ${(m.content ?? '').slice(0, 200)}`)
          .join('\n');
        await extractAtomsFromMessage({
          tenantPhone: mapping.tenantPhone.replace(/[\s\-+()]/g, ''),
          messageText: text,
          messageId: `tg-${message.message_id}`,
          conversationContext: recentHistory,
        });
      } catch (err) {
        console.warn('[telegram] atom extraction failed (non-blocking):', err);
      }
    })();

    const reply = await generateIrisReply(text, user, 'telegram');
    await sendOnChannel('telegram', chatId, reply);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[telegram-webhook] error:', err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

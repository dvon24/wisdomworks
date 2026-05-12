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
import { claimMessage } from '../../_lib/message-idempotency';
import { downloadWhatsAppMedia } from '../../_lib/whatsapp-media';
import { uploadClientPhoto } from '../../_lib/photo-storage';
import { analyzePhoto, saveClientPhoto } from '../../_lib/photo-analysis';

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

async function sendWhatsAppReply(to: string, body: string): Promise<boolean> {
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneId || !accessToken) return false;
  try {
    const res = await fetch(`${GRAPH_API}/${phoneId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: body.slice(0, 4090) },
      }),
    });
    if (!res.ok) {
      console.error('[whatsapp] sendWhatsAppReply failed:', await res.json());
      return false;
    }
    return true;
  } catch (err) {
    console.error('[whatsapp] sendWhatsAppReply exception:', err);
    return false;
  }
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
    const messageType = message.type ?? (message.text ? 'text' : 'unknown');
    const text = sanitizeInput(message.text?.body ?? message.image?.caption ?? '');
    const name = sanitizeName(contact?.profile?.name ?? 'Customer');
    const imageId = message.image?.id;

    if (!text && !imageId) {
      return NextResponse.json({ status: 'ok' });
    }

    // Idempotency claim — Meta retries the webhook if we don't return 200
    // within ~20s, and tool-heavy replies can take 30-60s. If this message
    // ID has been seen, bail with 200 so Meta stops retrying. Without this
    // guard, the brain re-runs the same prompt and fires tools N times.
    const claimed = await claimMessage(message.id, 'whatsapp', from);
    if (!claimed) {
      console.log(`[whatsapp] Duplicate delivery (${message.id}), already processing — bailing`);
      return NextResponse.json({ status: 'ok', deduplicated: true });
    }

    console.log(`[whatsapp] ${messageType} from ${name} (${from}): ${text.slice(0, 100) || `[image:${imageId}]`}`);

    // ─── Image message path (Story 2b.1 Phase 2) ──────────────────────────
    // Owner sends a photo: download → upload to Storage → vision analysis →
    // save to client_photos → reply with the analysis brief. We do this in
    // parallel with loading user context so the iris-brain reply can
    // reference the analysis as soon as it lands.
    if (imageId) {
      const user = await loadUserContext(from, name);
      const verticalLabel = (user.profile as any)?.vertical_template?.label ?? null;
      const photoCaption = sanitizeInput(message.image?.caption ?? '');

      try {
        const media = await downloadWhatsAppMedia(imageId);
        if (!media) {
          await sendWhatsAppReply(from, "I couldn't download that photo. Try sending it again.");
          return NextResponse.json({ status: 'ok' });
        }
        const upload = await uploadClientPhoto({
          tenantPhone: from,
          bytes: media.bytes,
          mimeType: media.mimeType,
        });
        if (!upload) {
          await sendWhatsAppReply(from, "I downloaded that photo but couldn't store it. The Supabase 'client-photos' bucket may not exist yet.");
          return NextResponse.json({ status: 'ok' });
        }
        const brief = await analyzePhoto({
          imageBytes: media.bytes,
          mimeType: media.mimeType,
          verticalLabel,
          caption: photoCaption || null,
        });
        if (!brief) {
          await sendWhatsAppReply(from, "Photo saved, but I couldn't analyze it right now. I'll try again on the next ask.");
          await saveClientPhoto({
            tenantPhone: from,
            storagePath: upload.path,
            displayUrl: upload.signedUrl,
            brief: { description: '', tags: [], entities: {} },
            sourceMessageId: message.id,
            sourceChannel: 'whatsapp',
            caption: photoCaption || undefined,
          });
          return NextResponse.json({ status: 'ok' });
        }
        await saveClientPhoto({
          tenantPhone: from,
          storagePath: upload.path,
          displayUrl: upload.signedUrl,
          brief,
          sourceMessageId: message.id,
          sourceChannel: 'whatsapp',
          caption: photoCaption || undefined,
        });

        // Compose a short reply summarizing what I saw + extracted entities
        const replyLines: string[] = ['📸 ' + brief.description];
        const entities = brief.entities ?? {};
        if (entities.problem) replyLines.push(`Problem: ${entities.problem}`);
        if (entities.diagnosis) replyLines.push(`Diagnosis: ${entities.diagnosis}`);
        if (entities.solution) replyLines.push(`Solution: ${entities.solution}`);
        if (entities.service) replyLines.push(`Service: ${entities.service}`);
        if (Array.isArray(entities.tools) && entities.tools.length > 0) {
          replyLines.push(`Tools/parts: ${entities.tools.join(', ')}`);
        }
        if (brief.tags.length > 0) replyLines.push(`Tags: ${brief.tags.slice(0, 6).join(', ')}`);
        replyLines.push('');
        replyLines.push("Want me to attach this to a client profile? Just tell me who it's for.");

        await sendWhatsAppReply(from, replyLines.join('\n'));
        return NextResponse.json({ status: 'ok' });
      } catch (err) {
        console.error('[whatsapp] image-handling error:', err);
        await sendWhatsAppReply(from, "I hit an error processing that photo. Try again or send a text message instead.");
        return NextResponse.json({ status: 'ok' });
      }
    }

    // ─── Text message path (existing iris-brain flow) ─────────────────────

    // Load persistent user context (survives Vercel cold starts)
    const user = await loadUserContext(from, name);

    // Phase 1A — fire-and-forget knowledge atom extraction. Don't block
    // the reply on this; just mine durable facts from what the owner said
    // and store them so every agent's next tick benefits.
    const cleanPhoneForAtoms = from.replace(/[\s\-+()]/g, '');
    (async () => {
      try {
        const { extractAtomsFromMessage } = await import('../../_lib/knowledge-atoms');
        const recentHistory = (user as any)?.conversationHistory?.slice(-6)
          ?.map((m: any) => `${m.role ?? 'user'}: ${(m.content ?? '').slice(0, 200)}`)
          .join('\n');
        await extractAtomsFromMessage({
          tenantPhone: cleanPhoneForAtoms,
          messageText: text,
          messageId: message.id,
          conversationContext: recentHistory,
        });
      } catch (err) {
        console.warn('[whatsapp] atom extraction failed (non-blocking):', err);
      }
    })();

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

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
import { uploadStyleReferenceVideo } from '../../_lib/style-video-storage';
import { saveMarketingStyle } from '../../_lib/marketing-styles';

export const dynamic = 'force-dynamic';
// 2026-05-30 incident: heavy owner turns (delegation worker loops ~20-34s +
// PTC container latency + Axis critic) routinely exceeded 60s, so Vercel
// killed the function with a 504 BEFORE any reply was sent or chat_run
// written — the silent-drop the owner experienced. No JS catch runs on a
// platform timeout, so this cap is the actual fix for that path. 300s is
// within the plan ceiling (crons already run at 120s). The proper long-term
// fix is to ACK Meta fast and run the brain async (see incident notes), but
// this restores replies immediately.
export const maxDuration = 300;

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

/**
 * Wraps the universal owner-message helper so every reply Iris (or the
 * image/video handlers above) sends to the owner lands in conversation
 * history. The `source` distinguishes reactive ("iris") from image/video
 * branches — useful when debugging "why did Iris forget she said X".
 */
async function sendWhatsAppReply(
  to: string,
  body: string,
  source: 'iris' | 'webhook-image' | 'webhook-video' = 'iris',
): Promise<boolean> {
  const { sendOwnerMessage } = await import('../../_lib/owner-message');
  const result = await sendOwnerMessage({ tenantPhone: to, body, source });
  return result.ok;
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
  // Hoisted so the outer catch can still reach the sender and surface a
  // failure to the owner instead of returning a silent 500 black hole.
  let senderForErrors: string | undefined;
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
    senderForErrors = from;
    const messageType = message.type ?? (message.text ? 'text' : 'unknown');
    const text = sanitizeInput(message.text?.body ?? message.image?.caption ?? message.video?.caption ?? '');
    const name = sanitizeName(contact?.profile?.name ?? 'Customer');
    const imageId = message.image?.id;
    const videoId = message.video?.id;
    const videoMimeType: string | undefined = message.video?.mime_type;
    const documentId = message.document?.id;
    const documentMimeType: string | undefined = message.document?.mime_type;
    const documentFilename: string | undefined = message.document?.filename;
    const documentCaption: string | undefined = message.document?.caption;

    if (!text && !imageId && !videoId && !documentId) {
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
          await sendWhatsAppReply(from, "I couldn't download that photo. Try sending it again.", 'webhook-image');
          return NextResponse.json({ status: 'ok' });
        }
        const upload = await uploadClientPhoto({
          tenantPhone: from,
          bytes: media.bytes,
          mimeType: media.mimeType,
        });
        if (!upload) {
          await sendWhatsAppReply(from, "I downloaded that photo but couldn't store it. The Supabase 'client-photos' bucket may not exist yet.", 'webhook-image');
          return NextResponse.json({ status: 'ok' });
        }
        const brief = await analyzePhoto({
          imageBytes: media.bytes,
          mimeType: media.mimeType,
          verticalLabel,
          caption: photoCaption || null,
        });
        if (!brief) {
          await sendWhatsAppReply(from, "Photo saved, but I couldn't analyze it right now. I'll try again on the next ask.", 'webhook-image');
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

        // Story 2b.1 Phase 2 (FIX 2026-05-14): don't reply with a canned
        // 📸-prefixed analysis-only message. Synthesize a user message
        // that combines the photo brief + entities + caption, then run
        // iris-brain on it so the reply uses tenant memory (knowledge
        // atoms, dispositions, recent context) to actually REASON about
        // the image — not just describe it.
        //
        // Symptom this fixes: Devon sent a weather forecast for race
        // weekend; old path replied with "📸 Weather forecast showing
        // rain on Saturday..." and stopped. New path: Iris connects
        // weather to known 100k race, gives race-prep advice.
        const entities = brief.entities ?? {};
        const briefLines: string[] = [
          `[Photo received — auto-analysis follows]`,
          `Description: ${brief.description}`,
        ];
        if (entities.problem) briefLines.push(`Problem: ${entities.problem}`);
        if (entities.diagnosis) briefLines.push(`Diagnosis: ${entities.diagnosis}`);
        if (entities.solution) briefLines.push(`Solution: ${entities.solution}`);
        if (entities.service) briefLines.push(`Service: ${entities.service}`);
        if (Array.isArray(entities.tools) && entities.tools.length > 0) {
          briefLines.push(`Tools/parts: ${entities.tools.join(', ')}`);
        }
        if (brief.tags.length > 0) briefLines.push(`Tags: ${brief.tags.slice(0, 6).join(', ')}`);
        briefLines.push(`[end auto-analysis]`);
        const synthesizedMessage = photoCaption
          ? `${photoCaption}\n\n${briefLines.join('\n')}`
          : briefLines.join('\n');

        try {
          const reply = await generateIrisReply(synthesizedMessage, user, 'whatsapp');
          await sendWhatsAppReply(from, reply, 'webhook-image');
        } catch (err) {
          console.error('[whatsapp] image → iris-brain failed:', err);
          // Fall back to the analysis-only summary so the owner gets SOMETHING.
          await sendWhatsAppReply(from, `📸 ${brief.description}`, 'webhook-image');
        }
        return NextResponse.json({ status: 'ok' });
      } catch (err) {
        console.error('[whatsapp] image-handling error:', err);
        await sendWhatsAppReply(from, "I hit an error processing that photo. Try again or send a text message instead.", 'webhook-image');
        return NextResponse.json({ status: 'ok' });
      }
    }

    // ─── Video message path (marketing style references) ─────────────────
    // Owner sends a video — most often as a reference template for marketing
    // reel generation. We download → upload to public bucket → save as a
    // marketing_style row → ask owner to name + describe the look so future
    // generations can match it.
    if (videoId) {
      try {
        const media = await downloadWhatsAppMedia(videoId);
        if (!media) {
          await sendWhatsAppReply(from, "I couldn't download that video. Try sending it again.", 'webhook-video');
          return NextResponse.json({ status: 'ok' });
        }
        // Vercel function body limit / WhatsApp limit defenses: 30MB cap
        if (media.fileSize && media.fileSize > 30 * 1024 * 1024) {
          await sendWhatsAppReply(from, "That video is over 30MB — too big to store as a style reference. Try a shorter clip.", 'webhook-video');
          return NextResponse.json({ status: 'ok' });
        }
        const upload = await uploadStyleReferenceVideo({
          tenantPhone: from,
          bytes: media.bytes,
          mimeType: videoMimeType ?? media.mimeType,
        });
        if (!upload) {
          await sendWhatsAppReply(from, "I downloaded the video but couldn't store it. The Supabase 'marketing-style-refs' bucket may not exist yet (admin needs to create it with public-read access).", 'webhook-video');
          return NextResponse.json({ status: 'ok' });
        }

        // Try to parse a style name from the caption: "save as <name>",
        // "use as template <name>", "<name> style", etc. If none, default
        // to a timestamped placeholder the owner can rename.
        const captionText = sanitizeInput(message.video?.caption ?? '');
        const nameMatch =
          captionText.match(/(?:save (?:this )?as|use as template|template:?)\s+(.+?)(?:\.|$|\s—|\s-)/i) ||
          captionText.match(/^([^,.]+?)\s+style\b/i);
        const styleName = nameMatch
          ? nameMatch[1]!.trim().slice(0, 60)
          : `Style ref ${new Date().toISOString().slice(0, 10)}`;

        // Phase 1 of style reception: we save the row with a placeholder
        // style_prompt the owner fills in via chat. Phase 2 (vision
        // analysis) will populate this automatically.
        const placeholderPrompt = captionText
          ? captionText.slice(0, 1500)
          : 'Style reference video saved. Describe the look (mood, motion, color, lighting) so I can match it in future reels.';

        const saved = await saveMarketingStyle({
          tenantPhone: from,
          name: styleName,
          stylePrompt: placeholderPrompt,
          referenceVideoUrl: upload.publicUrl,
        });
        if (!saved) {
          await sendWhatsAppReply(from, "Stored the video but couldn't save it as a style. Try again or describe the look in text.", 'webhook-video');
          return NextResponse.json({ status: 'ok' });
        }

        const replyLines: string[] = [
          `🎬 Got the video — saved as "${saved.name}".`,
        ];
        if (captionText && nameMatch) {
          replyLines.push(`I'll use this as a template when you ask for reels in this style.`);
        } else {
          replyLines.push(
            `What should I call this style and what's the vibe? Tell me 1-2 lines about mood, motion, color, lighting — that's what I'll match when generating future reels.`,
          );
          replyLines.push(`Example: "Au7o energetic — neon, fast cuts, cinematic dramatic lighting"`);
        }
        await sendWhatsAppReply(from, replyLines.join('\n\n'), 'webhook-video');
        return NextResponse.json({ status: 'ok' });
      } catch (err) {
        console.error('[whatsapp] video-handling error:', err);
        await sendWhatsAppReply(from, "I hit an error processing that video. Try again or describe the style in text.", 'webhook-video');
        return NextResponse.json({ status: 'ok' });
      }
    }

    // ─── Document message path (Story 2.16 Phase 1) ───────────────────────
    // Owner sends a PDF/docx/xlsx via WhatsApp → download → upload to public
    // bucket → run Claude PDF analysis → persist to received_documents →
    // reply with the structured analysis. Non-PDF formats are stored but
    // analysis is currently PDF-only (Phase 3 adds docx/xlsx text extraction).
    if (documentId) {
      try {
        const media = await downloadWhatsAppMedia(documentId);
        if (!media) {
          await sendWhatsAppReply(from, "I couldn't download that document. Try sending it again.", 'webhook-image');
          return NextResponse.json({ status: 'ok' });
        }
        if (media.fileSize && media.fileSize > 30 * 1024 * 1024) {
          await sendWhatsAppReply(from, "That document is over 30MB — too big to analyze. Try a smaller file or send just the relevant pages.", 'webhook-image');
          return NextResponse.json({ status: 'ok' });
        }

        const { uploadReceivedDoc } = await import('../../_lib/received-doc-storage');
        const upload = await uploadReceivedDoc({
          tenantPhone: from,
          bytes: media.bytes,
          mimeType: documentMimeType ?? media.mimeType,
          filename: documentFilename,
        });
        if (!upload) {
          await sendWhatsAppReply(from, "I downloaded the document but couldn't store it. The Supabase 'received-docs' bucket may not exist yet (admin needs to create it with public-read access).", 'webhook-image');
          return NextResponse.json({ status: 'ok' });
        }

        const mime = (documentMimeType ?? media.mimeType ?? '').toLowerCase();

        // Insert the row up-front in 'processing' status so we have a
        // record even if analysis fails
        const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        let docRowId: string | null = null;
        if (supaUrl && supaKey) {
          try {
            const insRes = await fetch(`${supaUrl}/rest/v1/received_documents`, {
              method: 'POST',
              headers: {
                apikey: supaKey,
                Authorization: `Bearer ${supaKey}`,
                'Content-Type': 'application/json',
                Prefer: 'return=representation',
              },
              body: JSON.stringify({
                tenant_phone: from.replace(/[\s\-+()]/g, ''),
                source: 'whatsapp',
                filename: documentFilename ?? null,
                mime_type: documentMimeType ?? media.mimeType,
                size_bytes: media.fileSize ?? media.bytes.length,
                storage_path: upload.path,
                public_url: upload.publicUrl,
                status: 'processing',
                metadata: {
                  source_message_id: message.id,
                  caption: documentCaption ?? null,
                },
              }),
            });
            if (insRes.ok) {
              const rows = await insRes.json();
              docRowId = rows[0]?.id ?? null;
            }
          } catch (err) {
            console.warn('[whatsapp] received_documents insert failed:', err);
          }
        }

        // Unified analyzer dispatches by mime type — PDF / DOCX / XLSX / TXT
        const { analyzeReceivedDocument, renderAnalysisForWhatsApp } = await import('../../_lib/document-analysis');
        const result = await analyzeReceivedDocument({
          bytes: media.bytes,
          mimeType: documentMimeType ?? media.mimeType,
          filename: documentFilename ?? 'document',
        });

        if (!result.ok) {
          if (docRowId && supaUrl && supaKey) {
            await fetch(`${supaUrl}/rest/v1/received_documents?id=eq.${docRowId}`, {
              method: 'PATCH',
              headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
              body: JSON.stringify({
                status: 'analysis_failed',
                summary: result.format === 'unsupported'
                  ? `Stored ${documentFilename ?? 'document'} — I can analyze PDF, DOCX, XLSX, and TXT. ${result.error}`
                  : null,
                metadata: { error: result.error, format: result.format ?? null },
              }),
            });
          }
          const msg = result.format === 'unsupported'
            ? `📎 Got ${documentFilename ?? 'the document'} (${(media.bytes.length / 1024).toFixed(0)}KB) — stored for you, but ${result.error}`
            : `📄 Stored ${documentFilename ?? 'the document'} but couldn't analyze it: ${result.error}. The file is on record — ask me about it later.`;
          await sendWhatsAppReply(from, msg, 'webhook-image');
          return NextResponse.json({ status: 'ok' });
        }

        // Persist analysis
        if (docRowId && supaUrl && supaKey) {
          await fetch(`${supaUrl}/rest/v1/received_documents?id=eq.${docRowId}`, {
            method: 'PATCH',
            headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
            body: JSON.stringify({
              status: 'analyzed',
              summary: result.analysis.summary,
              key_dates: result.analysis.keyDates,
              key_amounts: result.analysis.keyAmounts,
              key_parties: result.analysis.keyParties,
              action_items: result.analysis.actionItems,
              risks: result.analysis.risks,
              tags: result.analysis.tags,
              metadata: { format: result.format },
            }),
          });
        }

        const reply = renderAnalysisForWhatsApp({
          analysis: result.analysis,
          filename: documentFilename,
        });
        await sendWhatsAppReply(from, reply, 'webhook-image');
        return NextResponse.json({ status: 'ok' });
      } catch (err) {
        console.error('[whatsapp] document-handling error:', err);
        await sendWhatsAppReply(from, "I hit an error processing that document. Try again or describe what's in it.", 'webhook-image');
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

    // Generate AI response with full context (shared brain — same path as Command Deck).
    // 2026-05-30 incident fix: generateIrisReply can throw BEFORE its own
    // internal try/catch (connection load, tool-list build, system-prompt
    // build, context build all run first). Such a throw used to fall straight
    // to the outer catch and return a silent HTTP 500 with NO reply — every
    // owner text since 05:20 UTC 5/29 was claimed (idempotency) then dropped
    // exactly this way. Catch it here and surface the error to the owner so a
    // failure is visible (not a black hole) and the real error reaches us.
    let agentResponse: string;
    try {
      agentResponse = await generateIrisReply(text, user, 'whatsapp');
    } catch (brainErr: any) {
      const detail = (brainErr?.message ?? String(brainErr ?? 'unknown')).toString().split('\n')[0].slice(0, 300);
      console.error('[whatsapp-webhook] generateIrisReply threw (surfacing to owner):', brainErr);
      agentResponse = `⚠️ I hit an error and couldn't finish that: ${detail}\n\nIt's logged — try again or rephrase. If this keeps happening, it's a bug to fix.`;
    }

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
    } else {
      console.error('[whatsapp-webhook] Cannot send reply — WHATSAPP_PHONE_ID or WHATSAPP_ACCESS_TOKEN is missing in this environment.');
    }

    return NextResponse.json({ status: 'ok' });
  } catch (error: any) {
    console.error('[whatsapp-webhook] Error:', error);
    // Don't drop the turn into a silent 500. Best-effort: tell the owner
    // something failed so a webhook-level throw is visible, not a black hole.
    // `senderForErrors` is set as soon as we parse the inbound message.
    if (senderForErrors) {
      try {
        const detail = (error?.message ?? String(error ?? 'unknown')).toString().split('\n')[0].slice(0, 200);
        await sendWhatsAppReply(senderForErrors, `⚠️ Something went wrong on my end: ${detail}. It's logged — try again in a moment.`, 'iris');
      } catch (sendErr) {
        console.error('[whatsapp-webhook] fallback error reply also failed:', sendErr);
      }
    }
    return NextResponse.json({ status: 'error' }, { status: 500 });
  }
}

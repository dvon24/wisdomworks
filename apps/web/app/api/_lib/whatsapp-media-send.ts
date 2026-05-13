/**
 * Send media (image/video) to a WhatsApp conversation via Meta Graph API.
 *
 * Used for the video-preview UX: marketing agent generates a video →
 * sends it back to the owner's WhatsApp as a preview → owner taps
 * Publish or Regenerate in chat.
 *
 * WhatsApp constraints:
 *   - Video: MP4 (H.264 + AAC), <16 MB, max 90s
 *   - Image: JPEG/PNG, <5 MB
 *   - URL must be public HTTPS (we don't upload — link mode only)
 */

const GRAPH_API = 'https://graph.facebook.com/v25.0';

export async function sendWhatsAppVideo(input: {
  to: string;
  videoUrl: string;
  caption?: string;
}): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  // Routes through sendOwnerMessage so the video preview also lands in
  // Iris's conversation history — she'll know she already sent the
  // preview when the owner replies "publish it" later.
  const { sendOwnerMessage } = await import('./owner-message');
  return sendOwnerMessage({
    tenantPhone: input.to,
    body: input.caption ?? 'Video preview',
    source: 'iris',
    media: { type: 'video', url: input.videoUrl },
  });
}

/**
 * Send a generated document (docx/pptx/xlsx/pdf) into the owner's WhatsApp
 * as a file attachment. WhatsApp's document type takes a public HTTPS URL
 * — caller is responsible for hosting the file (typically Supabase Storage
 * in a public bucket).
 *
 * Used as the fallback delivery when no Drive/OneDrive is connected so
 * the owner still gets their generated doc.
 */
export async function sendWhatsAppDocument(input: {
  to: string;
  documentUrl: string;
  filename: string;
  caption?: string;
}): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneId || !accessToken) return { ok: false, error: 'WhatsApp not configured' };
  if (!input.documentUrl.startsWith('https://')) return { ok: false, error: 'documentUrl must be HTTPS' };

  const cleanTo = input.to.replace(/[\s\-+()]/g, '');
  try {
    const res = await fetch(`${GRAPH_API}/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: cleanTo,
        type: 'document',
        document: {
          link: input.documentUrl,
          filename: input.filename.slice(0, 240),
          ...(input.caption ? { caption: input.caption.slice(0, 1024) } : {}),
        },
      }),
    });
    if (!res.ok) {
      const errBody = await res.text();
      console.warn('[whatsapp-media] document send failed:', res.status, errBody);
      return { ok: false, error: errBody };
    }
    const data = await res.json();
    return { ok: true, messageId: data.messages?.[0]?.id };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

export async function sendWhatsAppImage(input: {
  to: string;
  imageUrl: string;
  caption?: string;
}): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const { sendOwnerMessage } = await import('./owner-message');
  return sendOwnerMessage({
    tenantPhone: input.to,
    body: input.caption ?? 'Image',
    source: 'iris',
    media: { type: 'image', url: input.imageUrl },
  });
}

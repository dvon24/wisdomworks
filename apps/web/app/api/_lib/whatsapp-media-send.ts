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
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneId || !accessToken) return { ok: false, error: 'WhatsApp not configured' };

  const cleanTo = input.to.replace(/[\s\-+()]/g, '');
  try {
    const res = await fetch(`${GRAPH_API}/${phoneId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: cleanTo,
        type: 'video',
        video: {
          link: input.videoUrl,
          ...(input.caption ? { caption: input.caption.slice(0, 1024) } : {}),
        },
      }),
    });
    if (!res.ok) {
      const errBody = await res.text();
      console.warn('[whatsapp-media] video send failed:', res.status, errBody);
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
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneId || !accessToken) return { ok: false, error: 'WhatsApp not configured' };

  const cleanTo = input.to.replace(/[\s\-+()]/g, '');
  try {
    const res = await fetch(`${GRAPH_API}/${phoneId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: cleanTo,
        type: 'image',
        image: {
          link: input.imageUrl,
          ...(input.caption ? { caption: input.caption.slice(0, 1024) } : {}),
        },
      }),
    });
    if (!res.ok) {
      const errBody = await res.text();
      console.warn('[whatsapp-media] image send failed:', res.status, errBody);
      return { ok: false, error: errBody };
    }
    const data = await res.json();
    return { ok: true, messageId: data.messages?.[0]?.id };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

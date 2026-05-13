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

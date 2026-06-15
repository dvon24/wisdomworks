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
  if (!input.documentUrl.startsWith('https://')) return { ok: false, error: 'documentUrl must be HTTPS' };
  // Route through sendOwnerMessage like the video/image siblings so the
  // generated-doc attachment also lands in Iris's conversation history — she
  // forgot her own document sends before this (the "Iris re-sends what she
  // already sent" bug class, since this used to POST Graph API directly).
  const { sendOwnerMessage } = await import('./owner-message');
  return sendOwnerMessage({
    tenantPhone: input.to,
    body: input.caption ?? input.filename,
    source: 'iris',
    media: { type: 'document', url: input.documentUrl, filename: input.filename },
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

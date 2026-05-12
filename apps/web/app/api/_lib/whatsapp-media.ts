/**
 * WhatsApp media download — fetches inbound images/audio/docs from Meta's
 * Cloud API. Inbound messages carry a media_id; the actual content lives
 * behind an authenticated URL we have to resolve in two steps.
 *
 * Flow:
 *   1. GET /v25.0/{media_id} → { url, mime_type, sha256, file_size }
 *   2. GET <url> with the same Bearer token → raw bytes
 *
 * The download URL is short-lived (~5 minutes); resolve and download in
 * the same request.
 */

const GRAPH_API = 'https://graph.facebook.com/v25.0';

export interface DownloadedMedia {
  bytes: Uint8Array;
  mimeType: string;
  sha256?: string;
  fileSize?: number;
}

export async function downloadWhatsAppMedia(mediaId: string): Promise<DownloadedMedia | null> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token) {
    console.warn('[whatsapp-media] WHATSAPP_ACCESS_TOKEN not set');
    return null;
  }

  try {
    // Step 1: resolve the download URL
    const metaRes = await fetch(`${GRAPH_API}/${mediaId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!metaRes.ok) {
      console.warn(`[whatsapp-media] meta fetch failed: ${metaRes.status}`);
      return null;
    }
    const meta = await metaRes.json();
    if (!meta.url) return null;

    // Step 2: download bytes (auth still required on this CDN URL)
    const fileRes = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!fileRes.ok) {
      console.warn(`[whatsapp-media] download failed: ${fileRes.status}`);
      return null;
    }
    const buf = await fileRes.arrayBuffer();
    return {
      bytes: new Uint8Array(buf),
      mimeType: meta.mime_type ?? 'application/octet-stream',
      sha256: meta.sha256,
      fileSize: meta.file_size,
    };
  } catch (err) {
    console.warn('[whatsapp-media] exception:', err);
    return null;
  }
}

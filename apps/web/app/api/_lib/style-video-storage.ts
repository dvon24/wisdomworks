/**
 * Marketing style reference video storage.
 *
 * Owner sends a video on WhatsApp → we download it via the Graph API
 * → upload to a public Supabase bucket so the URL is shareable (the
 * downstream Replicate models or vision-analysis jobs need a public
 * HTTPS URL to pull from).
 *
 * Bucket: `marketing-style-refs` — must be created in Supabase
 * Dashboard once, with public-read enabled.
 *
 * Path layout: `{tenant_phone}/{yyyy}/{mm}/{uuid}.{ext}` — tenant-isolated.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'marketing-style-refs';

function extFromMime(mime: string): string {
  if (mime.includes('mp4')) return 'mp4';
  if (mime.includes('quicktime')) return 'mov';
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('3gpp')) return '3gp';
  return 'mp4';
}

export interface StyleVideoUploadResult {
  path: string;
  publicUrl: string;
}

export async function uploadStyleReferenceVideo(input: {
  tenantPhone: string;
  bytes: Uint8Array;
  mimeType: string;
}): Promise<StyleVideoUploadResult | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const cleanPhone = input.tenantPhone.replace(/[\s\-+()]/g, '');
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const uuid = crypto.randomUUID();
  const ext = extFromMime(input.mimeType);
  const path = `${cleanPhone}/${yyyy}/${mm}/${uuid}.${ext}`;

  try {
    const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': input.mimeType,
        'x-upsert': 'false',
      },
      body: new Blob([input.bytes.buffer as ArrayBuffer], { type: input.mimeType }),
    });
    if (!uploadRes.ok) {
      console.warn('[style-video] upload failed:', uploadRes.status, await uploadRes.text());
      return null;
    }
    // Public bucket — direct URL works without signing
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
    return { path, publicUrl };
  } catch (err) {
    console.warn('[style-video] upload exception:', err);
    return null;
  }
}

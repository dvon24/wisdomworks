/**
 * Photo storage — uploads inbound client photos to Supabase Storage and
 * returns the path + signed URL for display.
 *
 * Bucket: `client-photos` (must be created in Supabase Dashboard once).
 * Path layout: `{tenant_phone}/{yyyy}/{mm}/{uuid}.{ext}` — tenant-isolated.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'client-photos';

function extFromMime(mime: string): string {
  if (mime.includes('jpeg')) return 'jpg';
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('heic')) return 'heic';
  return 'bin';
}

export interface UploadResult {
  path: string;
  signedUrl: string | null;
}

export async function uploadClientPhoto(input: {
  tenantPhone: string;
  bytes: Uint8Array;
  mimeType: string;
}): Promise<UploadResult | null> {
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
      // Wrap in a Blob so fetch accepts it as BodyInit. The underlying
      // bytes are not copied — Blob holds a reference.
      body: new Blob([input.bytes.buffer as ArrayBuffer], { type: input.mimeType }),
    });
    if (!uploadRes.ok) {
      console.warn('[photo-storage] upload failed:', uploadRes.status, await uploadRes.text());
      return null;
    }

    // Sign a 30-day URL for display in the deck
    const signRes = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${path}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expiresIn: 30 * 24 * 3600 }),
    });
    let signedUrl: string | null = null;
    if (signRes.ok) {
      const signed = await signRes.json();
      if (signed.signedURL) {
        signedUrl = `${SUPABASE_URL}/storage/v1${signed.signedURL}`;
      }
    }

    return { path, signedUrl };
  } catch (err) {
    console.warn('[photo-storage] upload exception:', err);
    return null;
  }
}

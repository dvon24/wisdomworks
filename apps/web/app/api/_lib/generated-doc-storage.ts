/**
 * Story 2.12 — Storage for generated documents (Word / PowerPoint /
 * Excel / PDF) when the owner has no Drive/OneDrive connection.
 *
 * Uploads to a public Supabase bucket so WhatsApp's document message
 * type can reach it via HTTPS link.
 *
 * Bucket: `generated-docs` — must be created in Supabase Dashboard once,
 * with public-read enabled.
 *
 * Path layout: `{tenant_phone}/{yyyy}/{mm}/{uuid}.{ext}` — tenant-isolated.
 *
 * Auto-cleanup: documents older than 30 days are pruned by a daily cron
 * (not yet wired — TODO when storage costs matter; small until then).
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'generated-docs';

export interface GeneratedDocUploadResult {
  path: string;
  publicUrl: string;
}

export async function uploadGeneratedDoc(input: {
  tenantPhone: string;
  buffer: Buffer;
  filename: string; // includes extension
  mimeType: string;
}): Promise<GeneratedDocUploadResult | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const cleanPhone = input.tenantPhone.replace(/[\s\-+()]/g, '');
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const uuid = crypto.randomUUID();
  // Preserve extension from filename so WhatsApp's filename param matches
  const ext = input.filename.includes('.') ? input.filename.split('.').pop() : 'bin';
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
      body: new Blob([input.buffer.buffer as ArrayBuffer], { type: input.mimeType }),
    });
    if (!uploadRes.ok) {
      const body = await uploadRes.text().catch(() => '<no body>');
      // 404 on POST means the bucket doesn't exist — surface that clearly
      // so the owner knows to create it in Supabase Dashboard. This is
      // a ONE-TIME platform-owner setup step, not a per-customer thing.
      if (uploadRes.status === 404 || body.includes('Bucket not found')) {
        console.error(
          `[generated-doc-storage] Bucket "${BUCKET}" does not exist. ` +
          `Create it in Supabase Dashboard → Storage → New bucket with public-read enabled. ` +
          `Without this bucket, create_document → send_email attachment chain breaks. ` +
          `Response: ${body.slice(0, 200)}`,
        );
      } else {
        console.warn('[generated-doc-storage] upload failed:', uploadRes.status, body.slice(0, 300));
      }
      return null;
    }
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
    return { path, publicUrl };
  } catch (err) {
    console.warn('[generated-doc-storage] upload exception:', err);
    return null;
  }
}

/**
 * Story 2.16 — Storage for documents the owner SENDS to Iris.
 *
 * Owner sends a PDF/docx via WhatsApp → we download bytes → upload to a
 * public Supabase bucket so the document analyzer (Claude PDF input)
 * and any future tools can fetch it via HTTPS.
 *
 * Bucket: `received-docs` — must be created in Supabase Dashboard once
 * with public-read enabled.
 *
 * Path layout: `{tenant_phone}/{yyyy}/{mm}/{uuid}.{ext}` — tenant-isolated.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'received-docs';

function extFromMime(mime: string, filename?: string): string {
  // Trust the filename extension if present — preserves edge formats
  if (filename) {
    const fromName = filename.split('.').pop();
    if (fromName && /^[a-z0-9]{1,5}$/i.test(fromName)) return fromName.toLowerCase();
  }
  if (mime.includes('pdf')) return 'pdf';
  if (mime.includes('wordprocessingml')) return 'docx';
  if (mime.includes('spreadsheetml')) return 'xlsx';
  if (mime.includes('presentationml')) return 'pptx';
  if (mime.includes('plain')) return 'txt';
  if (mime.includes('html')) return 'html';
  return 'bin';
}

export interface ReceivedDocUploadResult {
  path: string;
  publicUrl: string;
}

export async function uploadReceivedDoc(input: {
  tenantPhone: string;
  bytes: Uint8Array;
  mimeType: string;
  filename?: string;
}): Promise<ReceivedDocUploadResult | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const cleanPhone = input.tenantPhone.replace(/[\s\-+()]/g, '');
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const uuid = crypto.randomUUID();
  const ext = extFromMime(input.mimeType, input.filename);
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
      console.warn('[received-doc-storage] upload failed:', uploadRes.status, await uploadRes.text());
      return null;
    }
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
    return { path, publicUrl };
  } catch (err) {
    console.warn('[received-doc-storage] upload exception:', err);
    return null;
  }
}

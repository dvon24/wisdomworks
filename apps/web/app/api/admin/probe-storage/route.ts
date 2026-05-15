/**
 * GET /api/admin/probe-storage
 *   Bearer OWNER_API_TOKEN
 *
 * Diagnostic probe for the create_document → send_email attachment chain.
 *
 * Walks the chain step-by-step and reports which step fails (if any):
 *   1. Upload a 1-byte test file via uploadGeneratedDoc()
 *   2. Fetch the returned publicUrl as an anonymous client (the way
 *      send_email's attachment-fetch does it)
 *   3. Verify the response Content-Type + body length
 *   4. Delete the test file
 *
 * Use this when emailing a generated doc is failing and you want a
 * definitive answer about which side is broken (upload? public access?
 * fetch?) instead of guessing.
 */

import { uploadGeneratedDoc } from '../../_lib/generated-doc-storage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function GET(request: Request) {
  const auth = request.headers.get('authorization');
  const ownerToken = process.env.OWNER_API_TOKEN;
  if (!ownerToken || !auth?.startsWith('Bearer ') || auth.slice(7) !== ownerToken) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return Response.json({ error: 'supabase not configured' }, { status: 500 });
  }

  const steps: Array<{ step: string; ok: boolean; detail: string }> = [];
  const testPhone = 'probe';
  const testContent = Buffer.from(`probe ${new Date().toISOString()}`, 'utf8');
  let publicUrl: string | null = null;
  let storagePath: string | null = null;

  // Step 1: upload
  try {
    const result = await uploadGeneratedDoc({
      tenantPhone: testPhone,
      buffer: testContent,
      filename: 'probe.txt',
      mimeType: 'text/plain',
    });
    if (!result) {
      steps.push({
        step: 'upload',
        ok: false,
        detail:
          'uploadGeneratedDoc returned null — check Vercel logs for the actual error from [generated-doc-storage]. Most common causes: bucket missing, RLS policy on storage.objects blocking inserts, wrong service role key.',
      });
      return Response.json({ ok: false, steps }, { status: 200 });
    }
    publicUrl = result.publicUrl;
    storagePath = result.path;
    steps.push({ step: 'upload', ok: true, detail: `${result.publicUrl} (${testContent.length} bytes)` });
  } catch (err: any) {
    steps.push({ step: 'upload', ok: false, detail: `exception: ${err?.message ?? String(err)}` });
    return Response.json({ ok: false, steps }, { status: 200 });
  }

  // Step 2: anonymous fetch (this is what send_email does — no auth header).
  try {
    const fetchRes = await fetch(publicUrl);
    if (!fetchRes.ok) {
      const body = await fetchRes.text().catch(() => '<no body>');
      steps.push({
        step: 'public-fetch',
        ok: false,
        detail:
          `HTTP ${fetchRes.status} ${fetchRes.statusText}. Response: ${body.slice(0, 300)}. ` +
          `If 400 "Bucket not public" — flip the public toggle in Supabase Dashboard. ` +
          `If 401/403 — bucket is private OR an RLS policy on storage.objects blocks anon SELECT.`,
      });
    } else {
      const text = await fetchRes.text();
      const ct = fetchRes.headers.get('content-type') ?? 'unknown';
      if (text.length !== testContent.length) {
        steps.push({
          step: 'public-fetch',
          ok: false,
          detail: `body length mismatch — expected ${testContent.length} got ${text.length}. CT: ${ct}.`,
        });
      } else {
        steps.push({
          step: 'public-fetch',
          ok: true,
          detail: `${text.length} bytes, Content-Type: ${ct}`,
        });
      }
    }
  } catch (err: any) {
    steps.push({ step: 'public-fetch', ok: false, detail: `exception: ${err?.message ?? String(err)}` });
  }

  // Step 3: cleanup
  try {
    const delRes = await fetch(`${SUPABASE_URL}/storage/v1/object/generated-docs/${storagePath}`, {
      method: 'DELETE',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    });
    steps.push({ step: 'cleanup', ok: delRes.ok, detail: `HTTP ${delRes.status}` });
  } catch (err: any) {
    steps.push({ step: 'cleanup', ok: false, detail: `exception: ${err?.message ?? String(err)}` });
  }

  const allOk = steps.every((s) => s.ok);
  return Response.json({
    ok: allOk,
    summary: allOk
      ? 'Storage chain is healthy. If emails are still failing, the issue is downstream (send_email itself, or Iris using a non-public URL).'
      : 'Storage chain has a problem — see the failing step.',
    steps,
  });
}

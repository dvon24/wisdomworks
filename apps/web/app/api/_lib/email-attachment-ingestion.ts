/**
 * Story 2.16 Phase 2b — Email attachment fetch + analyze (capability only).
 *
 * Devon's rule (feedback_attachment_consent.md):
 * "I don't want it to create a lot of attachments for me to approve or
 * disapprove, it should have the ability to retrieve and this should
 * be based on the learning of what emails I open and close."
 *
 * Iris gets the CAPABILITY to fetch + analyze email attachments when
 * the owner explicitly asks. No background indexing, no pending queue,
 * no approval cards. The single entry point is analyzeEmailAttachment
 * — Iris calls it with an email id and (optionally) a filename, the
 * function fetches the bytes via the appropriate provider, uploads to
 * received-docs, runs Claude PDF analysis, persists, and returns.
 *
 * If the email has multiple attachments and no filename is given,
 * returns the list so Iris can show options to the owner.
 */

import type { EmailMessage, OAuthConnection, EmailAttachmentRef } from '@wisdomworks/shared';
import { fetchEmailAttachment, listEmailAttachments } from '@wisdomworks/shared';
import { fetchImapAttachment } from './imap-runtime';
import { uploadReceivedDoc } from './received-doc-storage';
import { analyzePdfDocument, type DocumentAnalysis } from './document-analysis';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MAX_BYTES = 10 * 1024 * 1024; // 10MB cap on any single attachment

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

export interface AnalyzeAttachmentResult {
  ok: boolean;
  // When the email has >1 attachment and no filename hint, we return
  // the choices so the caller can re-ask the owner which one to pull.
  choices?: EmailAttachmentRef[];
  receivedDocumentId?: string;
  filename?: string;
  mimeType?: string;
  isPdf?: boolean;
  analysis?: DocumentAnalysis;
  error?: string;
}

/**
 * Owner explicitly asked Iris to look at an email attachment. The agent
 * tool calls this with an email_id (from a recent list_unread_emails or
 * search_emails call) and optionally a filename hint.
 *
 * Resolution rules:
 *   - 0 attachments → error
 *   - 1 attachment → analyze it
 *   - N attachments + filename hint that matches exactly → analyze it
 *   - N attachments + filename hint that partial-matches one → analyze it
 *   - N attachments + ambiguous → return choices for the caller to disambiguate
 */
export async function analyzeEmailAttachment(input: {
  conn: OAuthConnection & { phone_number: string };
  emailId: string;
  filenameHint?: string;
}): Promise<AnalyzeAttachmentResult> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { ok: false, error: 'supabase not configured' };

  // Get the attachment list. IMAP path: we don't have it cached so we
  // have to re-fetch the message anyway (the fetchImapAttachment helper
  // does that on byte fetch — but we still need to know what's there
  // first). For now require the caller to pass filenameHint when using
  // IMAP, OR we walk via a list helper we should add. Practical for
  // MVP: for IMAP we proceed assuming filenameHint is provided (Iris's
  // prompt instructions will say so).
  let refs: EmailAttachmentRef[] = [];
  if (input.conn.provider === 'google' || input.conn.provider === 'microsoft') {
    const listed = await listEmailAttachments(input.conn, input.emailId);
    if (!listed.success || !listed.data) {
      return { ok: false, error: `Couldn't list attachments: ${listed.error ?? 'unknown'}` };
    }
    refs = listed.data;
  } else if (input.conn.provider === 'yahoo' || input.conn.provider === 'imap') {
    // IMAP: if filenameHint was given, fetch directly. If not, we can't
    // list without parsing the message — caller should provide the hint.
    if (!input.filenameHint) {
      return { ok: false, error: 'For Yahoo/IMAP emails, pass a filename hint (Iris should look at the email body summary for the attachment filename)' };
    }
    refs = [{ id: input.filenameHint, filename: input.filenameHint, mimeType: 'application/octet-stream' }];
  } else {
    return { ok: false, error: `Provider ${input.conn.provider} doesn't support attachment fetch yet` };
  }

  if (refs.length === 0) {
    return { ok: false, error: 'No attachments on that email' };
  }

  // Resolve which attachment to pull
  let chosen: EmailAttachmentRef | null = null;
  if (refs.length === 1) {
    chosen = refs[0]!;
  } else if (input.filenameHint) {
    const hint = input.filenameHint.toLowerCase();
    chosen = refs.find((r) => r.filename.toLowerCase() === hint)
      ?? refs.find((r) => r.filename.toLowerCase().includes(hint))
      ?? null;
    if (!chosen) {
      return {
        ok: false,
        choices: refs,
        error: `Filename hint "${input.filenameHint}" didn't match. Pick one of the attachments shown.`,
      };
    }
  } else {
    return {
      ok: false,
      choices: refs,
      error: 'Multiple attachments on that email — pick one.',
    };
  }

  // Size guard
  if (chosen.sizeBytes && chosen.sizeBytes > MAX_BYTES) {
    return { ok: false, error: `Attachment is ${(chosen.sizeBytes / 1024 / 1024).toFixed(1)}MB — over the 10MB analysis cap.` };
  }

  // Fetch bytes
  const fetched = await fetchAttachmentForProvider({
    conn: input.conn,
    messageId: input.emailId,
    ref: chosen,
  });
  if (!fetched.success || !fetched.data) {
    return { ok: false, error: `Fetch failed: ${fetched.error}` };
  }

  // Override filename/mime from the ref (Gmail's attachment endpoint
  // doesn't return them in the response body)
  const filename = chosen.filename || fetched.data.filename;
  const mimeType = chosen.mimeType || fetched.data.mimeType;
  const cleanPhone = input.conn.phone_number.replace(/[\s\-+()]/g, '');

  // Upload to storage so the analyzer (or later recall) has a public URL
  const upload = await uploadReceivedDoc({
    tenantPhone: cleanPhone,
    bytes: fetched.data.bytes,
    mimeType,
    filename,
  });
  if (!upload) return { ok: false, error: 'Storage upload failed — admin needs to create the received-docs Supabase bucket.' };

  const sourceLabel: 'gmail_attachment' | 'outlook_attachment' | 'yahoo_attachment' =
    input.conn.provider === 'google' ? 'gmail_attachment'
    : input.conn.provider === 'microsoft' ? 'outlook_attachment'
    : 'yahoo_attachment';
  const isPdf = mimeType.toLowerCase().includes('pdf') || filename.toLowerCase().endsWith('.pdf');

  // Insert received_documents row
  const insertBody: Record<string, unknown> = {
    tenant_phone: cleanPhone,
    source: sourceLabel,
    filename,
    mime_type: mimeType,
    size_bytes: fetched.data.sizeBytes,
    storage_path: upload.path,
    public_url: upload.publicUrl,
    status: isPdf ? 'processing' : 'analysis_failed',
    metadata: { source_email_id: input.emailId },
  };
  if (!isPdf) {
    insertBody.summary = `Stored ${filename}. Analysis for ${mimeType} is coming in a future update (docx/xlsx parsing). PDFs are analyzed today.`;
  }
  const insRes = await fetch(`${SUPABASE_URL}/rest/v1/received_documents`, {
    method: 'POST',
    headers: { ...headers(), Prefer: 'return=representation' },
    body: JSON.stringify(insertBody),
  });
  if (!insRes.ok) return { ok: false, error: `received_documents insert failed: ${insRes.status}` };
  const docRowId = (await insRes.json())[0]?.id;

  if (!isPdf) {
    return { ok: true, receivedDocumentId: docRowId, filename, mimeType, isPdf: false };
  }

  // Run Claude PDF analysis
  const pdfBase64 = Buffer.from(fetched.data.bytes).toString('base64');
  const analysis = await analyzePdfDocument({ pdfBase64, hintFilename: filename });

  if (!analysis.ok) {
    await fetch(`${SUPABASE_URL}/rest/v1/received_documents?id=eq.${docRowId}`, {
      method: 'PATCH',
      headers: { ...headers(), Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'analysis_failed', metadata: { error: analysis.error } }),
    });
    return { ok: false, error: analysis.error, receivedDocumentId: docRowId, filename, mimeType, isPdf: true };
  }

  await fetch(`${SUPABASE_URL}/rest/v1/received_documents?id=eq.${docRowId}`, {
    method: 'PATCH',
    headers: { ...headers(), Prefer: 'return=minimal' },
    body: JSON.stringify({
      status: 'analyzed',
      summary: analysis.analysis.summary,
      key_dates: analysis.analysis.keyDates,
      key_amounts: analysis.analysis.keyAmounts,
      key_parties: analysis.analysis.keyParties,
      action_items: analysis.analysis.actionItems,
      risks: analysis.analysis.risks,
      tags: analysis.analysis.tags,
    }),
  });
  return {
    ok: true,
    receivedDocumentId: docRowId,
    filename,
    mimeType,
    isPdf: true,
    analysis: analysis.analysis,
  };
}

/** Provider-routed attachment fetch (internal). */
async function fetchAttachmentForProvider(input: {
  conn: OAuthConnection & { phone_number: string };
  messageId: string;
  ref: EmailAttachmentRef;
}): Promise<{ success: boolean; data?: { filename: string; mimeType: string; bytes: Uint8Array; sizeBytes: number }; error?: string }> {
  if (input.conn.provider === 'google' || input.conn.provider === 'microsoft') {
    return fetchEmailAttachment(input.conn, input.messageId, input.ref.id);
  }
  if (input.conn.provider === 'yahoo' || input.conn.provider === 'imap') {
    return fetchImapAttachment(input.conn as any, input.messageId, input.ref.filename);
  }
  return { success: false, error: `Provider ${input.conn.provider} not supported` };
}

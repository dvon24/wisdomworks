/**
 * Story 2.16 Phase 2b — Email attachment ingestion.
 *
 * After the email-sift cron classifies an email batch, this module
 * picks up the business-class messages with PDF attachments, fetches
 * the bytes via the provider router (Gmail/Outlook) or the local IMAP
 * runtime (Yahoo / generic IMAP), uploads to the received-docs Supabase
 * bucket, runs Claude PDF analysis, and persists to received_documents.
 *
 * Non-PDF attachments are recorded as 'analysis_failed' with a
 * "format not yet supported" summary (Phase 3 adds docx/xlsx parsing).
 *
 * Privacy: caller must pass only business-class emails. Personal /
 * uncertain attachments are NEVER ingested (privacy boundary).
 *
 * Per-call budget: max 5 attachments per email + max 10MB per file to
 * keep one cron run bounded.
 */

import type { EmailMessage, OAuthConnection } from '@wisdomworks/shared';
import { fetchEmailAttachment, listEmailAttachments } from '@wisdomworks/shared';
import { fetchImapAttachment } from './imap-runtime';
import { uploadReceivedDoc } from './received-doc-storage';
import { analyzePdfDocument } from './document-analysis';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

const MAX_ATTACHMENTS_PER_EMAIL = 5;
const MAX_BYTES_PER_ATTACHMENT = 10 * 1024 * 1024; // 10MB

interface BusinessEmailSummaryLite {
  id: string;
  subject: string;
  from: string;
}

export interface IngestionResult {
  considered: number;
  uploaded: number;
  analyzed: number;
  skipped: number;
  errors: string[];
}

/**
 * Walk business-class emails with attachments, fetch + analyze PDFs.
 * `originalEmails` is the EmailMessage[] returned by the provider; it
 * carries the attachments[] metadata. `businessIds` is the set of
 * email ids that survived the privacy filter.
 */
export async function ingestEmailAttachments(input: {
  conn: OAuthConnection & { phone_number: string };
  originalEmails: EmailMessage[];
  businessIds: Set<string>;
  businessSummaries?: BusinessEmailSummaryLite[];
}): Promise<IngestionResult> {
  const result: IngestionResult = { considered: 0, uploaded: 0, analyzed: 0, skipped: 0, errors: [] };
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    result.errors.push('supabase not configured');
    return result;
  }

  // Map id → summary for the source-message-id metadata
  const summaryById = new Map<string, BusinessEmailSummaryLite>();
  for (const s of input.businessSummaries ?? []) summaryById.set(s.id, s);

  const targets = input.originalEmails.filter((e) => input.businessIds.has(e.id) && e.hasAttachments);

  for (const email of targets) {
    // For Gmail/Outlook the initial listUnreadMessages call doesn't include
    // attachment refs — they require a follow-up call. For IMAP the refs
    // came back populated from listImapUnread already.
    let attachments = email.attachments ?? [];
    if (
      attachments.length === 0 &&
      (input.conn.provider === 'google' || input.conn.provider === 'microsoft')
    ) {
      const refs = await listEmailAttachments(input.conn, email.id);
      if (refs.success && refs.data) attachments = refs.data;
    }
    attachments = attachments.slice(0, MAX_ATTACHMENTS_PER_EMAIL);
    if (attachments.length === 0) continue;
    for (const ref of attachments) {
      result.considered++;
      if (ref.sizeBytes && ref.sizeBytes > MAX_BYTES_PER_ATTACHMENT) {
        result.skipped++;
        continue;
      }

      const summary = summaryById.get(email.id);
      const sourceLabel: 'gmail_attachment' | 'outlook_attachment' | 'yahoo_attachment' =
        input.conn.provider === 'google' ? 'gmail_attachment'
        : input.conn.provider === 'microsoft' ? 'outlook_attachment'
        : 'yahoo_attachment';

      try {
        const fetched = await fetchAttachmentForProvider({
          conn: input.conn,
          messageId: email.id,
          ref,
        });
        if (!fetched.success || !fetched.data) {
          result.errors.push(`fetch ${email.id}/${ref.filename}: ${fetched.error}`);
          result.skipped++;
          continue;
        }

        // For Gmail the attachment endpoint doesn't return filename/mime —
        // override from the ref (which we got via listMessageAttachments
        // for Microsoft, or via the message-payload walk for Gmail).
        const filename = ref.filename || fetched.data.filename;
        const mimeType = ref.mimeType || fetched.data.mimeType;

        const upload = await uploadReceivedDoc({
          tenantPhone: input.conn.phone_number,
          bytes: fetched.data.bytes,
          mimeType,
          filename,
        });
        if (!upload) {
          result.errors.push(`upload ${email.id}/${filename}: storage upload failed`);
          result.skipped++;
          continue;
        }
        result.uploaded++;

        const isPdf = mimeType.toLowerCase().includes('pdf') || filename.toLowerCase().endsWith('.pdf');

        // Insert the doc row up-front so we have a record even if analysis fails
        const cleanPhone = input.conn.phone_number.replace(/[\s\-+()]/g, '');
        const insertBody: Record<string, unknown> = {
          tenant_phone: cleanPhone,
          source: sourceLabel,
          filename,
          mime_type: mimeType,
          size_bytes: fetched.data.sizeBytes,
          storage_path: upload.path,
          public_url: upload.publicUrl,
          status: isPdf ? 'processing' : 'analysis_failed',
          metadata: {
            source_email_id: email.id,
            source_email_subject: summary?.subject ?? email.subject,
            source_email_from: summary?.from ?? email.from,
          },
        };
        if (!isPdf) {
          insertBody.summary = `Stored ${filename} — analysis for ${mimeType} is coming in a future update (Phase 3: docx/xlsx parsing). Currently I can analyze PDFs only.`;
        }
        const insRes = await fetch(`${SUPABASE_URL}/rest/v1/received_documents`, {
          method: 'POST',
          headers: { ...headers(), Prefer: 'return=representation' },
          body: JSON.stringify(insertBody),
        });
        const docRowId = insRes.ok ? (await insRes.json())[0]?.id : null;

        if (!isPdf) {
          result.skipped++;
          continue;
        }

        // PDF analysis — Claude takes the bytes directly via base64
        const pdfBase64 = Buffer.from(fetched.data.bytes).toString('base64');
        const analysis = await analyzePdfDocument({ pdfBase64, hintFilename: filename });

        if (!docRowId) {
          if (!analysis.ok) result.errors.push(`analyze ${filename}: ${analysis.error}`);
          continue;
        }
        await fetch(`${SUPABASE_URL}/rest/v1/received_documents?id=eq.${docRowId}`, {
          method: 'PATCH',
          headers: { ...headers(), Prefer: 'return=minimal' },
          body: JSON.stringify(
            analysis.ok
              ? {
                  status: 'analyzed',
                  summary: analysis.analysis.summary,
                  key_dates: analysis.analysis.keyDates,
                  key_amounts: analysis.analysis.keyAmounts,
                  key_parties: analysis.analysis.keyParties,
                  action_items: analysis.analysis.actionItems,
                  risks: analysis.analysis.risks,
                  tags: analysis.analysis.tags,
                }
              : { status: 'analysis_failed', metadata: { error: analysis.error } },
          ),
        });
        if (analysis.ok) result.analyzed++;
        else result.errors.push(`analyze ${filename}: ${analysis.error}`);
      } catch (err: any) {
        result.errors.push(`${email.id}/${ref.filename}: ${err?.message ?? String(err)}`);
        result.skipped++;
      }
    }
  }
  return result;
}

/** Provider-routed attachment fetch. Gmail/Microsoft go through the
 *  shared router; Yahoo/IMAP goes through the local imap-runtime. */
async function fetchAttachmentForProvider(input: {
  conn: OAuthConnection & { phone_number: string };
  messageId: string;
  ref: { id: string; filename: string; mimeType: string };
}): Promise<{ success: boolean; data?: { filename: string; mimeType: string; bytes: Uint8Array; sizeBytes: number }; error?: string }> {
  if (input.conn.provider === 'google' || input.conn.provider === 'microsoft') {
    return fetchEmailAttachment(input.conn, input.messageId, input.ref.id);
  }
  if (input.conn.provider === 'yahoo' || input.conn.provider === 'imap') {
    return fetchImapAttachment(input.conn as any, input.messageId, input.ref.filename);
  }
  return { success: false, error: `Provider ${input.conn.provider} not supported` };
}

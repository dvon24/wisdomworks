/**
 * Story 2.16 Phase 4 — Cloud document search + read across Google Drive
 * and Microsoft OneDrive.
 *
 * Owner says "pull the lease from my Drive" or "find the Q3 report on
 * OneDrive" → Iris calls these helpers via the agent tool, runs the
 * standard analyzeReceivedDocument pipeline on the result.
 *
 * Provider differences worth knowing:
 *   - Google Drive: requires `drive.readonly` scope (added 2026-05-13;
 *     re-consent required for prior tenants). Native Google Docs files
 *     must be EXPORTED to a parseable format (pdf/docx/xlsx) — the
 *     `mimeType` on the file object tells us if it's native vs
 *     uploaded. Exported MIME maps:
 *       application/vnd.google-apps.document  → application/pdf
 *       application/vnd.google-apps.spreadsheet → xlsx
 *       application/vnd.google-apps.presentation → pdf
 *   - OneDrive: requires `Files.Read.All` scope. Files come back with
 *     their native mime — uploaded PDFs/docx/xlsx are downloadable as-is.
 *     Native Office files are also downloadable as-is (Office Online
 *     format = the same .docx/.xlsx the analyzer parses).
 */

import type { IntegrationContext, IntegrationResult } from './types';

export interface CloudDocRef {
  /** Provider's file id */
  id: string;
  /** Owner-facing filename (Drive's `name`, OneDrive's `name`) */
  filename: string;
  /** Native MIME type as the provider reports it */
  mimeType: string;
  sizeBytes?: number;
  /** ISO timestamp of last modification */
  modifiedAt?: string;
  /** Web-viewable URL for the owner to open in browser (Drive's
   *  webViewLink / OneDrive's webUrl) */
  webUrl?: string;
  /** Which platform this came from */
  provider: 'google_drive' | 'onedrive';
}

export interface FetchedCloudDoc {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
  sizeBytes: number;
}

// ─── Google Drive ─────────────────────────────────────────────────────────

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_EXPORT_MAP: Record<string, { mime: string; ext: string }> = {
  'application/vnd.google-apps.document': { mime: 'application/pdf', ext: 'pdf' },
  'application/vnd.google-apps.spreadsheet': {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ext: 'xlsx',
  },
  'application/vnd.google-apps.presentation': { mime: 'application/pdf', ext: 'pdf' },
};

/**
 * Search Drive. Query syntax is Google's standard — full-text via
 * `fullText contains 'X'` or filename via `name contains 'X'`. We
 * use OR'd both so the matcher works the way owners naturally search.
 *
 * If the query is empty, returns the 25 most recently modified files.
 */
export async function searchDrive(
  ctx: IntegrationContext,
  query: string,
  limit: number = 15,
): Promise<IntegrationResult<CloudDocRef[]>> {
  try {
    const trimmed = (query ?? '').trim().replace(/'/g, "\\'");
    let q: string;
    if (trimmed) {
      // Match either filename or full-text body. Exclude trashed.
      q = `(name contains '${trimmed}' or fullText contains '${trimmed}') and trashed = false`;
    } else {
      q = 'trashed = false';
    }
    const params = new URLSearchParams({
      q,
      pageSize: String(Math.min(limit, 50)),
      fields: 'files(id,name,mimeType,size,modifiedTime,webViewLink)',
      orderBy: 'modifiedTime desc',
    });
    const res = await fetch(`${DRIVE_API}/files?${params}`, {
      headers: { Authorization: `Bearer ${ctx.accessToken}` },
    });
    if (!res.ok) {
      const body = await res.text();
      // 403 with insufficient scopes points to the re-consent path
      if (res.status === 403 && /insufficientPermissions|insufficient_scope|scope/i.test(body)) {
        return {
          success: false,
          error: 'Google Drive read scope missing — owner needs to reconnect Google to grant drive.readonly access.',
        };
      }
      return { success: false, error: `Drive search failed: ${res.status} ${body.slice(0, 200)}` };
    }
    const data = await res.json();
    const refs: CloudDocRef[] = (data.files ?? []).map((f: any) => ({
      id: String(f.id),
      filename: String(f.name ?? 'untitled'),
      mimeType: String(f.mimeType ?? 'application/octet-stream'),
      sizeBytes: f.size ? Number(f.size) : undefined,
      modifiedAt: f.modifiedTime,
      webUrl: f.webViewLink,
      provider: 'google_drive',
    }));
    return { success: true, data: refs };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Fetch a Drive file's bytes. Native Google Docs files are exported
 * via the documented Google→Office mime map. Uploaded files (PDFs,
 * Word docs, spreadsheets) come back as-is via alt=media.
 */
export async function fetchDriveFile(
  ctx: IntegrationContext,
  fileId: string,
): Promise<IntegrationResult<FetchedCloudDoc>> {
  try {
    // First: get the file metadata so we know the mime type + filename
    const metaRes = await fetch(`${DRIVE_API}/files/${fileId}?fields=id,name,mimeType,size`, {
      headers: { Authorization: `Bearer ${ctx.accessToken}` },
    });
    if (!metaRes.ok) {
      const body = await metaRes.text();
      if (metaRes.status === 403 && /scope/i.test(body)) {
        return { success: false, error: 'Drive read scope missing — owner needs to reconnect Google.' };
      }
      return { success: false, error: `Drive metadata failed: ${metaRes.status}` };
    }
    const meta = await metaRes.json();
    const nativeMime: string = meta.mimeType ?? 'application/octet-stream';

    const exportTarget = DRIVE_EXPORT_MAP[nativeMime];
    let bytesUrl: string;
    let outMime: string;
    let outFilename: string;
    if (exportTarget) {
      // Google native file — export to a parseable format
      bytesUrl = `${DRIVE_API}/files/${fileId}/export?mimeType=${encodeURIComponent(exportTarget.mime)}`;
      outMime = exportTarget.mime;
      outFilename = `${meta.name ?? 'document'}.${exportTarget.ext}`;
    } else {
      // Uploaded file — download as-is
      bytesUrl = `${DRIVE_API}/files/${fileId}?alt=media`;
      outMime = nativeMime;
      outFilename = String(meta.name ?? 'document');
    }
    const fileRes = await fetch(bytesUrl, {
      headers: { Authorization: `Bearer ${ctx.accessToken}` },
    });
    if (!fileRes.ok) {
      return { success: false, error: `Drive download failed: ${fileRes.status}` };
    }
    const buf = await fileRes.arrayBuffer();
    const bytes = new Uint8Array(buf);
    return {
      success: true,
      data: { filename: outFilename, mimeType: outMime, bytes, sizeBytes: bytes.length },
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── Microsoft OneDrive (Graph) ──────────────────────────────────────────

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

/** Search OneDrive — Graph's /me/drive/root/search endpoint. Empty
 *  query returns the 25 most recently modified items. */
export async function searchOneDrive(
  ctx: IntegrationContext,
  query: string,
  limit: number = 15,
): Promise<IntegrationResult<CloudDocRef[]>> {
  try {
    const trimmed = (query ?? '').trim();
    const url = trimmed
      ? `${GRAPH_BASE}/me/drive/root/search(q='${encodeURIComponent(trimmed)}')?$select=id,name,size,file,lastModifiedDateTime,webUrl&$top=${Math.min(limit, 50)}`
      : `${GRAPH_BASE}/me/drive/root/children?$select=id,name,size,file,lastModifiedDateTime,webUrl&$orderby=lastModifiedDateTime desc&$top=${Math.min(limit, 50)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${ctx.accessToken}` },
    });
    if (!res.ok) {
      const body = await res.text();
      if (res.status === 403 && /scope|permission/i.test(body)) {
        return {
          success: false,
          error: 'OneDrive read scope missing — owner needs to reconnect Microsoft to grant Files.Read.All.',
        };
      }
      return { success: false, error: `OneDrive search failed: ${res.status} ${body.slice(0, 200)}` };
    }
    const data = await res.json();
    const refs: CloudDocRef[] = (data.value ?? [])
      .filter((f: any) => f.file) // skip folders
      .map((f: any) => ({
        id: String(f.id),
        filename: String(f.name ?? 'untitled'),
        mimeType: String(f.file?.mimeType ?? 'application/octet-stream'),
        sizeBytes: typeof f.size === 'number' ? f.size : undefined,
        modifiedAt: f.lastModifiedDateTime,
        webUrl: f.webUrl,
        provider: 'onedrive',
      }));
    return { success: true, data: refs };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/** Fetch a OneDrive file's bytes via /me/drive/items/{id}/content. */
export async function fetchOneDriveFile(
  ctx: IntegrationContext,
  fileId: string,
): Promise<IntegrationResult<FetchedCloudDoc>> {
  try {
    // Metadata first for filename + mimeType
    const metaRes = await fetch(
      `${GRAPH_BASE}/me/drive/items/${fileId}?$select=id,name,size,file`,
      { headers: { Authorization: `Bearer ${ctx.accessToken}` } },
    );
    if (!metaRes.ok) {
      const body = await metaRes.text();
      if (metaRes.status === 403 && /scope|permission/i.test(body)) {
        return { success: false, error: 'OneDrive read scope missing — owner needs to reconnect Microsoft.' };
      }
      return { success: false, error: `OneDrive metadata failed: ${metaRes.status}` };
    }
    const meta = await metaRes.json();
    const filename = String(meta.name ?? 'document');
    const mimeType = String(meta.file?.mimeType ?? 'application/octet-stream');

    // Now stream the bytes. Graph's /content endpoint returns a 302
    // redirect to a CDN URL — fetch follows redirects by default.
    const fileRes = await fetch(`${GRAPH_BASE}/me/drive/items/${fileId}/content`, {
      headers: { Authorization: `Bearer ${ctx.accessToken}` },
    });
    if (!fileRes.ok) {
      return { success: false, error: `OneDrive download failed: ${fileRes.status}` };
    }
    const buf = await fileRes.arrayBuffer();
    const bytes = new Uint8Array(buf);
    return {
      success: true,
      data: { filename, mimeType, bytes, sizeBytes: bytes.length },
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

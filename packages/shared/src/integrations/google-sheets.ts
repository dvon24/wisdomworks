/**
 * Google Sheets API client. Read + append only — no destructive ops in
 * this v1. Mira (Financial Advisor) and any future budget/log-style agent
 * uses this to read tracking sheets and append new rows.
 *
 * Requires the spreadsheets scope which is implicit in `drive.readonly`
 * for read-only AND requires `spreadsheets` scope for write. We currently
 * only request `drive.readonly` at consent time — read works, but write
 * (appendRow) will 403 until we add `spreadsheets` to the consent flow.
 *
 * Bug fix path (added 2026-05-15): if append 403s with insufficient scope,
 * the executor surfaces "owner needs to reconnect Google with the
 * spreadsheets scope to enable writes."
 *
 * API ref: https://developers.google.com/sheets/api/reference/rest
 */

import type { IntegrationContext, IntegrationResult } from './types';
import { googleFetch } from './google-refresh';

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE_BASE = 'https://www.googleapis.com/drive/v3';

export interface SheetSummary {
  spreadsheetId: string;
  title: string;
  sheets: Array<{ sheetId: number; title: string; rowCount: number; columnCount: number }>;
  spreadsheetUrl: string;
}

export interface SheetRange {
  range: string;          // e.g. "Sheet1!A1:C10"
  values: string[][];     // each row a string[]
  majorDimension?: 'ROWS' | 'COLUMNS';
}

/**
 * List the user's spreadsheets via the Drive API. Sheets API itself has no
 * "list my spreadsheets" endpoint; you have to go through Drive with a
 * mimeType filter. Returns recent first.
 */
export async function listSpreadsheets(
  ctx: IntegrationContext,
  opts: { query?: string; limit?: number } = {},
): Promise<IntegrationResult<Array<{ id: string; name: string; modifiedTime: string; webViewLink: string }>>> {
  try {
    const limit = Math.min(opts.limit ?? 25, 100);
    const q = `mimeType='application/vnd.google-apps.spreadsheet' and trashed=false${opts.query ? ` and name contains '${opts.query.replace(/'/g, "\\'")}'` : ''}`;
    const params = new URLSearchParams({
      q,
      pageSize: String(limit),
      orderBy: 'modifiedTime desc',
      fields: 'files(id,name,modifiedTime,webViewLink)',
    });
    const res = await googleFetch(ctx, `${DRIVE_BASE}/files?${params}`);
    if (!res.ok) {
      const text = await res.text();
      if (res.status === 401) {
        return { success: false, error: 'Google auth expired and refresh failed — owner should reconnect Google.' };
      }
      if (res.status === 403) {
        return { success: false, error: 'Drive scope missing — reconnect Google with drive.readonly to list spreadsheets.' };
      }
      return { success: false, error: `Sheets list failed: ${res.status} ${text}` };
    }
    const data = await res.json();
    return {
      success: true,
      data: (data.files ?? []).map((f: any) => ({
        id: f.id,
        name: f.name,
        modifiedTime: f.modifiedTime,
        webViewLink: f.webViewLink,
      })),
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Get summary metadata for a spreadsheet — its sheet tabs, dimensions,
 * URL. Useful before reading specific ranges so the agent knows what
 * tabs exist.
 */
export async function getSpreadsheetSummary(
  ctx: IntegrationContext,
  spreadsheetId: string,
): Promise<IntegrationResult<SheetSummary>> {
  try {
    const res = await googleFetch(ctx, `${SHEETS_BASE}/${spreadsheetId}?fields=spreadsheetId,properties.title,sheets.properties,spreadsheetUrl`);
    if (!res.ok) {
      const text = await res.text();
      if (res.status === 401) {
        return { success: false, error: 'Google auth expired and refresh failed — owner should reconnect Google.' };
      }
      if (res.status === 404) {
        return { success: false, error: 'Spreadsheet not found or not accessible by this account.' };
      }
      return { success: false, error: `Sheet summary failed: ${res.status} ${text}` };
    }
    const data = await res.json();
    return {
      success: true,
      data: {
        spreadsheetId: data.spreadsheetId,
        title: data.properties?.title ?? '',
        spreadsheetUrl: data.spreadsheetUrl,
        sheets: (data.sheets ?? []).map((s: any) => ({
          sheetId: s.properties.sheetId,
          title: s.properties.title,
          rowCount: s.properties.gridProperties?.rowCount ?? 0,
          columnCount: s.properties.gridProperties?.columnCount ?? 0,
        })),
      },
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Read a range from a spreadsheet. Range uses A1 notation:
 *   "Sheet1"             — entire sheet
 *   "Sheet1!A1:C10"      — bounded
 *   "A1:C10"             — first sheet, bounded
 */
export async function readRange(
  ctx: IntegrationContext,
  spreadsheetId: string,
  range: string,
): Promise<IntegrationResult<SheetRange>> {
  try {
    const res = await googleFetch(
      ctx,
      `${SHEETS_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}`,
    );
    if (!res.ok) {
      const text = await res.text();
      if (res.status === 401) {
        return { success: false, error: 'Google auth expired and refresh failed — owner should reconnect Google.' };
      }
      return { success: false, error: `Sheet read failed: ${res.status} ${text}` };
    }
    const data = await res.json();
    return {
      success: true,
      data: {
        range: data.range,
        values: data.values ?? [],
        majorDimension: data.majorDimension,
      },
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Append rows to a sheet. New rows go after the last row with data in
 * the matching range. Use ValueInputOption=USER_ENTERED so the spreadsheet
 * parses formulas, dates, etc. (rather than treating everything as text).
 *
 * Requires the `spreadsheets` write scope. The deck currently requests
 * only `drive.readonly` so this WILL 403 until we add `spreadsheets` to
 * the consent flow. The error is descriptive so the owner knows what to
 * do.
 */
export async function appendRows(
  ctx: IntegrationContext,
  spreadsheetId: string,
  range: string,
  values: (string | number | boolean | null)[][],
): Promise<IntegrationResult<{ updatedRange: string; updatedRows: number }>> {
  try {
    const res = await googleFetch(
      ctx,
      `${SHEETS_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values }),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      if (res.status === 401) {
        return { success: false, error: 'Google auth expired and refresh failed — owner should reconnect Google.' };
      }
      if (res.status === 403) {
        return { success: false, error: 'Sheets write scope missing — reconnect Google to grant spreadsheets write access (currently we only request drive.readonly).' };
      }
      return { success: false, error: `Sheet append failed: ${res.status} ${text}` };
    }
    const data = await res.json();
    return {
      success: true,
      data: {
        updatedRange: data.updates?.updatedRange ?? range,
        updatedRows: data.updates?.updatedRows ?? values.length,
      },
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Google Search Console client. Read-only — Alex (Au7o Project Director)
 * uses this to surface impressions / clicks / CTR / position by query
 * and page.
 *
 * Requires the `webmasters.readonly` scope on the user's Google OAuth
 * connection. Existing connections from before 2026-05-14 don't have it
 * and will return 403 — the agent tool surfaces a "reconnect Google to
 * grant Search Console scope" error in that case.
 *
 * API ref: https://developers.google.com/webmaster-tools/v1/api_reference_index
 */

import type { IntegrationContext, IntegrationResult } from './types';

const GSC_BASE = 'https://www.googleapis.com/webmasters/v3';

export interface GscSite {
  siteUrl: string;
  permissionLevel: string;  // 'siteFullUser' | 'siteOwner' | etc.
}

export interface GscQueryRow {
  dimension: string;        // The dimension value (query, page, country, etc.)
  clicks: number;
  impressions: number;
  ctr: number;              // 0-1
  position: number;         // avg position, lower = better
}

export interface GscPerformanceReport {
  siteUrl: string;
  dimension: 'query' | 'page' | 'country' | 'device' | 'date';
  startDate: string;
  endDate: string;
  rows: GscQueryRow[];
  totalClicks: number;
  totalImpressions: number;
  averageCtr: number;
  averagePosition: number;
}

/**
 * List all sites the connected Google account has access to in Search
 * Console. Use this to discover which siteUrls are valid for
 * getPerformance().
 */
export async function listSites(ctx: IntegrationContext): Promise<IntegrationResult<GscSite[]>> {
  try {
    const res = await fetch(`${GSC_BASE}/sites`, {
      headers: { Authorization: `Bearer ${ctx.accessToken}` },
    });
    if (!res.ok) {
      const text = await res.text();
      if (res.status === 403 && text.includes('insufficient')) {
        return { success: false, error: 'GSC scope missing — owner needs to reconnect Google with webmasters.readonly scope.' };
      }
      return { success: false, error: `GSC sites list failed: ${res.status} ${text}` };
    }
    const data = await res.json();
    const sites: GscSite[] = (data.siteEntry ?? []).map((s: any) => ({
      siteUrl: s.siteUrl,
      permissionLevel: s.permissionLevel,
    }));
    return { success: true, data: sites };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Pull a performance report for a site over a date range, grouped by
 * dimension (query / page / country / device / date).
 *
 * Defaults: last 28 days, group by query, top 25 rows.
 */
export async function getPerformance(
  ctx: IntegrationContext,
  input: {
    siteUrl: string;
    dimension?: 'query' | 'page' | 'country' | 'device' | 'date';
    daysBack?: number;
    rowLimit?: number;
  },
): Promise<IntegrationResult<GscPerformanceReport>> {
  try {
    const dimension = input.dimension ?? 'query';
    const daysBack = input.daysBack ?? 28;
    const rowLimit = Math.min(input.rowLimit ?? 25, 100);

    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - daysBack * 24 * 60 * 60 * 1000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    const body = {
      startDate: fmt(startDate),
      endDate: fmt(endDate),
      dimensions: [dimension],
      rowLimit,
    };

    const res = await fetch(
      `${GSC_BASE}/sites/${encodeURIComponent(input.siteUrl)}/searchAnalytics/query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ctx.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );

    if (!res.ok) {
      const text = await res.text();
      if (res.status === 403) {
        return { success: false, error: 'GSC scope missing or site not verified for this Google account — reconnect Google or verify the site in Search Console.' };
      }
      return { success: false, error: `GSC performance query failed: ${res.status} ${text}` };
    }

    const data = await res.json();
    const rows: GscQueryRow[] = (data.rows ?? []).map((r: any) => ({
      dimension: r.keys?.[0] ?? '',
      clicks: r.clicks ?? 0,
      impressions: r.impressions ?? 0,
      ctr: r.ctr ?? 0,
      position: r.position ?? 0,
    }));

    const totalClicks = rows.reduce((s, r) => s + r.clicks, 0);
    const totalImpressions = rows.reduce((s, r) => s + r.impressions, 0);
    const averageCtr = totalImpressions > 0 ? totalClicks / totalImpressions : 0;
    const averagePosition = rows.length > 0
      ? rows.reduce((s, r) => s + r.position * r.impressions, 0) / Math.max(totalImpressions, 1)
      : 0;

    return {
      success: true,
      data: {
        siteUrl: input.siteUrl,
        dimension,
        startDate: fmt(startDate),
        endDate: fmt(endDate),
        rows,
        totalClicks,
        totalImpressions,
        averageCtr,
        averagePosition,
      },
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

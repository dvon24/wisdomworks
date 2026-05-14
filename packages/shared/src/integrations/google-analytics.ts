/**
 * Google Analytics 4 (GA4) client. Read-only. Alex uses this to surface
 * sessions / users / top pages / conversions for the sites he manages.
 *
 * GA4 (not Universal Analytics — UA was sunset 2023). Two APIs in scope:
 *   - Admin API: list GA4 properties the user has access to
 *   - Data API: run reports (metrics + dimensions)
 *
 * Requires `analytics.readonly` scope. Existing pre-2026-05-14 Google
 * connections don't have it.
 *
 * API refs:
 *   - Admin: https://developers.google.com/analytics/devguides/config/admin/v1
 *   - Data: https://developers.google.com/analytics/devguides/reporting/data/v1
 */

import type { IntegrationContext, IntegrationResult } from './types';

const GA_ADMIN_BASE = 'https://analyticsadmin.googleapis.com/v1beta';
const GA_DATA_BASE = 'https://analyticsdata.googleapis.com/v1beta';

export interface Ga4Property {
  propertyId: string;       // numeric, e.g. "123456789"
  displayName: string;
  account: string;          // "accounts/<id>"
  timeZone?: string;
  currencyCode?: string;
}

export interface Ga4ReportRow {
  dimensions: string[];     // e.g. ["/blog/post"]
  metrics: number[];        // e.g. [1234] (sessions)
}

export interface Ga4Report {
  propertyId: string;
  dimensionHeaders: string[];
  metricHeaders: string[];
  rows: Ga4ReportRow[];
  totalRows: number;
}

/**
 * List GA4 properties the connected Google account has access to.
 * Returns numeric propertyIds suitable for runReport().
 */
export async function listProperties(ctx: IntegrationContext): Promise<IntegrationResult<Ga4Property[]>> {
  try {
    // GA4 admin API requires listing account summaries first; each
    // summary embeds the properties under that account.
    const res = await fetch(`${GA_ADMIN_BASE}/accountSummaries`, {
      headers: { Authorization: `Bearer ${ctx.accessToken}` },
    });
    if (!res.ok) {
      const text = await res.text();
      if (res.status === 403) {
        return { success: false, error: 'GA scope missing — owner needs to reconnect Google with analytics.readonly scope.' };
      }
      return { success: false, error: `GA list-properties failed: ${res.status} ${text}` };
    }
    const data = await res.json();
    const properties: Ga4Property[] = [];
    for (const acc of data.accountSummaries ?? []) {
      for (const prop of acc.propertySummaries ?? []) {
        // prop.property is "properties/<id>"; strip prefix
        const propertyId = (prop.property ?? '').replace(/^properties\//, '');
        if (propertyId) {
          properties.push({
            propertyId,
            displayName: prop.displayName ?? propertyId,
            account: acc.account ?? '',
          });
        }
      }
    }
    return { success: true, data: properties };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Run a GA4 report. Defaults to a common "site overview" — sessions +
 * active users over the last 28 days, grouped by date.
 *
 * Common other shapes:
 *   - Top pages:    dimensions=['pagePath'], metrics=['screenPageViews']
 *   - Top sources:  dimensions=['sessionSource'], metrics=['sessions']
 *   - Conversions:  dimensions=['date'], metrics=['conversions']
 */
export async function runReport(
  ctx: IntegrationContext,
  input: {
    propertyId: string;
    dimensions?: string[];
    metrics?: string[];
    daysBack?: number;
    rowLimit?: number;
  },
): Promise<IntegrationResult<Ga4Report>> {
  try {
    const dimensions = input.dimensions ?? ['date'];
    const metrics = input.metrics ?? ['sessions', 'activeUsers'];
    const daysBack = input.daysBack ?? 28;
    const rowLimit = Math.min(input.rowLimit ?? 25, 100);

    const body = {
      dateRanges: [{
        startDate: `${daysBack}daysAgo`,
        endDate: 'today',
      }],
      dimensions: dimensions.map((d) => ({ name: d })),
      metrics: metrics.map((m) => ({ name: m })),
      limit: String(rowLimit),
    };

    const res = await fetch(
      `${GA_DATA_BASE}/properties/${input.propertyId}:runReport`,
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
        return { success: false, error: 'GA scope missing or property not accessible to this Google account.' };
      }
      return { success: false, error: `GA runReport failed: ${res.status} ${text}` };
    }

    const data = await res.json();
    const dimensionHeaders: string[] = (data.dimensionHeaders ?? []).map((h: any) => h.name);
    const metricHeaders: string[] = (data.metricHeaders ?? []).map((h: any) => h.name);
    const rows: Ga4ReportRow[] = (data.rows ?? []).map((r: any) => ({
      dimensions: (r.dimensionValues ?? []).map((v: any) => v.value ?? ''),
      metrics: (r.metricValues ?? []).map((v: any) => Number(v.value ?? 0)),
    }));

    return {
      success: true,
      data: {
        propertyId: input.propertyId,
        dimensionHeaders,
        metricHeaders,
        rows,
        totalRows: data.rowCount ?? rows.length,
      },
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

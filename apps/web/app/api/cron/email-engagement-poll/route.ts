/**
 * Story 2.16 Phase 2c — Email engagement poll cron.
 *
 * Every 6 hours: for each active tenant, re-check the read state of
 * emails classified in the last 14 days. Updates email_engagement_signals
 * so the classifier's next batch sees up-to-date per-sender open rates.
 *
 * Cron costs are bounded — single batched IMAP call per Yahoo tenant,
 * one metadata-only API call per Gmail/Outlook tracked email (max 100
 * per tenant per tick), max 14-day window.
 *
 * Schedule: vercel.json every 6 hours (00:00, 06:00, 12:00, 18:00 UTC).
 */

import { NextResponse } from 'next/server';
import { pollEngagementForTenant } from '../../_lib/email-engagement';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) return new Response('Unauthorized', { status: 401 });
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  try {
    // Tenants with at least one tracking row (cheap pre-filter)
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/email_engagement_signals?status=eq.tracking&select=tenant_phone&limit=1000`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
    );
    const rows: { tenant_phone: string }[] = res.ok ? await res.json() : [];
    const phones = Array.from(new Set(rows.map((r) => r.tenant_phone)));
    if (phones.length === 0) {
      return NextResponse.json({ ok: true, tenants: 0, checked: 0, newly_opened: 0, archived: 0 });
    }

    let totalChecked = 0;
    let totalOpened = 0;
    let totalArchived = 0;
    const tenantErrors: Array<{ phone: string; errors: string[] }> = [];

    for (const phone of phones) {
      try {
        const r = await pollEngagementForTenant(phone);
        totalChecked += r.checked;
        totalOpened += r.newly_opened;
        totalArchived += r.archived;
        if (r.errors.length > 0) tenantErrors.push({ phone, errors: r.errors });
      } catch (err: any) {
        tenantErrors.push({ phone, errors: [err?.message ?? String(err)] });
      }
    }

    return NextResponse.json({
      ok: true,
      tenants: phones.length,
      checked: totalChecked,
      newly_opened: totalOpened,
      archived: totalArchived,
      errors: tenantErrors,
    });
  } catch (err) {
    console.error('[email-engagement-poll] error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

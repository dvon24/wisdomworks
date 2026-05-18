/**
 * Story 2.10 — Daily tenant-snapshot cron.
 *
 * Walks every active tenant and writes a per-tenant JSON snapshot of
 * critical tables to the `tenant-snapshots` Supabase Storage bucket.
 * See _lib/tenant-snapshots.ts for the backup architecture rationale
 * (PRIMARY = Supabase backups; this cron writes INSURANCE on top).
 *
 * Schedule: once per day. Idempotent — re-running mid-day finds today's
 * snapshot already in place and skips.
 *
 * Auth: same dual-secret pattern as knowledge-refresh — accepts EITHER
 * CRON_SECRET (Vercel auto-invocation) OR OWNER_API_TOKEN (manual
 * admin trigger).
 */

import { NextResponse } from 'next/server';
import { snapshotTenant } from '../../_lib/tenant-snapshots';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const ownerToken = process.env.OWNER_API_TOKEN;
  const auth = request.headers.get('authorization');
  if (cronSecret || ownerToken) {
    const validCron = cronSecret && auth === `Bearer ${cronSecret}`;
    const validOwner = ownerToken && auth === `Bearer ${ownerToken}`;
    if (!validCron && !validOwner) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  } else {
    console.warn('[snapshot-tenants] WARNING: neither CRON_SECRET nor OWNER_API_TOKEN set — route is unauthenticated.');
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/whatsapp_contexts?select=phone_number`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
    );
    const tenants: { phone_number: string }[] = res.ok ? await res.json() : [];

    const startedAt = Date.now();
    const HARD_DEADLINE_MS = 100_000; // leave 20s headroom under the 120s function timeout

    const results = {
      ok: 0,
      skipped: 0,
      failed: 0,
      bucket_missing: false as boolean,
      total_bytes: 0,
      details: [] as Array<{ tenant: string; status: string; bytes?: number; reason?: string }>,
    };

    for (const t of tenants) {
      if (Date.now() - startedAt > HARD_DEADLINE_MS) {
        results.details.push({ tenant: t.phone_number, status: 'deferred', reason: 'deadline reached' });
        break;
      }
      try {
        const r = await snapshotTenant(t.phone_number);
        if (r.ok) {
          if (r.reason === 'already_exists_today') {
            results.skipped++;
            results.details.push({ tenant: t.phone_number, status: 'skipped', reason: 'already snapshotted today' });
          } else {
            results.ok++;
            results.total_bytes += r.size_bytes ?? 0;
            results.details.push({ tenant: t.phone_number, status: 'snapshotted', bytes: r.size_bytes });
          }
        } else {
          results.failed++;
          results.details.push({ tenant: t.phone_number, status: 'failed', reason: r.reason });
          if (r.reason?.includes('Bucket') && r.reason?.includes('does not exist')) {
            results.bucket_missing = true;
          }
        }
      } catch (err: any) {
        results.failed++;
        results.details.push({ tenant: t.phone_number, status: 'failed', reason: err?.message ?? String(err) });
      }
    }

    console.log(
      `[snapshot-tenants] tenants=${tenants.length} ok=${results.ok} skipped=${results.skipped} failed=${results.failed} bytes=${results.total_bytes}`,
    );

    // Loud admin hint if the bucket is missing — first-run setup.
    if (results.bucket_missing) {
      const { ok: _ok, ...rest } = results;
      return NextResponse.json({
        ok: false,
        action_required: "Create the 'tenant-snapshots' bucket in Supabase Storage (PUBLIC READ DISABLED). Snapshots contain tenant config + atoms — keep it private.",
        snapshotted: _ok,
        ...rest,
      });
    }

    return NextResponse.json({ ok: true, tenants: tenants.length, results });
  } catch (err) {
    console.error('[snapshot-tenants] error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

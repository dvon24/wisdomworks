/**
 * GET /api/admin/verify-backups?phone=<tenant>
 *   Bearer OWNER_API_TOKEN
 *
 * Story 2.10 — Backup verification.
 *
 * Returns the tenant's backup posture in one shot:
 *   - Recent snapshots listed from the tenant-snapshots bucket (date,
 *     size, age)
 *   - Health interpretation: ✓ healthy / ⚠ stale / ✗ no snapshots
 *   - Action hints when the bucket is missing or snapshots are old
 *
 * Use this:
 *   - After a Supabase migration to confirm tenant data is intact
 *   - Before a risky admin operation (e.g. tenant deletion)
 *   - On a schedule (manual today, automatable later) to spot
 *     tenants that have fallen out of the snapshot rotation
 *
 * Recovery posture documented in _lib/tenant-snapshots.ts: Supabase
 * native backups are PRIMARY; these snapshots are INSURANCE.
 */

import { listTenantSnapshots } from '../../_lib/tenant-snapshots';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(request: Request) {
  const auth = request.headers.get('authorization');
  const ownerToken = process.env.OWNER_API_TOKEN;
  if (!ownerToken || !auth?.startsWith('Bearer ') || auth.slice(7) !== ownerToken) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const phone = url.searchParams.get('phone');
  if (!phone) {
    return Response.json({ error: 'phone query param required (e.g. ?phone=491703604562)' }, { status: 400 });
  }

  const snapshots = await listTenantSnapshots(phone);

  if (snapshots.length === 0) {
    return Response.json({
      tenant: phone.replace(/[\s\-+()]/g, ''),
      status: 'no_snapshots',
      interpretation:
        '✗ No snapshots found. Either the cron has never run for this tenant, OR the `tenant-snapshots` bucket doesn\'t exist. Create the bucket in Supabase Dashboard → Storage (PUBLIC READ DISABLED), then trigger /api/cron/snapshot-tenants.',
      snapshots: [],
    });
  }

  const latest = snapshots[0]!;
  const latestTs = new Date(latest.created_at).getTime();
  const ageHours = (Date.now() - latestTs) / (1000 * 60 * 60);
  let status: 'healthy' | 'stale' | 'very_stale';
  let interpretation: string;
  if (ageHours <= 26) {
    status = 'healthy';
    interpretation = `✓ Healthy. Latest snapshot is ${ageHours.toFixed(1)}h old (${snapshots.length} snapshots retained, ${formatBytes(snapshots.reduce((s, x) => s + x.size, 0))} total).`;
  } else if (ageHours <= 72) {
    status = 'stale';
    interpretation = `⚠ Stale. Latest snapshot is ${ageHours.toFixed(1)}h old — cron may have been failing. Check Vercel logs for [snapshot-tenants] errors.`;
  } else {
    status = 'very_stale';
    interpretation = `✗ Very stale. Latest snapshot is ${(ageHours / 24).toFixed(1)} DAYS old. Cron is not running. Investigate immediately.`;
  }

  return Response.json({
    tenant: phone.replace(/[\s\-+()]/g, ''),
    status,
    interpretation,
    latest_snapshot: {
      path: latest.path,
      created_at: latest.created_at,
      age_hours: Number(ageHours.toFixed(1)),
      size_bytes: latest.size,
    },
    snapshots_retained: snapshots.length,
    total_size_bytes: snapshots.reduce((s, x) => s + x.size, 0),
    recovery_notes: [
      'PRIMARY recovery path: Supabase Dashboard → Database → Backups (PITR on Pro plan, daily on Free).',
      'INSURANCE recovery path: download a snapshot from the `tenant-snapshots` bucket and hand-restore via the (Phase 2.10b) restore endpoint. That endpoint is intentionally not built yet — restores are sensitive enough to deserve a manual sign-off ceremony when first needed.',
    ],
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
}

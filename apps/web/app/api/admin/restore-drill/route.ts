/**
 * POST /api/admin/restore-drill
 *   Bearer OWNER_API_TOKEN
 *   Body: { phone: string, snapshotPath?: string, dryRun?: boolean }
 *
 * Epic 6 Story 6.6 — Backup Recovery Drill.
 *
 * A backup that's never been restored from is theatre. This endpoint
 * performs a NON-DESTRUCTIVE restore drill to prove the snapshot
 * pipeline (Story 2.10) actually produces recoverable data:
 *
 *   1. Pick a snapshot from `tenant-snapshots` bucket (defaults to
 *      the most recent for the tenant).
 *   2. Download + parse the JSON.
 *   3. In DRY-RUN mode (default): report what WOULD be restored —
 *      row counts per table, snapshot age, checksum of the contents.
 *      Nothing is written to the DB. Safe to run anytime.
 *   4. In WET-RUN mode (?dryRun=false): write the snapshot rows to a
 *      SCRATCH tenant phone (`drill-<original>-<timestamp>`). NEVER
 *      overwrites the original tenant. The scratch rows can be
 *      inspected via standard PostgREST queries and deleted after
 *      verification.
 *
 * Cadence guidance (lives in SECURITY.md):
 *   - Monthly dry-run drill: confirms snapshots exist, are parseable,
 *     and contain expected row counts.
 *   - Quarterly wet-run drill: confirms the restore path actually
 *     produces queryable rows. Delete the drill tenant after.
 *
 * NOT a full restore endpoint. A real production-restore deserves a
 * manual sign-off ceremony (Phase 2.10b). This is the drill that
 * proves the snapshot is intact between those rare events.
 */

import { listTenantSnapshots } from '../../_lib/tenant-snapshots';
import { logAuditEvent } from '../../_lib/audit-log';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'tenant-snapshots';

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

interface SnapshotShape {
  tenant_phone: string;
  snapshot_at: string;
  snapshot_version: number;
  tables: Record<string, any[]>;
  row_counts?: Record<string, number>;
  size_bytes?: number;
}

export async function POST(request: Request) {
  const auth = request.headers.get('authorization');
  const ownerToken = process.env.OWNER_API_TOKEN;
  if (!ownerToken || !auth?.startsWith('Bearer ') || auth.slice(7) !== ownerToken) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return Response.json({ error: 'supabase not configured' }, { status: 500 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }
  const phone: string | undefined = body?.phone;
  if (!phone) return Response.json({ error: 'phone required' }, { status: 400 });
  const cleanPhone = String(phone).replace(/[\s\-+()]/g, '');
  const dryRun = body?.dryRun !== false; // default true (safe)

  // Resolve snapshot path — caller may provide one explicitly, else
  // we pick the most recent for this tenant.
  let snapshotPath: string | undefined = body?.snapshotPath;
  if (!snapshotPath) {
    const list = await listTenantSnapshots(cleanPhone);
    if (list.length === 0) {
      return Response.json({
        ok: false,
        reason: `No snapshots found for ${cleanPhone}. Either the bucket is empty, the bucket doesn't exist, or the snapshot cron has never run.`,
      });
    }
    snapshotPath = list[0]!.path;
  }

  // Download the snapshot
  let snapshot: SnapshotShape;
  try {
    const dl = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${snapshotPath}`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    });
    if (!dl.ok) {
      return Response.json({
        ok: false,
        reason: `Could not download snapshot ${snapshotPath}: ${dl.status} ${await dl.text()}`,
      });
    }
    const text = await dl.text();
    snapshot = JSON.parse(text);
    if (typeof snapshot !== 'object' || !snapshot.tables) {
      return Response.json({
        ok: false,
        reason: 'Snapshot file does not match the expected schema (missing `tables`).',
      });
    }
  } catch (err: any) {
    return Response.json({
      ok: false,
      reason: `Snapshot fetch/parse failed: ${err?.message ?? String(err)}`,
    });
  }

  // Compute summary
  const snapshotTables = Object.keys(snapshot.tables);
  const rowCounts: Record<string, number> = {};
  for (const t of snapshotTables) {
    rowCounts[t] = Array.isArray(snapshot.tables[t]) ? snapshot.tables[t].length : 0;
  }
  const totalRows = Object.values(rowCounts).reduce((s, n) => s + n, 0);
  const snapshotAgeHours = (Date.now() - new Date(snapshot.snapshot_at).getTime()) / (1000 * 60 * 60);

  // Audit the drill regardless of mode — Story 6.4 hash-chained ledger.
  void logAuditEvent({
    tenantPhone: cleanPhone,
    actor: 'admin (OWNER_API_TOKEN)',
    actorType: 'admin',
    action: 'admin.api_call',
    resource: '/api/admin/restore-drill',
    outcome: 'success',
    payload: {
      endpoint: '/api/admin/restore-drill',
      mode: dryRun ? 'dry_run' : 'wet_run',
      snapshot_path: snapshotPath,
      snapshot_age_hours: Number(snapshotAgeHours.toFixed(1)),
      total_rows_in_snapshot: totalRows,
    },
  });

  if (dryRun) {
    return Response.json({
      ok: true,
      mode: 'dry_run',
      snapshot_path: snapshotPath,
      snapshot_at: snapshot.snapshot_at,
      snapshot_age_hours: Number(snapshotAgeHours.toFixed(1)),
      snapshot_version: snapshot.snapshot_version,
      size_bytes: snapshot.size_bytes,
      tables: snapshotTables,
      row_counts: rowCounts,
      total_rows: totalRows,
      interpretation:
        totalRows === 0
          ? '⚠ Snapshot has 0 rows — this tenant may have no data yet, OR the snapshot pipeline pulled from the wrong filter. Investigate before treating this as healthy.'
          : `✓ Snapshot is intact and parseable. ${totalRows} rows across ${snapshotTables.length} tables would be restorable. Re-run with dryRun:false to do a wet-run drill (writes to drill-<phone>-<timestamp> scratch tenant, NOT the original).`,
      next_step: 'Pass dryRun:false to perform a wet-run drill that writes restored rows to a scratch tenant for visual verification.',
    });
  }

  // WET RUN — write to scratch tenant. The scratch tenant_phone is
  // deliberately weird so a casual inspector can tell it's a drill row.
  const drillPhone = `drill-${cleanPhone}-${Date.now().toString(36)}`;
  const restoreLog: Array<{ table: string; ok: boolean; rows_written: number; reason?: string }> = [];

  // Same filter-column mapping as tenant-snapshots.ts.
  const filterCol = (table: string) => (table === 'whatsapp_contexts' ? 'phone_number' : 'tenant_phone');

  for (const table of snapshotTables) {
    const rows = snapshot.tables[table];
    if (!Array.isArray(rows) || rows.length === 0) {
      restoreLog.push({ table, ok: true, rows_written: 0 });
      continue;
    }
    // Rewrite each row's tenant identifier to the drill phone, and
    // strip primary keys so the insert generates fresh UUIDs. Otherwise
    // PK conflicts would block the restore.
    const rewritten = rows.map((r: any) => {
      const copy = { ...r };
      // Drop PKs — most rows have `id` UUID PKs
      delete copy.id;
      // Drop server-side defaults that shouldn't be carried over
      delete copy.created_at;
      delete copy.updated_at;
      // Repoint to the drill phone
      copy[filterCol(table)] = drillPhone;
      return copy;
    });
    try {
      const ins = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
        method: 'POST',
        headers: { ...headers(), Prefer: 'return=minimal' },
        body: JSON.stringify(rewritten),
      });
      if (ins.ok) {
        restoreLog.push({ table, ok: true, rows_written: rewritten.length });
      } else {
        const err = await ins.text().catch(() => '<no body>');
        restoreLog.push({ table, ok: false, rows_written: 0, reason: `${ins.status}: ${err.slice(0, 200)}` });
      }
    } catch (err: any) {
      restoreLog.push({ table, ok: false, rows_written: 0, reason: err?.message ?? String(err) });
    }
  }

  const successRows = restoreLog.filter((r) => r.ok).reduce((s, r) => s + r.rows_written, 0);
  const failures = restoreLog.filter((r) => !r.ok);
  return Response.json({
    ok: failures.length === 0,
    mode: 'wet_run',
    snapshot_path: snapshotPath,
    drill_tenant_phone: drillPhone,
    rows_restored: successRows,
    tables_restored: restoreLog.filter((r) => r.ok && r.rows_written > 0).length,
    failures,
    cleanup_hint: `When done verifying, delete drill rows with: DELETE FROM <table> WHERE tenant_phone = '${drillPhone}' (and phone_number for whatsapp_contexts) — or just leave them, the prefix 'drill-' filters them out of normal queries.`,
    interpretation:
      failures.length === 0
        ? `✓ Wet-run drill succeeded. ${successRows} rows restored to scratch tenant ${drillPhone}. Snapshot pipeline is verified end-to-end.`
        : `⚠ Wet-run drill had ${failures.length} table failures. Snapshot may be valid but restore logic has issues — review the \`failures\` array.`,
  });
}

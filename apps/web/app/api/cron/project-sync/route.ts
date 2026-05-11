/**
 * Project sync cron — every 2 hours.
 *
 * Walks every active project_connection across all tenants, calls the
 * provider-appropriate adapter, persists a fresh snapshot, and updates
 * last_synced_at. Agents read the latest snapshot when building their
 * tick prompt.
 *
 * On-demand investigation tools (read_repo_file, etc.) still hit the
 * provider APIs directly with the agent's connection credentials —
 * this cron is just for the baseline snapshot.
 */

import { NextResponse } from 'next/server';
import { loadActiveConnections, syncConnection } from '../../_lib/project-sync';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  const conns = await loadActiveConnections();
  let synced = 0;
  let failed = 0;
  const errors: { project: string; error: string }[] = [];

  for (const conn of conns) {
    try {
      const result = await syncConnection(conn);
      if (result.ok) {
        synced++;
      } else {
        failed++;
        if (result.error) errors.push({ project: conn.project_name, error: result.error });
      }
    } catch (err: any) {
      failed++;
      errors.push({ project: conn.project_name, error: err?.message ?? String(err) });
    }
  }

  console.log(`[project-sync] connections=${conns.length} synced=${synced} failed=${failed}`);
  return NextResponse.json({
    ok: true,
    connections: conns.length,
    synced,
    failed,
    errors: errors.slice(0, 5),
  });
}

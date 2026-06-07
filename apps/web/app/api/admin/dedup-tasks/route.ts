/**
 * POST /api/admin/dedup-tasks   Authorization: Bearer <OWNER_API_TOKEN>
 *   { "phone": "<tenant>", "dryRun": true }   (dryRun defaults TRUE)
 *
 * One-time cleanup of the near-duplicate task entities already in the queue
 * (Devon 2026-06-06: the same lecture 4×, a PR + an invoice 2× each). email-sift
 * now dedups new tasks at insert (task-dedup.ts); this collapses the backlog.
 *
 * Groups task ontology_entities by fuzzy match, KEEPS THE OLDEST in each group
 * (the canonical), and deletes the rest. dryRun=true (default) writes nothing —
 * returns exactly what WOULD be removed so the owner reviews first.
 */

import { NextResponse } from 'next/server';
import { tasksAreDuplicate } from '../../_lib/task-dedup';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sb = () => ({ apikey: SUPABASE_KEY!, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' });

export async function POST(request: Request) {
  const auth = request.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const ownerToken = process.env.OWNER_API_TOKEN;
  if (!ownerToken || token !== ownerToken) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return NextResponse.json({ error: 'supabase not configured' }, { status: 500 });
  }

  let body: any = {};
  try { body = await request.json(); } catch { /* empty body ok */ }
  const phone = String(body?.phone ?? '').replace(/[\s\-+()]/g, '');
  if (!phone) return NextResponse.json({ error: 'phone required' }, { status: 400 });
  const dryRun = body?.dryRun !== false; // default TRUE

  // Oldest-first so the FIRST task in each dup-group is the canonical keeper.
  let tasks: Array<{ id: string; name: string; created_at: string }> = [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/ontology_entities?tenant_phone=eq.${phone}&entity_type=eq.task&order=created_at.asc&select=id,name,created_at&limit=1000`,
      { headers: sb() },
    );
    if (!res.ok) return NextResponse.json({ error: `load ${res.status}` }, { status: 502 });
    tasks = await res.json();
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message ?? err) }, { status: 502 });
  }

  const kept: typeof tasks = [];
  const groups: Array<{ canonical: string; removed: string[] }> = [];
  const toDeleteIds: string[] = [];

  for (const t of tasks) {
    const canon = kept.find((k) => tasksAreDuplicate(k.name, t.name));
    if (canon) {
      toDeleteIds.push(t.id);
      let g = groups.find((x) => x.canonical === canon.name);
      if (!g) { g = { canonical: canon.name, removed: [] }; groups.push(g); }
      g.removed.push(t.name);
    } else {
      kept.push(t);
    }
  }

  let deleted = 0;
  if (!dryRun && toDeleteIds.length > 0) {
    for (let i = 0; i < toDeleteIds.length; i += 50) {
      const batch = toDeleteIds.slice(i, i + 50);
      try {
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/ontology_entities?id=in.(${batch.join(',')})`,
          { method: 'DELETE', headers: { ...sb(), Prefer: 'return=minimal' } },
        );
        if (res.ok) deleted += batch.length;
        else console.warn('[dedup-tasks] delete batch failed:', res.status, await res.text());
      } catch (err) {
        console.warn('[dedup-tasks] delete exception:', err);
      }
    }
  }

  return NextResponse.json({
    ok: true,
    dry_run: dryRun,
    total_tasks: tasks.length,
    unique_after: kept.length,
    duplicates_found: toDeleteIds.length,
    deleted: dryRun ? 0 : deleted,
    groups,
    note: dryRun
      ? 'DRY RUN — nothing deleted. POST again with {"dryRun": false} to remove the duplicates (keeps the oldest task in each group).'
      : 'Duplicates removed (kept the oldest task in each group).',
  }, { status: 200 });
}

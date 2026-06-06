/**
 * GET /api/admin/guard-metrics   Authorization: Bearer <OWNER_API_TOKEN>
 *   ?days=7         window (default 7, max 90)
 *   ?phone=<tenant> scope to one tenant (default: all)
 *
 * The readout for the anti-fabrication guards (PR #40/#41). iris-brain stamps
 * each conversation turn's chat_runs.metadata with `capped` (were expensive
 * tools withheld this turn) + `guards` (which guards fired). This aggregates
 * them into the one number Mary asked us to watch:
 *
 *   gate_fired_rate_on_capped → 0   = guards reduced fabrication pressure (real fix)
 *                            → plateau = the guard IS the defense (prompt cosmetic)
 *                            → rising  = guard coverage eroding (model routing around it)
 *
 * Only turns recorded AFTER the instrumentation deploy carry the fields —
 * `turns_capped_instrumented` tells you how much data has accrued. Needs
 * ~200+ capped turns for a stable read.
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Owner-facing conversation surfaces — where the guards run. Excludes sub-call
// surfaces (axis-critic, research, etc.) that aren't owner turns.
const CONVERSATION_SURFACES = ['whatsapp', 'deck', 'telegram', 'sms', 'imessage'];

export async function GET(request: Request) {
  const auth = request.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const ownerToken = process.env.OWNER_API_TOKEN;
  if (!ownerToken || token !== ownerToken) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return NextResponse.json({ error: 'supabase not configured' }, { status: 500 });
  }

  const url = new URL(request.url);
  const days = Math.max(1, Math.min(Number(url.searchParams.get('days')) || 7, 90));
  const phone = (url.searchParams.get('phone') ?? '').replace(/[\s\-+()]/g, '');
  const since = new Date(Date.now() - days * 86400_000).toISOString();

  const filters = [
    `started_at=gte.${since}`,
    `surface=in.(${CONVERSATION_SURFACES.join(',')})`,
    phone ? `tenant_phone=eq.${phone}` : '',
  ].filter(Boolean).join('&');

  let rows: Array<{ metadata: any }> = [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/chat_runs?${filters}&select=metadata&limit=10000`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
    );
    if (!res.ok) return NextResponse.json({ error: `chat_runs query ${res.status}` }, { status: 502 });
    rows = await res.json();
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message ?? err) }, { status: 502 });
  }

  const total = rows.length;
  let cappedKnown = 0;
  let capped = 0;
  let guardFired = 0;
  let guardFiredWhileCapped = 0;
  const byGuard: Record<string, number> = {};

  for (const r of rows) {
    const m = r.metadata ?? {};
    if (typeof m.capped === 'boolean') {
      cappedKnown++;
      if (m.capped) capped++;
    }
    const guards: string[] = Array.isArray(m.guards) ? m.guards : [];
    if (guards.length > 0) {
      guardFired++;
      for (const g of guards) byGuard[g] = (byGuard[g] ?? 0) + 1;
      if (m.capped === true) guardFiredWhileCapped++;
    }
  }

  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

  return NextResponse.json({
    window_days: days,
    scope: phone ? `tenant ${phone}` : 'all tenants',
    turns_total: total,
    turns_instrumented: cappedKnown,
    turns_capped: capped,
    turns_guard_fired: guardFired,
    turns_guard_fired_while_capped: guardFiredWhileCapped,
    gate_fired_rate_overall_pct: pct(guardFired, cappedKnown || total),
    gate_fired_rate_on_capped_pct: pct(guardFiredWhileCapped, capped),
    by_guard: byGuard,
    note: "Watch gate_fired_rate_on_capped_pct: → 0 = guards reduced fabrication (real fix); plateau = the guard is the defense (prompt cosmetic); rising = coverage eroding. Only turns after the instrumentation deploy carry the fields — turns_instrumented shows how much has accrued (want ~200+ capped turns for a stable read).",
  }, { status: 200 });
}

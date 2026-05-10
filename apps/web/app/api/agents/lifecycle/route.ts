/**
 * Story 2.1 — Agent lifecycle API.
 *
 * POST /api/agents/lifecycle
 *   { phone, action: 'start' | 'stop' | 'status' }
 *
 * Wraps the runtime helpers so the deck (or a future operator UI) can
 * start/stop a tenant's agents and check the current status without
 * touching Supabase directly.
 */

import { NextResponse } from 'next/server';
import { startTenantAgents, stopTenantAgents } from '../../_lib/agent-runtime';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(request: Request) {
  try {
    const { phone, action } = await request.json();
    if (!phone || !action) {
      return NextResponse.json({ error: 'phone + action required' }, { status: 400 });
    }
    const cleanPhone = phone.replace(/[\s\-+()]/g, '');

    if (action === 'start') {
      const result = await startTenantAgents(cleanPhone);
      return NextResponse.json({ ok: true, ...result });
    }
    if (action === 'stop') {
      const result = await stopTenantAgents(cleanPhone);
      return NextResponse.json({ ok: true, ...result });
    }
    if (action === 'status') {
      if (!SUPABASE_URL || !SUPABASE_KEY) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/agent_instances?tenant_phone=eq.${cleanPhone}&select=id,status,agent_config_id,metadata,updated_at`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
      );
      const rows = res.ok ? await res.json() : [];
      const summary = rows.reduce((acc: Record<string, number>, r: any) => {
        acc[r.status] = (acc[r.status] ?? 0) + 1;
        return acc;
      }, {});
      return NextResponse.json({ ok: true, total: rows.length, byStatus: summary, instances: rows });
    }
    return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    console.error('[agents/lifecycle] error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

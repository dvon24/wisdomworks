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
import { startTenantAgents, stopTenantAgents, tickAgent } from '../../_lib/agent-runtime';

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
    if (action === 'tick') {
      // Manual tick — fires every running agent for THIS tenant only.
      // Used for testing without waiting for the 15-min cron.
      if (!SUPABASE_URL || !SUPABASE_KEY) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
      const instRes = await fetch(
        `${SUPABASE_URL}/rest/v1/agent_instances?tenant_phone=eq.${cleanPhone}&status=eq.running&select=id,tenant_phone,agent_config_id,status,metadata`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
      );
      if (!instRes.ok) return NextResponse.json({ error: 'failed to load instances' }, { status: 500 });
      const instances = await instRes.json();
      if (instances.length === 0) {
        return NextResponse.json({ ok: true, ticked: 0, note: 'No running agents to tick. Call action=start first.' });
      }
      const cfgIds = Array.from(new Set(instances.map((i: any) => i.agent_config_id)));
      const cfgRes = await fetch(
        `${SUPABASE_URL}/rest/v1/agent_configs?id=in.(${cfgIds.join(',')})&select=id,agent_name,agent_role,model_routing,output_channels,config`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
      );
      const cfgs = cfgRes.ok ? await cfgRes.json() : [];
      const cfgById = new Map(cfgs.map((c: any) => [c.id, c]));
      let ticked = 0;
      let failed = 0;
      // Run ticks in parallel — they're independent and the lambda has 30s.
      await Promise.all(instances.map(async (inst: any) => {
        const cfg: any = cfgById.get(inst.agent_config_id);
        if (!cfg) { failed++; return; }
        try { await tickAgent(inst, cfg); ticked++; } catch { failed++; }
      }));
      return NextResponse.json({ ok: true, ticked, failed });
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

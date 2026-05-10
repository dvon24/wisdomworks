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
import { startTenantAgents, stopTenantAgents, tickAgent, maybeSendTeamDigest, computeCadence } from '../../_lib/agent-runtime';
import { saveSnapshot, recoverFromSnapshot, recoveryTest } from '../../_lib/state-recovery';

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
      // Manual tick — fires every agent for THIS tenant. Auto-starts any
      // 'ready' agents so the user doesn't have to know to call 'start' first.
      if (!SUPABASE_URL || !SUPABASE_KEY) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });

      // Auto-start: flip any ready agents to running before ticking.
      const autoStart = await startTenantAgents(cleanPhone);

      const instRes = await fetch(
        `${SUPABASE_URL}/rest/v1/agent_instances?tenant_phone=eq.${cleanPhone}&status=eq.running&select=id,tenant_phone,agent_config_id,status,metadata`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
      );
      if (!instRes.ok) return NextResponse.json({ error: 'failed to load instances' }, { status: 500 });
      const instances = await instRes.json();
      if (instances.length === 0) {
        return NextResponse.json({ ok: true, ticked: 0, note: 'No agent_instances exist for this tenant. Re-run onboarding.' });
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
      // After manual tick, also try a digest — useful for testing the flow.
      const cadence = await computeCadence(cleanPhone);
      const digest = await maybeSendTeamDigest(cleanPhone, cadence);
      return NextResponse.json({ ok: true, ticked, failed, autoStarted: autoStart.started, digest });
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
    if (action === 'snapshot') {
      // Manual snapshot of every running instance for the tenant
      if (!SUPABASE_URL || !SUPABASE_KEY) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
      const instRes = await fetch(
        `${SUPABASE_URL}/rest/v1/agent_instances?tenant_phone=eq.${cleanPhone}&select=id,tenant_phone,state_data,metadata,nats_subjects,signal_connections`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
      );
      const instances = instRes.ok ? await instRes.json() : [];
      const ids: string[] = [];
      for (const inst of instances) {
        const id = await saveSnapshot(inst, 'manual');
        if (id) ids.push(id);
      }
      return NextResponse.json({ ok: true, snapshots: ids.length, ids });
    }

    if (action === 'recover') {
      // Recover a specific instance from its latest snapshot at-or-before
      // the optional point_in_time. Body shape: { phone, action, instance_id, point_in_time? }
      const { instance_id, point_in_time } = await (async () => {
        try { return await request.clone().json(); } catch { return {}; }
      })();
      if (!instance_id) return NextResponse.json({ error: 'instance_id required' }, { status: 400 });
      const result = await recoverFromSnapshot(instance_id, point_in_time ? new Date(point_in_time) : undefined);
      return NextResponse.json(result);
    }

    if (action === 'recovery_test') {
      // Pick the first running instance for the tenant and run the
      // snapshot → corrupt → recover → verify cycle. Asserts NFR34 SLA.
      if (!SUPABASE_URL || !SUPABASE_KEY) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
      const instRes = await fetch(
        `${SUPABASE_URL}/rest/v1/agent_instances?tenant_phone=eq.${cleanPhone}&select=id&limit=1`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
      );
      const insts = instRes.ok ? await instRes.json() : [];
      if (insts.length === 0) return NextResponse.json({ error: 'no agent_instances for this tenant' }, { status: 400 });
      const result = await recoveryTest(insts[0].id);
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    console.error('[agents/lifecycle] error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

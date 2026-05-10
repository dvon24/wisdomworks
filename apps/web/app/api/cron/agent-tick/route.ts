/**
 * Story 2.1 — Agent tick cron.
 *
 * Wakes every running agent every 15 minutes (schedule lives in vercel.json).
 * Each tick runs the agent's primary loop placeholder and logs a row to
 * agent_runs. Foundation for the full LangGraph runtime in 2.1b.
 */

import { NextResponse } from 'next/server';
import { tickRunningAgents } from '../../_lib/agent-runtime';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

export async function GET(request: Request) {
  // Vercel sets this header on cron requests; reject anything else in prod.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  try {
    const result = await tickRunningAgents();
    console.log(`[agent-tick] tenants=${result.tenants} ticked=${result.ticked} failed=${result.failed}`);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[agent-tick] error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

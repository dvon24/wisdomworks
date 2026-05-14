/**
 * Story 2b.4 / 2b.5 / 2b.6 — Vapi webhook.
 *
 * Vapi POSTs here for two purposes:
 *
 *   1. tool-calls — during a live call, when the assistant decides
 *      to call a function (book_appointment, find_booking_availability,
 *      etc), Vapi sends the function name + args here. We dispatch
 *      to our existing executeTool and return the result. The voice
 *      agent uses the result in its next utterance.
 *
 *   2. end-of-call-report — when a call wraps up, Vapi posts the
 *      summary + transcript + cost. We persist to voice_calls and
 *      enqueue an owner-facing notification.
 *
 * Auth: Vapi signs requests with a shared secret. We verify against
 * VAPI_WEBHOOK_SECRET (set in both Vapi dashboard + Vercel env).
 */

import { NextResponse } from 'next/server';
import type { ToolCall } from '../whatsapp/agent-tools';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30; // tool calls must complete fast (under 5s ideal)

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supaHeaders = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

export async function POST(request: Request) {
  // Vapi signs webhooks with a shared secret in the X-Vapi-Secret header.
  // If we have one configured, enforce it.
  const expectedSecret = process.env.VAPI_WEBHOOK_SECRET;
  if (expectedSecret) {
    const got = request.headers.get('x-vapi-secret');
    if (got !== expectedSecret) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  // Vapi message shapes vary by event type — type field discriminates
  const messageType = body?.message?.type ?? body?.type;
  const phoneNumber = body?.message?.phoneNumber?.number ?? body?.phoneNumber?.number;
  const callId = body?.message?.call?.id ?? body?.call?.id;

  // Resolve which tenant this call belongs to (via phone_number on tenant_voice_config)
  const tenantPhone = phoneNumber ? await resolveTenantForNumber(phoneNumber) : null;

  if (messageType === 'tool-calls' || messageType === 'function-call') {
    // Live tool call during the conversation — run our agent tool
    return await handleToolCall({ body, tenantPhone, callId });
  }

  if (messageType === 'end-of-call-report' || messageType === 'status-update') {
    return await handleEndOfCall({ body, tenantPhone, callId });
  }

  if (messageType === 'transcript' || messageType === 'speech-update') {
    // Streaming transcript fragments — we don't persist mid-call,
    // just acknowledge so Vapi doesn't retry
    return NextResponse.json({ ok: true });
  }

  // Unknown event — ack and move on
  console.log(`[vapi-webhook] unhandled message type: ${messageType}`);
  return NextResponse.json({ ok: true });
}

async function resolveTenantForNumber(phoneNumber: string): Promise<string | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_voice_config?phone_number=eq.${encodeURIComponent(phoneNumber)}&status=eq.active&select=tenant_phone&limit=1`,
      { headers: supaHeaders() },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return rows[0]?.tenant_phone ?? null;
  } catch {
    return null;
  }
}

async function handleToolCall(input: {
  body: any;
  tenantPhone: string | null;
  callId: string | null;
}): Promise<NextResponse> {
  const toolCalls = input.body?.message?.toolCalls ?? input.body?.message?.functionCall ?? [];
  const calls: any[] = Array.isArray(toolCalls) ? toolCalls : [toolCalls];
  if (!input.tenantPhone) {
    return NextResponse.json({
      results: calls.map((c) => ({
        toolCallId: c.id,
        result: 'Voice agent could not identify tenant — call routing misconfigured.',
      })),
    });
  }

  // Lazy-load the tool runtime to keep cold-start small
  const { executeTool } = await import('../whatsapp/agent-tools');
  const { loadConnectionsForPhone } = await import('@wisdomworks/shared');
  const { loadUserContext } = await import('../whatsapp/context-store');
  const connections = await loadConnectionsForPhone(input.tenantPhone);
  const user = await loadUserContext(input.tenantPhone, 'Voice Caller');

  const results = [];
  for (const tc of calls) {
    const fn = tc.function ?? tc;
    const name: string = fn.name;
    let args: Record<string, any> = {};
    try {
      args = typeof fn.arguments === 'string' ? JSON.parse(fn.arguments) : (fn.arguments ?? {});
    } catch {
      args = {};
    }
    const call: ToolCall = { name, input: args };
    try {
      const r = await executeTool(call, connections, user);
      results.push({
        toolCallId: tc.id ?? tc.toolCallId,
        result: r.content.slice(0, 2000),
      });
    } catch (err: any) {
      results.push({
        toolCallId: tc.id ?? tc.toolCallId,
        result: `Tool error: ${err?.message ?? String(err)}`,
      });
    }
  }
  return NextResponse.json({ results });
}

async function handleEndOfCall(input: {
  body: any;
  tenantPhone: string | null;
  callId: string | null;
}): Promise<NextResponse> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return NextResponse.json({ ok: true });
  if (!input.tenantPhone || !input.callId) return NextResponse.json({ ok: true });

  const msg = input.body?.message ?? input.body;
  const callerNumber = msg?.call?.customer?.number ?? msg?.customer?.number ?? null;
  const startedAt = msg?.startedAt ?? msg?.call?.startedAt;
  const endedAt = msg?.endedAt ?? msg?.call?.endedAt;
  const durationSec = startedAt && endedAt
    ? Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000)
    : null;
  const transcript: string | undefined = msg?.transcript ?? msg?.artifact?.transcript;
  const summary: string | undefined = msg?.summary ?? msg?.analysis?.summary;
  const costUsd: number | undefined = typeof msg?.cost === 'number' ? msg.cost : undefined;
  const endedReason: string | undefined = msg?.endedReason;

  const outcome =
    endedReason === 'customer-ended-call' || endedReason === 'assistant-ended-call' ? 'completed'
    : endedReason === 'voicemail' ? 'voicemail'
    : endedReason === 'no-answer' ? 'no_answer'
    : 'failed';

  // Look up known caller (recurring client recognition — Story 2b.6)
  let knownPersonId: string | null = null;
  if (callerNumber) {
    try {
      const cleanCaller = callerNumber.replace(/[\s\-+()]/g, '');
      const lookup = await fetch(
        `${SUPABASE_URL}/rest/v1/known_people?tenant_phone=eq.${input.tenantPhone}&phone=eq.${cleanCaller}&select=id&limit=1`,
        { headers: supaHeaders() },
      );
      if (lookup.ok) {
        const rows = await lookup.json();
        knownPersonId = rows[0]?.id ?? null;
      }
    } catch {}
  }

  // Persist
  try {
    await fetch(
      `${SUPABASE_URL}/rest/v1/voice_calls?on_conflict=vapi_call_id`,
      {
        method: 'POST',
        headers: { ...supaHeaders(), Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({
          tenant_phone: input.tenantPhone,
          vapi_call_id: input.callId,
          caller_number: callerNumber,
          caller_known_person_id: knownPersonId,
          duration_seconds: durationSec,
          outcome,
          transcript: transcript?.slice(0, 100_000) ?? null,
          summary: summary?.slice(0, 4000) ?? null,
          cost_usd: costUsd ?? null,
          started_at: startedAt ?? new Date().toISOString(),
          ended_at: endedAt ?? new Date().toISOString(),
          metadata: { ended_reason: endedReason },
        }),
      },
    );
  } catch (err) {
    console.warn('[vapi-webhook] voice_calls insert failed:', err);
  }

  // Notify owner with a concise call summary
  try {
    const { enqueueNotification } = await import('../../_lib/notifications');
    const callerLabel = callerNumber ?? 'unknown caller';
    const sevByOutcome = outcome === 'voicemail' || outcome === 'completed' ? 'medium' : 'low';
    const minutes = durationSec ? `${Math.floor(durationSec / 60)}m${durationSec % 60}s` : 'unknown duration';
    const costLabel = costUsd ? ` · ~$${costUsd.toFixed(3)}` : '';
    await enqueueNotification({
      tenantPhone: input.tenantPhone,
      kind: 'agent_observation',
      severity: sevByOutcome,
      title: `📞 Call from ${callerLabel} (${minutes}${costLabel})`,
      body: summary ?? transcript?.slice(0, 400) ?? `Outcome: ${outcome}`,
      sourceAgent: 'voice',
      sourceId: input.callId,
      topicKeywords: ['voice call', callerLabel],
    });
  } catch (err) {
    console.warn('[vapi-webhook] notification enqueue failed:', err);
  }

  return NextResponse.json({ ok: true });
}

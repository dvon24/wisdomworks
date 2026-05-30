/**
 * Iris debug / audit endpoint.
 *
 * POST /api/debug/iris
 * { phone: "491703604562", message: "test message", surface?: "whatsapp",
 *   persist?: false }
 *
 * Runs the SAME Iris brain as WhatsApp/deck, but with an IrisTrace attached,
 * so the response includes a full structured audit of the turn:
 *   - which tools were available + how many
 *   - every tool call (input, success, result preview, owner_confirmation, ms)
 *   - every gate that fired (recital stripper, attribution, unprompted-topic,
 *     fabrication guard, Axis critic flagged/revised/re-audit-failed, etc.)
 *   - token + cost breakdown, cache hit %, iterations, total duration
 *   - draft reply (model's first text) vs final reply (what ships)
 *
 * Auth: same owner gate as the rest of the deck API. Hit it as the owner
 * (session cookie) or with `Authorization: Bearer $OWNER_API_TOKEN`.
 *
 * NOTE: this is NOT read-only. The brain executes real tools and (unless
 * persist=false) writes conversation history / runs disposition mining like
 * any other turn. Pass `persist: false` to run against a throwaway phone or
 * to avoid polluting the real owner's history — see the warning in the
 * response when persistence happened.
 */

import { NextResponse } from 'next/server';
import { loadUserContext } from '../../webhooks/whatsapp/context-store';
import { generateIrisReply, createIrisTrace } from '../../webhooks/whatsapp/iris-brain';
import { requireOwnerAuth } from '../../_lib/api-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

type Surface = 'whatsapp' | 'deck' | 'telegram' | 'sms' | 'imessage';
const VALID_SURFACES: Surface[] = ['whatsapp', 'deck', 'telegram', 'sms', 'imessage'];

export async function POST(request: Request) {
  const startedAt = Date.now();
  try {
    // Phone must be readable from the URL query for the Bearer-token admin
    // path: authenticatePhone() reads `?phone=` from the URL and explicitly
    // does NOT consume the request body (api-auth.ts). So we accept it from
    // the query first (canonical for CLI/server-to-server), then fall back
    // to the body for cookie-authed deck callers.
    const url = new URL(request.url);
    const body = await request.json();
    const phoneRaw = (url.searchParams.get('phone') || body.phone || '').toString();
    const message = (body.message || '').toString().trim();
    const surface: Surface = VALID_SURFACES.includes(body.surface) ? body.surface : 'whatsapp';
    // Default to NOT persisting — a debug call shouldn't pollute the tenant's
    // history / usage stats / mined operating-manual unless explicitly asked.
    const persist = body.persist === true;

    if (!phoneRaw || !message) {
      return NextResponse.json({ error: 'phone and message required' }, { status: 400 });
    }

    const phone = phoneRaw.replace(/[\s\-+()]/g, '');

    // Same owner deadbolt as /api/chat — owner session or Bearer OWNER_API_TOKEN.
    const denied = await requireOwnerAuth(request, phone);
    if (denied) return denied;

    const user = await loadUserContext(phone, body.name || 'Owner');
    const trace = createIrisTrace(surface);
    const reply = await generateIrisReply(message, user, surface, {
      trace,
      skipPersistence: !persist,
    });

    // Compact human-readable summary so you can eyeball it without parsing JSON.
    const summary = {
      tools_called: trace.steps.map((s) => s.tool),
      gates_fired: trace.gates.map((g) => `${g.gate}:${g.action}`),
      iterations: trace.iterations,
      hit_cap: trace.hitIterationCap,
      tokens_in: trace.tokens.uncachedIn + trace.tokens.cacheWriteIn + trace.tokens.cacheReadIn,
      tokens_out: trace.tokens.totalOut,
      cache_hit_pct: trace.tokens.cachedPct,
      cost_usd: Number(trace.costUsd.toFixed(4)),
      duration_ms: trace.durationMs,
      draft_changed_by_gates: trace.draftReply !== trace.finalReply,
    };

    return NextResponse.json({
      reply,
      summary,
      trace,
      persisted: persist,
      note: persist
        ? 'persist=true — this wrote conversation history, usage stats, and ran disposition/RAG mining for this phone, exactly like a real turn.'
        : 'persist=false (default) — tools still EXECUTED (a write/send tool would have acted), but no history/usage/mining was written back.',
      endpoint_ms: Date.now() - startedAt,
    });
  } catch (err) {
    console.error('[debug/iris] Error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

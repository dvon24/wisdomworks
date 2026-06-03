/**
 * LLM cost tracker — persists every Anthropic API call across all surfaces
 * into the `chat_runs` table so monthly usage actually reflects total spend.
 *
 * Originally scoped to iris-brain chat turns (commit 188212a). Expanded
 * 2026-05-27 to cover every owner-facing AND background LLM call so the
 * command deck stops under-reporting by 60-70%. Devon's transcript:
 * "I'm getting charged $10/day but the deck says $23.61 in usage" —
 * that gap is untracked cron LLM calls.
 *
 * Fire-and-forget from each call site. Never throws into the caller's
 * loop — a failed insert must not break the response/cron.
 *
 * The `surface` column is just TEXT in the DB (no CHECK constraint), so
 * adding new surfaces requires only widening the TypeScript union below.
 * Existing `get_my_spend` + `get_spend_breakdown` tools sum chat_runs by
 * tenant_phone, so new rows automatically flow into the dashboard.
 *
 * PII redaction (Story 6.5) — previews still get scrubbed before write.
 */

import { redactPII } from '@wisdomworks/shared';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * All surfaces that fire Anthropic calls. Owner-facing surfaces first,
 * background/cron surfaces second. Adding a new surface here doesn't
 * require a migration — the DB column is just TEXT.
 */
export type LlmSurface =
  // Owner-facing real-time
  | 'whatsapp' | 'deck' | 'telegram' | 'sms' | 'imessage'
  // Owner-facing background (cron-fired)
  | 'daily-briefing' | 'digest' | 'email-sift'
  // Per-turn helpers (run on owner messages)
  | 'disposition-mining' | 'axis-critic' | 'axis-critic-revision'
  // Workflow / agent surfaces
  | 'workflow-step' | 'agent-tick'
  // Customer-facing (SMB framework — a customer texts the business; cost is the tenant's)
  | 'customer-reply'
  // Content generators
  | 'marketing-drafts' | 'email-followup' | 'research' | 'document-analysis' | 'photo-analysis'
  // Knowledge layer
  | 'behavioral-rag-embed' | 'knowledge-base';

export interface ChatRunRecord {
  tenantPhone: string;
  surface: LlmSurface;
  modelUsed: string;
  iterations: number;
  tokensIn: number;
  tokensOut: number;
  cachedTokensIn: number;
  costUsd: number;
  toolsUsed: string[];
  durationMs: number;
  userMessagePreview?: string;
  assistantReplyPreview?: string;
}

// ─── Pricing (USD per million tokens) ────────────────────────────────────
// Single source of truth — all surfaces use estimateLlmCost so a model
// price change updates everywhere at once.
//
// Cache-read is 10% of base input price; cache-write is 25% MORE than
// base input (1.25x). Anthropic pricing tier as of 2026-05-27.

interface ModelPricing {
  in: number;       // $ / M input tokens
  out: number;      // $ / M output tokens
  cacheRead: number;
  cacheWrite: number;
}

const PRICING: Record<string, ModelPricing> = {
  'claude-sonnet-4-6': { in: 3, out: 15, cacheRead: 0.30, cacheWrite: 3.75 },
  // Opus 4.8 is the LIVE Opus (model-registry.ts). It was MISSING here, so
  // estimateLlmCost fell back to Sonnet and undercounted every Opus call ~5x.
  // Conservative Anthropic list ($15/$75); confirm vs the actual invoice.
  'claude-opus-4-8': { in: 15, out: 75, cacheRead: 1.50, cacheWrite: 18.75 },
  'claude-opus-4-7': { in: 15, out: 75, cacheRead: 1.50, cacheWrite: 18.75 },
  // Previous-gen IDs — historical chat_runs rows still reference these.
  'claude-opus-4-20250514': { in: 15, out: 75, cacheRead: 1.50, cacheWrite: 18.75 },
  'claude-sonnet-4-20250514': { in: 3, out: 15, cacheRead: 0.30, cacheWrite: 3.75 },
  // Haiku 4.5 — used by axis-critic for fast/cheap audits.
  'claude-haiku-4-5-20251001': { in: 1, out: 5, cacheRead: 0.10, cacheWrite: 1.25 },
  'claude-haiku-4-5': { in: 1, out: 5, cacheRead: 0.10, cacheWrite: 1.25 },
};

/**
 * Estimate cost in USD for a given model + token counts. Falls back to
 * Sonnet pricing if the model isn't in the table (safer over-estimate
 * than silently zero).
 */
export function estimateLlmCost(args: {
  model: string;
  uncachedIn: number;
  cacheReadIn?: number;
  cacheWriteIn?: number;
  tokensOut: number;
}): number {
  const p = PRICING[args.model] ?? PRICING['claude-sonnet-4-6']!;
  return (
    args.uncachedIn * p.in +
    (args.cacheReadIn ?? 0) * p.cacheRead +
    (args.cacheWriteIn ?? 0) * p.cacheWrite +
    args.tokensOut * p.out
  ) / 1_000_000;
}

/**
 * Convenience for callers that just have totals + a model name.
 * Computes cost internally so call sites don't have to import PRICING.
 */
export async function recordLlmCall(args: {
  tenantPhone: string;
  surface: LlmSurface;
  model: string;
  tokensIn: number;
  tokensOut: number;
  cachedTokensIn?: number;
  durationMs?: number;
  toolsUsed?: string[];
  userPreview?: string;
  assistantPreview?: string;
}): Promise<void> {
  const cost = estimateLlmCost({
    model: args.model,
    uncachedIn: Math.max(0, args.tokensIn - (args.cachedTokensIn ?? 0)),
    cacheReadIn: args.cachedTokensIn ?? 0,
    tokensOut: args.tokensOut,
  });
  await recordChatRun({
    tenantPhone: args.tenantPhone,
    surface: args.surface,
    modelUsed: args.model,
    iterations: 1,
    tokensIn: args.tokensIn,
    tokensOut: args.tokensOut,
    cachedTokensIn: args.cachedTokensIn ?? 0,
    costUsd: cost,
    toolsUsed: args.toolsUsed ?? [],
    durationMs: args.durationMs ?? 0,
    userMessagePreview: args.userPreview,
    assistantReplyPreview: args.assistantPreview,
  });
}

export async function recordChatRun(run: ChatRunRecord): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    const cleanPhone = run.tenantPhone.replace(/[\s\-+()]/g, '');
    const userPreview = redactPII(run.userMessagePreview);
    const assistantPreview = redactPII(run.assistantReplyPreview);
    await fetch(`${SUPABASE_URL}/rest/v1/chat_runs`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        tenant_phone: cleanPhone,
        surface: run.surface,
        model_used: run.modelUsed,
        iterations: run.iterations,
        tokens_in: run.tokensIn,
        tokens_out: run.tokensOut,
        cached_tokens_in: run.cachedTokensIn,
        cost_usd: run.costUsd,
        tools_used: run.toolsUsed,
        duration_ms: run.durationMs,
        user_message_preview: userPreview.redacted || null,
        assistant_reply_preview: assistantPreview.redacted || null,
        // Stash redaction telemetry in metadata so audit log / compliance
        // reports can show "this row had PII scrubbed" without needing a
        // new column on chat_runs.
        metadata: (userPreview.redactedAny || assistantPreview.redactedAny)
          ? {
              pii_redacted: true,
              pii_hits_user: userPreview.hits,
              pii_hits_assistant: assistantPreview.hits,
            }
          : {},
      }),
    });
  } catch (err) {
    console.warn('[chat-cost-tracker] insert failed:', err);
  }
}

/**
 * Chat cost tracker — persists each iris-brain turn (WhatsApp or deck) into
 * the `chat_runs` table so monthly usage actually reflects the biggest
 * source of token spend.
 *
 * Fire-and-forget from the brain. Never throws into the chat loop — a
 * failed insert must not break the user's reply.
 *
 * Story 6.5 — previews are redacted via redactPII before write so PII
 * (emails, phones, SSNs, credit cards, street addresses, IPs) is replaced
 * with type markers. The owner's verbatim text never lands in long-lived
 * storage from this path.
 */

import { redactPII } from '@wisdomworks/shared';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export interface ChatRunRecord {
  tenantPhone: string;
  surface: 'whatsapp' | 'deck' | 'telegram' | 'sms' | 'imessage';
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

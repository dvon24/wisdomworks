/**
 * Chat cost tracker — persists each iris-brain turn (WhatsApp or deck) into
 * the `chat_runs` table so monthly usage actually reflects the biggest
 * source of token spend.
 *
 * Fire-and-forget from the brain. Never throws into the chat loop — a
 * failed insert must not break the user's reply.
 */

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
        user_message_preview: run.userMessagePreview ?? null,
        assistant_reply_preview: run.assistantReplyPreview ?? null,
      }),
    });
  } catch (err) {
    console.warn('[chat-cost-tracker] insert failed:', err);
  }
}

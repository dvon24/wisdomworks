/**
 * Iris Brain — shared AI loop used by both the WhatsApp webhook and the
 * Command Deck /api/chat endpoint, so both surfaces stay in sync (same
 * system prompt, same tool calls, same conversation history).
 *
 * Caller responsibilities:
 *   1. Load UserContext (loadUserContext)
 *   2. Append the user's new message to conversationHistory
 *   3. Call generateIrisReply(text, user)
 *   4. The brain saves context internally and returns the assistant's text
 */

import { loadConnectionsForPhone } from '@wisdomworks/shared';
import {
  buildContextMessages,
  saveUserContext,
  type UserContext,
} from './context-store';
import { buildSystemPrompt } from './system-prompt';
import { buildToolList, executeTool, type ToolCall } from './agent-tools';
import { recordChatRun } from '../../_lib/chat-cost-tracker';

const MAX_ITERATIONS = 8;
// Sonnet 4.6 — same $3/$15 per MTok as Sonnet 4 but supports adaptive
// thinking + interleaved thinking between tool calls. Pure capability
// upgrade at zero cost change.
const SONNET_MODEL = 'claude-sonnet-4-6';
// Adaptive thinking budget. Claude decides how much of this to spend
// on thinking vs final text. 4096 gives plenty of headroom for
// multi-step reasoning without runaway latency on simple chats.
const MAX_TOKENS = 4096;
// Anthropic Sonnet 4.6 published rates per 1M tokens.
// Per docs: cache writes are 1.25× base, cache reads are 0.1× base.
const SONNET_IN_PER_M = 3;
const SONNET_OUT_PER_M = 15;
const SONNET_CACHE_WRITE_PER_M = 3.75;
const SONNET_CACHE_READ_PER_M = 0.3;

function estimateChatCost(uncachedIn: number, cacheWriteIn: number, cacheReadIn: number, totalOut: number): number {
  return (
    uncachedIn * SONNET_IN_PER_M +
    cacheWriteIn * SONNET_CACHE_WRITE_PER_M +
    cacheReadIn * SONNET_CACHE_READ_PER_M +
    totalOut * SONNET_OUT_PER_M
  ) / 1_000_000;
}

// Per-surface effort levels. Sonnet 4.6 defaults to `high` which Anthropic's
// own docs warn "can cause unexpected latency" — but `low` had the opposite
// problem: Iris skipped tool calls and shallow-replied to multi-step asks
// (e.g. attached weather image for race weekend → reply ignored the image,
// said something about being "tenacious" with iterations=0 and no tools
// used). `medium` is the Sonnet 4.6 recommended default: balances cost
// and reasoning quality.
//   - whatsapp / sms / imessage / telegram: realtime, owner-facing → medium
//   - deck: async owner-facing webapp → medium (was already)
// Drop to `low` per-call only when the message is clearly trivial (short
// "thanks", "ok", "cool") — that's a future surgical optimization.
type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
const EFFORT_BY_SURFACE: Record<'whatsapp' | 'deck' | 'telegram' | 'sms' | 'imessage', EffortLevel> = {
  whatsapp: 'medium',
  sms: 'medium',
  imessage: 'medium',
  telegram: 'medium',
  deck: 'medium',
};

async function callAnthropic(
  apiKey: string,
  systemPrompt: string,
  messages: any[],
  tools: any[],
  effort: EffortLevel,
): Promise<any> {
  // Prompt caching strategy (3 of the 4 available breakpoints):
  //   1. tools[-1].cache_control — caches the tool definitions (stable per tenant)
  //   2. system[0].cache_control — caches tools + system prompt prefix
  //   3. top-level cache_control — automatic caching moves the breakpoint to the
  //      last message each request, so the growing conversation tail (multi-iter
  //      tool loops + multi-turn history) reads from cache on subsequent calls.
  // Hierarchy is tools → system → messages, so each breakpoint covers the
  // prior layers transitively. Cache reads are 10% of base; writes are 125%.
  //
  // Thinking: adaptive mode lets Claude decide whether/how much to think
  // per request. On Sonnet 4.6 this also auto-enables interleaved thinking
  // between tool calls — big win for multi-step reasoning in tool loops.
  // Thinking blocks are preserved in conversation history by default on
  // 4.6+ so prompt-cache prefixes stay valid across turns.
  const body: any = {
    model: SONNET_MODEL,
    max_tokens: MAX_TOKENS,
    thinking: { type: 'adaptive' },
    output_config: { effort },
    cache_control: { type: 'ephemeral' },
    system: [
      { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
    ],
    messages,
  };
  if (tools.length > 0) {
    // Mark the last tool definition for caching so the tools array is
    // cached as the first layer (cheaper than re-shipping ~12kb of tool
    // schemas on every iteration of the tool loop).
    const toolsWithCache = tools.map((t, i) =>
      i === tools.length - 1 ? { ...t, cache_control: { type: 'ephemeral' } } : t,
    );
    body.tools = toolsWithCache;
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Anthropic API error: ${JSON.stringify(error)}`);
  }
  return response.json();
}

export async function generateIrisReply(
  text: string,
  user: UserContext,
  surface: 'whatsapp' | 'deck' | 'telegram' | 'sms' | 'imessage' = 'whatsapp',
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return `Hi ${user.name}! My AI brain is being set up — I'll be fully operational soon.`;
  }

  user.conversationHistory.push({
    role: 'user',
    content: text,
    timestamp: new Date().toISOString(),
  });

  const connections = await loadConnectionsForPhone(user.phoneNumber);
  // Bind the persist-refreshed-token callback onto each Google connection
  // so router-mediated calls (Gmail/Calendar via listEmails / listCalendarEvents)
  // also persist refreshed tokens — same loop the direct adapter calls
  // (GSC/GA/Sheets) get via googleIntegrationCtx.
  const { persistRefreshedAccessToken } = await import('../../_lib/oauth-token-store');
  for (const c of connections) {
    if (c.provider !== 'google') continue;
    (c as any).onTokenRefreshed = (newAccessToken: string, expiresAtIso: string) => {
      void persistRefreshedAccessToken({
        phoneNumber: user.phoneNumber,
        provider: c.provider,
        service: c.service,
        newAccessToken,
        expiresAtIso,
      });
    };
  }
  console.log(`[iris-${surface}] Loaded ${connections.length} connection(s) for ${user.phoneNumber}: ${connections.map((c) => `${c.provider}/${c.service}`).join(', ') || 'none'}`);
  const tools = buildToolList(connections);
  const messages: any[] = buildContextMessages(user);
  // Build the system prompt then append the owner-disposition block —
  // the operating manual auto-mined from past interactions. Renders
  // into every Iris turn so corrections / preferences / triggers carry
  // forward without re-relearning.
  const baseSystemPrompt = buildSystemPrompt(user, connections);
  const { buildDispositionContext } = await import('../../_lib/disposition-mining');
  const dispositionBlock = await buildDispositionContext(user.phoneNumber, { limit: 12 });
  const systemPrompt = baseSystemPrompt + dispositionBlock;

  // Accumulate token + tool usage across every Anthropic round-trip in the loop.
  // Per Anthropic's response schema:
  //   usage.input_tokens               = tokens AFTER the last cache breakpoint (uncached)
  //   usage.cache_creation_input_tokens = tokens being WRITTEN to cache (1.25× rate)
  //   usage.cache_read_input_tokens     = tokens READ from cache (0.1× rate)
  // Total prompt tokens = sum of all three; we track each separately for
  // accurate cost attribution.
  let uncachedTokensIn = 0;
  let cacheWriteTokensIn = 0;
  let cacheReadTokensIn = 0;
  let totalTokensOut = 0;
  const toolsUsed: string[] = [];
  const startedAt = Date.now();

  const accumulate = (usage: any) => {
    uncachedTokensIn += usage?.input_tokens ?? 0;
    cacheWriteTokensIn += usage?.cache_creation_input_tokens ?? 0;
    cacheReadTokensIn += usage?.cache_read_input_tokens ?? 0;
    totalTokensOut += usage?.output_tokens ?? 0;
  };

  const effort = EFFORT_BY_SURFACE[surface] ?? 'medium';

  try {
    let iteration = 0;
    let response = await callAnthropic(apiKey, systemPrompt, messages, tools, effort);
    accumulate(response.usage);

    while (response.stop_reason === 'tool_use' && iteration < MAX_ITERATIONS) {
      iteration++;
      const toolUseBlocks = response.content.filter((b: any) => b.type === 'tool_use');
      messages.push({ role: 'assistant', content: response.content });

      const toolResults: any[] = [];
      for (const block of toolUseBlocks) {
        const call: ToolCall = { name: block.name, input: block.input };
        console.log(`[iris-${surface}] Tool call: ${call.name}`, call.input);
        toolsUsed.push(call.name);
        const result = await executeTool(call, connections, user);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: result.content,
          is_error: !result.success,
        });
      }
      messages.push({ role: 'user', content: toolResults });
      response = await callAnthropic(apiKey, systemPrompt, messages, tools, effort);
      accumulate(response.usage);
    }

    // If the loop exited while still in tool_use (hit cap, or model wanted to keep going),
    // make one more call WITHOUT tools so it's forced to produce a text reply.
    if (response.stop_reason === 'tool_use') {
      console.warn(`[iris-${surface}] Tool loop hit cap at iteration ${iteration} — forcing final text.`);
      messages.push({ role: 'assistant', content: response.content });
      messages.push({
        role: 'user',
        content: 'Summarize what you just did in one or two short sentences for the user. No more tool calls.',
      });
      response = await callAnthropic(apiKey, systemPrompt, messages, [], effort);
      accumulate(response.usage);
    }

    const textBlock = response.content.find((b: any) => b.type === 'text');
    const assistantMessage = textBlock?.text ?? "I couldn't process that. Try again?";

    // NOTE: we don't push the assistant message to conversationHistory here.
    // The caller (webhook → sendWhatsAppReply → sendOwnerMessage) appends to
    // conversation_history as the message actually leaves the system. This
    // keeps cron + reactive paths writing through the same code path, so
    // Iris's own outputs (including proactive sends) all land in her
    // memory without duplication.
    await saveUserContext(user);

    const totalTokensIn = uncachedTokensIn + cacheWriteTokensIn + cacheReadTokensIn;
    const cachedPct = totalTokensIn > 0 ? Math.round((cacheReadTokensIn / totalTokensIn) * 100) : 0;
    const costUsd = estimateChatCost(uncachedTokensIn, cacheWriteTokensIn, cacheReadTokensIn, totalTokensOut);
    console.log(
      `[iris-${surface}] effort=${effort} | iters=${iteration} | tokens: ${totalTokensIn}in/${totalTokensOut}out (uncached ${uncachedTokensIn}, write ${cacheWriteTokensIn}, read ${cacheReadTokensIn} — ${cachedPct}% hit) | tools: ${toolsUsed.length} | cost: $${costUsd.toFixed(4)}`,
    );

    // Persist this turn so the dashboard's "usage this month" includes
    // chat costs (which dominate iris-brain workloads).
    void recordChatRun({
      tenantPhone: user.phoneNumber,
      surface,
      modelUsed: SONNET_MODEL,
      iterations: iteration,
      tokensIn: totalTokensIn,
      tokensOut: totalTokensOut,
      cachedTokensIn: cacheReadTokensIn,
      costUsd,
      toolsUsed,
      durationMs: Date.now() - startedAt,
      userMessagePreview: text.slice(0, 200),
      assistantReplyPreview: assistantMessage.slice(0, 200),
    });

    // Owner-disposition mining — Devon's framing: "this should be one
    // of the first things the agent populates to encourage learning the
    // client." Fire-and-forget extractor runs after every owner→Iris
    // turn, looks for disposition signals (corrections, approvals,
    // preferences, frustration triggers, communication-style cues) and
    // upserts them to tenant_disposition_rules. Active rules render in
    // every agent's system prompt next tick — never re-learn the same
    // correction twice. Cold-start mode boosts extraction in the first
    // 30 messages so newly-deployed tenants build up their operating
    // manual fast.
    void (async () => {
      try {
        const { mineDispositionFromTurn, isTenantInColdStart } = await import('../../_lib/disposition-mining');
        const isCold = await isTenantInColdStart(user.phoneNumber);
        // Use the message just BEFORE the user's input as "what they're
        // reacting to". The last assistant message in conversationHistory
        // is the right anchor (we just removed our own assistant push
        // earlier in the universal sendOwnerMessage refactor, so the
        // history reflects what we actually sent).
        const history = (user as any)?.conversationHistory as
          | Array<{ role: string; content: string }>
          | undefined;
        const reversed = (history ?? []).slice().reverse();
        const lastAssistant = reversed.find((m) => m.role === 'assistant')?.content;
        const recentHistory = (history ?? [])
          .slice(-6)
          .map((m) => `${m.role}: ${m.content.slice(0, 200)}`)
          .join('\n');
        await mineDispositionFromTurn({
          tenantPhone: user.phoneNumber,
          ownerMessage: text,
          lastAssistantMessage: lastAssistant,
          recentHistory,
          isColdStart: isCold,
        });
      } catch (err) {
        console.warn(`[iris-${surface}] disposition mining failed (non-blocking):`, err);
      }
    })();

    return assistantMessage;
  } catch (error) {
    console.error(`[iris-${surface}] Error:`, error);
    return `Hi ${user.name}! I had a connection issue. Try again in a moment.`;
  }
}

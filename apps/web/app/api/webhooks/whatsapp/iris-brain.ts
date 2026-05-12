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
const SONNET_MODEL = 'claude-sonnet-4-20250514';
// Anthropic Sonnet 4 published rates per 1M tokens
const SONNET_IN_PER_M = 3;
const SONNET_OUT_PER_M = 15;
const SONNET_CACHED_IN_PER_M = 0.3;

function estimateChatCost(totalIn: number, cachedIn: number, totalOut: number): number {
  const uncached = Math.max(0, totalIn - cachedIn);
  return (uncached * SONNET_IN_PER_M + cachedIn * SONNET_CACHED_IN_PER_M + totalOut * SONNET_OUT_PER_M) / 1_000_000;
}

async function callAnthropic(
  apiKey: string,
  systemPrompt: string,
  messages: any[],
  tools: any[],
): Promise<any> {
  const body: any = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: [
      { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
    ],
    messages,
  };
  if (tools.length > 0) body.tools = tools;

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
  surface: 'whatsapp' | 'deck' = 'whatsapp',
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
  console.log(`[iris-${surface}] Loaded ${connections.length} connection(s) for ${user.phoneNumber}: ${connections.map((c) => `${c.provider}/${c.service}`).join(', ') || 'none'}`);
  const tools = buildToolList(connections);
  const messages: any[] = buildContextMessages(user);
  const systemPrompt = buildSystemPrompt(user, connections);

  // Accumulate token + tool usage across every Anthropic round-trip in the loop.
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let totalCachedIn = 0;
  const toolsUsed: string[] = [];
  const startedAt = Date.now();

  try {
    let iteration = 0;
    let response = await callAnthropic(apiKey, systemPrompt, messages, tools);
    totalTokensIn += response.usage?.input_tokens ?? 0;
    totalTokensOut += response.usage?.output_tokens ?? 0;
    totalCachedIn += response.usage?.cache_read_input_tokens ?? 0;

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
      response = await callAnthropic(apiKey, systemPrompt, messages, tools);
      totalTokensIn += response.usage?.input_tokens ?? 0;
      totalTokensOut += response.usage?.output_tokens ?? 0;
      totalCachedIn += response.usage?.cache_read_input_tokens ?? 0;
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
      response = await callAnthropic(apiKey, systemPrompt, messages, []);
      totalTokensIn += response.usage?.input_tokens ?? 0;
      totalTokensOut += response.usage?.output_tokens ?? 0;
      totalCachedIn += response.usage?.cache_read_input_tokens ?? 0;
    }

    const textBlock = response.content.find((b: any) => b.type === 'text');
    const assistantMessage = textBlock?.text ?? "I couldn't process that. Try again?";

    user.conversationHistory.push({
      role: 'assistant',
      content: assistantMessage,
      timestamp: new Date().toISOString(),
    });
    await saveUserContext(user);

    const cachedPct = totalTokensIn > 0 ? Math.round((totalCachedIn / totalTokensIn) * 100) : 0;
    const costUsd = estimateChatCost(totalTokensIn, totalCachedIn, totalTokensOut);
    console.log(
      `[iris-${surface}] iters=${iteration} | tokens: ${totalTokensIn}in/${totalTokensOut}out | cached: ${totalCachedIn} (${cachedPct}%) | tools: ${toolsUsed.length} | cost: $${costUsd.toFixed(4)}`,
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
      cachedTokensIn: totalCachedIn,
      costUsd,
      toolsUsed,
      durationMs: Date.now() - startedAt,
      userMessagePreview: text.slice(0, 200),
      assistantReplyPreview: assistantMessage.slice(0, 200),
    });

    return assistantMessage;
  } catch (error) {
    console.error(`[iris-${surface}] Error:`, error);
    return `Hi ${user.name}! I had a connection issue. Try again in a moment.`;
  }
}

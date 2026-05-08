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

const MAX_ITERATIONS = 5;

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
  const tools = buildToolList(connections);
  const messages: any[] = buildContextMessages(user);
  const systemPrompt = buildSystemPrompt(user);

  try {
    let iteration = 0;
    let response = await callAnthropic(apiKey, systemPrompt, messages, tools);

    while (response.stop_reason === 'tool_use' && iteration < MAX_ITERATIONS) {
      iteration++;
      const toolUseBlocks = response.content.filter((b: any) => b.type === 'tool_use');
      messages.push({ role: 'assistant', content: response.content });

      const toolResults: any[] = [];
      for (const block of toolUseBlocks) {
        const call: ToolCall = { name: block.name, input: block.input };
        console.log(`[iris-${surface}] Tool call: ${call.name}`, call.input);
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
    }

    const textBlock = response.content.find((b: any) => b.type === 'text');
    const assistantMessage = textBlock?.text ?? "I couldn't process that. Try again?";

    user.conversationHistory.push({
      role: 'assistant',
      content: assistantMessage,
      timestamp: new Date().toISOString(),
    });
    await saveUserContext(user);

    const cached = response.usage?.cache_read_input_tokens ?? 0;
    const total = response.usage?.input_tokens ?? 0;
    console.log(
      `[iris-${surface}] iters=${iteration} | tokens: ${total}in/${response.usage?.output_tokens ?? '?'}out | cached: ${cached} (${total > 0 ? Math.round((cached / total) * 100) : 0}%) | tools: ${tools.length}`,
    );

    return assistantMessage;
  } catch (error) {
    console.error(`[iris-${surface}] Error:`, error);
    return `Hi ${user.name}! I had a connection issue. Try again in a moment.`;
  }
}

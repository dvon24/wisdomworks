import { streamText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { getOnboardingSystemPrompt } from '@wisdomworks/shared';
import type { OnboardingData, ConversationMessage } from '@wisdomworks/shared';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = await request.json();
  const { messages, collectedData } = body as {
    messages: ConversationMessage[];
    collectedData: OnboardingData;
  };

  const systemPrompt = getOnboardingSystemPrompt(collectedData ?? {});

  const result = streamText({
    model: anthropic('claude-sonnet-4-20250514'),
    system: systemPrompt,
    messages: messages?.map((m: ConversationMessage) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })) ?? [],
  } as any);

  return result.toTextStreamResponse();
}

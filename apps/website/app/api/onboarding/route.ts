import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { getOnboardingSystemPrompt } from '@wisdomworks/shared';
import type { OnboardingData, ConversationMessage } from '@wisdomworks/shared';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  entry.count++;
  return entry.count > 10;
}
function getClientIP(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return request.headers.get('x-real-ip') ?? 'unknown';
}

/**
 * After the AI responds, extract structured data from the conversation
 * so the frontend doesn't have to regex-parse prose.
 */
async function extractStructuredData(
  conversationText: string,
  aiResponse: string,
): Promise<Record<string, any>> {
  try {
    const result = await generateText({
      model: anthropic('claude-sonnet-4-20250514'),
      system: `Extract structured data from this AI onboarding conversation. Return ONLY valid JSON, no other text.`,
      prompt: `Conversation context:
${conversationText}

AI's latest response:
${aiResponse}

Extract this JSON structure (include ALL fields, use null if unknown):
{
  "businessName": "name of the business or null",
  "businessType": "industry/type or null",
  "employeeCount": number or null,
  "phase": "understanding" | "educating" | "recommending" | "discussing",
  "showAgentPreview": true if AI presented an agent team recommendation,
  "agents": [
    {
      "name": "agent name from AI response",
      "role": "agent role/title",
      "description": "what this agent does",
      "emoji": "relevant emoji",
      "channels": ["WhatsApp", "Phone", etc based on conversation],
      "tools": ["Calendar", "Instagram", etc based on conversation],
      "strengths": ["specific strength for this role"],
      "limitations": ["specific limitation"],
      "aiModel": "Claude Opus 4.7 for critical tasks, Sonnet 4.6 for others"
    }
  ],
  "detectedIntegrations": ["tools/platforms the user mentioned"],
  "painPoints": ["specific pain points the user described"],
  "costOfInaction": {
    "timeWastePerMonth": "estimated $ from conversation context",
    "missedRevenuePerMonth": "estimated $",
    "otherLosses": "estimated $",
    "totalPerMonth": "estimated total $",
    "citations": ["source: specific claim"]
  },
  "estimatedPrice": "price range string like $75-100/month",
  "inputPlaceholder": "contextual placeholder for the chat input"
}

Return ONLY the JSON object.`,
      maxTokens: 1000,
    } as any);

    // Parse JSON from response
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error('[extract-structured] Failed:', e);
  }
  return {};
}

export async function POST(request: Request) {
  const ip = getClientIP(request);
  if (isRateLimited(ip)) {
    return Response.json({ error: 'Too Many Requests' }, { status: 429 });
  }

  try {
    const body = await request.json();
    const { messages, collectedData } = body as {
      messages: unknown;
      collectedData: OnboardingData;
    };

    if (!Array.isArray(messages) || messages.length > 50) {
      return Response.json({ error: 'Invalid messages' }, { status: 400 });
    }
    for (const msg of messages) {
      if (!msg || typeof msg !== 'object' || typeof msg.role !== 'string' || typeof msg.content !== 'string') {
        return Response.json({ error: 'Invalid message format' }, { status: 400 });
      }
      if (msg.content.length > 10000) {
        return Response.json({ error: 'Message too long' }, { status: 400 });
      }
    }

    const validatedMessages = messages as ConversationMessage[];
    const systemPrompt = getOnboardingSystemPrompt(collectedData ?? {});
    const maxTokens = validatedMessages.length >= 2 ? 2000 : 800;

    // Main conversation call
    const result = await generateText({
      model: anthropic('claude-sonnet-4-20250514'),
      system: systemPrompt,
      messages: validatedMessages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      maxTokens,
    } as any);

    // Extract structured data from conversation (parallel-safe, non-blocking UX)
    const conversationText = validatedMessages.map((m) => `${m.role}: ${m.content}`).join('\n');
    const structured = await extractStructuredData(conversationText, result.text);

    const usage = result.usage as any;
    console.log('[onboarding-log]', JSON.stringify({
      timestamp: new Date().toISOString(),
      messageCount: validatedMessages.length,
      phase: structured.phase ?? 'unknown',
    }));

    return Response.json({
      text: result.text,
      structured,
      usage: {
        input: usage?.promptTokens ?? usage?.inputTokens ?? 0,
        output: usage?.completionTokens ?? usage?.outputTokens ?? 0,
      },
    });
  } catch (error) {
    console.error('Onboarding API error:', error);
    return Response.json({
      error: 'AI service error',
      details: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}

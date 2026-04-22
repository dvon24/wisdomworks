import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { getOnboardingSystemPrompt } from '@wisdomworks/shared';
import type { OnboardingData, ConversationMessage } from '@wisdomworks/shared';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Simple in-memory rate limiter: max 10 requests per IP per minute
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

    // Increase token limit — cost education + agent team needs room
    const maxTokens = validatedMessages.length >= 2 ? 2000 : 800;

    const result = await generateText({
      model: anthropic('claude-sonnet-4-20250514'),
      system: systemPrompt,
      messages: validatedMessages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      maxTokens,
    } as any);

    // Log conversation for learning — feeds into the Organizational Learning Engine
    // This data helps reduce future token usage by building better prompts
    // and understanding common business patterns
    const usage = result.usage as any;
    const conversationLog = {
      timestamp: new Date().toISOString(),
      messageCount: validatedMessages.length,
      userMessages: validatedMessages.filter((m) => m.role === 'user').map((m) => m.content),
      tokensUsed: {
        input: usage?.promptTokens ?? usage?.inputTokens ?? 0,
        output: usage?.completionTokens ?? usage?.outputTokens ?? 0,
      },
    };
    console.log('[onboarding-log]', JSON.stringify(conversationLog));

    return Response.json({
      text: result.text,
      usage: conversationLog.tokensUsed,
    });
  } catch (error) {
    console.error('Onboarding API error:', error);
    return Response.json({
      error: 'AI service error',
      details: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}

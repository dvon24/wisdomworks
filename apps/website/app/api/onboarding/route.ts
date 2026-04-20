import { streamText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { getOnboardingSystemPrompt } from '@wisdomworks/shared';
import type { OnboardingData, ConversationMessage } from '@wisdomworks/shared';

export const dynamic = 'force-dynamic';

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
  // Rate limiting
  const ip = getClientIP(request);
  if (isRateLimited(ip)) {
    return new Response('Too Many Requests', { status: 429 });
  }

  const body = await request.json();
  const { messages, collectedData } = body as {
    messages: unknown;
    collectedData: OnboardingData;
  };

  // Input validation: messages must be an array with max length 50
  if (!Array.isArray(messages) || messages.length > 50) {
    return new Response('Invalid messages: must be an array with at most 50 items', { status: 400 });
  }

  // Each message must have role and content strings, content max 10000 chars
  for (const msg of messages) {
    if (
      !msg ||
      typeof msg !== 'object' ||
      typeof msg.role !== 'string' ||
      typeof msg.content !== 'string'
    ) {
      return new Response('Invalid message: each message must have role and content strings', { status: 400 });
    }
    if (msg.content.length > 10000) {
      return new Response('Invalid message: content must not exceed 10000 characters', { status: 400 });
    }
  }

  const validatedMessages = messages as ConversationMessage[];

  const systemPrompt = getOnboardingSystemPrompt(collectedData ?? {});

  const result = streamText({
    model: anthropic('claude-sonnet-4-6-20260416'),
    system: systemPrompt,
    messages: validatedMessages.map((m: ConversationMessage) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
  } as any);

  return result.toTextStreamResponse();
}

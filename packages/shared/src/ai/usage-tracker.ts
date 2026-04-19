import type { ModelCallResult } from './model-provider';

/**
 * Usage tracking callback type.
 * Consumers provide their own implementation (e.g., DB insert via @wisdomworks/db).
 * This keeps packages/shared independent of the DB package.
 */
export type UsageTrackingCallback = (event: UsageEvent) => Promise<void>;

export interface UsageEvent {
  tenantId: string;
  eventType: 'model_call' | 'voice_minute' | 'sms' | 'whatsapp' | 'storage';
  provider?: string;
  model?: string;
  task?: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  costEstimate?: number;
  metadata?: Record<string, unknown>;
}

/** Rough cost estimation per 1M tokens */
const COST_PER_MILLION_TOKENS: Record<string, { input: number; output: number }> = {
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4o': { input: 2.5, output: 10 },
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
  'claude-sonnet-4-20250514': { input: 3, output: 15 },
  'text-embedding-3-small': { input: 0.02, output: 0 },
};

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = COST_PER_MILLION_TOKENS[model];
  if (!pricing) return 0;
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

export function modelCallToUsageEvent(
  tenantId: string,
  task: string,
  result: ModelCallResult,
): UsageEvent {
  return {
    tenantId,
    eventType: 'model_call',
    provider: result.provider,
    model: result.model,
    task,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    latencyMs: result.latencyMs,
    costEstimate: estimateCost(result.model, result.usage.inputTokens, result.usage.outputTokens),
    metadata: { usedFallback: result.usedFallback },
  };
}

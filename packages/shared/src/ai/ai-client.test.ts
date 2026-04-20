import { describe, it, expect, vi } from 'vitest';

// Mock the AI SDK to avoid real API calls
vi.mock('ai', () => ({
  generateText: vi.fn(),
}));
vi.mock('@ai-sdk/anthropic', () => ({
  anthropic: vi.fn((model: string) => ({ provider: 'anthropic', modelId: model })),
}));
vi.mock('@ai-sdk/openai', () => ({
  openai: vi.fn((model: string) => ({ provider: 'openai', modelId: model })),
}));

import { createAIClient } from './ai-client';
import { generateText } from 'ai';
import type { ModelRoutingTable } from './model-provider';

const testRoutingTable: ModelRoutingTable = {
  classification: {
    task: 'classification',
    provider: 'openai',
    model: 'gpt-4o-mini',
    fallback: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
  },
  writing: {
    task: 'writing',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6-20260416',
  },
};

describe('createAIClient', () => {
  it('routes task to correct provider from routing table', async () => {
    vi.mocked(generateText).mockResolvedValueOnce({
      text: 'business',
      usage: { promptTokens: 10, completionTokens: 5 },
    } as any);

    const client = createAIClient(testRoutingTable);
    const result = await client.callModel('classification', 'Is this business?');

    expect(result.provider).toBe('openai');
    expect(result.model).toBe('gpt-4o-mini');
    expect(result.text).toBe('business');
    expect(result.usedFallback).toBe(false);
  });

  it('falls back to secondary provider when primary fails', async () => {
    vi.mocked(generateText)
      .mockRejectedValueOnce(new Error('Primary failed'))
      .mockResolvedValueOnce({
        text: 'fallback response',
        usage: { promptTokens: 10, completionTokens: 5 },
      } as any);

    const client = createAIClient(testRoutingTable);
    const result = await client.callModel('classification', 'test');

    expect(result.provider).toBe('anthropic');
    expect(result.model).toBe('claude-haiku-4-5-20251001');
    expect(result.usedFallback).toBe(true);
  });

  it('throws when primary fails and no fallback configured', async () => {
    vi.mocked(generateText).mockRejectedValueOnce(new Error('API error'));

    const client = createAIClient(testRoutingTable);
    await expect(client.callModel('writing', 'test')).rejects.toThrow('API error');
  });

  it('throws clear error for unknown task', async () => {
    const client = createAIClient(testRoutingTable);
    await expect(client.callModel('unknown_task', 'test')).rejects.toThrow(
      "No model route configured for task: 'unknown_task'",
    );
  });

  it('returns usage information', async () => {
    vi.mocked(generateText).mockResolvedValueOnce({
      text: 'result',
      usage: { promptTokens: 100, completionTokens: 50 },
    } as any);

    const client = createAIClient(testRoutingTable);
    const result = await client.callModel('classification', 'test');

    expect(result.usage.inputTokens).toBe(100);
    expect(result.usage.outputTokens).toBe(50);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('getRoute returns config for valid task', () => {
    const client = createAIClient(testRoutingTable);
    const route = client.getRoute('classification');
    expect(route?.provider).toBe('openai');
    expect(route?.model).toBe('gpt-4o-mini');
  });

  it('getRoute returns undefined for unknown task', () => {
    const client = createAIClient(testRoutingTable);
    expect(client.getRoute('nonexistent')).toBeUndefined();
  });
});

import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import type {
  AIProvider,
  ModelRoutingTable,
  ModelCallOptions,
  ModelCallResult,
  ModelRouteConfig,
} from './model-provider';
import { DEFAULT_ROUTING_TABLE } from './model-provider';

/**
 * Resolve a provider + model string to a Vercel AI SDK model instance.
 */
function getModel(provider: AIProvider, model: string) {
  switch (provider) {
    case 'anthropic':
      return anthropic(model);
    case 'openai':
      return openai(model);
    default:
      throw new Error(`Unknown AI provider: ${provider}`);
  }
}

/**
 * Get the raw provider SDK for provider-specific features.
 * Use sparingly — prefer the abstraction layer.
 */
export function getProviderSDK(provider: AIProvider) {
  switch (provider) {
    case 'anthropic':
      return anthropic;
    case 'openai':
      return openai;
    default:
      throw new Error(`Unknown AI provider: ${provider}`);
  }
}

/**
 * Create an AI client with model routing and failover.
 */
export function createAIClient(routingTable: ModelRoutingTable = DEFAULT_ROUTING_TABLE) {
  return {
    /**
     * Call a model for a specific task.
     * Routes to the correct provider based on the routing table.
     * Falls back to secondary provider on failure.
     */
    async callModel(
      task: string,
      prompt: string,
      options: ModelCallOptions = {},
    ): Promise<ModelCallResult> {
      const route = routingTable[task];
      if (!route) {
        throw new Error(
          `No model route configured for task: '${task}'. Available tasks: ${Object.keys(routingTable).join(', ')}`,
        );
      }

      const start = performance.now();

      // Try primary provider
      try {
        const result = await callProvider(route.provider, route.model, prompt, options);
        return {
          ...result,
          usedFallback: false,
          latencyMs: Math.round(performance.now() - start),
        };
      } catch (primaryError) {
        // Try fallback if configured
        if (route.fallback) {
          try {
            const result = await callProvider(
              route.fallback.provider,
              route.fallback.model,
              prompt,
              options,
            );
            return {
              ...result,
              usedFallback: true,
              latencyMs: Math.round(performance.now() - start),
            };
          } catch (fallbackError) {
            throw new Error(
              `Both primary (${route.provider}/${route.model}) and fallback (${route.fallback.provider}/${route.fallback.model}) failed for task '${task}'. Primary: ${primaryError instanceof Error ? primaryError.message : String(primaryError)}. Fallback: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`,
            );
          }
        }
        throw primaryError;
      }
    },

    /** Get the routing table */
    getRoutingTable() {
      return routingTable;
    },

    /** Get route config for a specific task */
    getRoute(task: string): ModelRouteConfig | undefined {
      return routingTable[task];
    },
  };
}

async function callProvider(
  provider: AIProvider,
  model: string,
  prompt: string,
  options: ModelCallOptions,
): Promise<Omit<ModelCallResult, 'usedFallback' | 'latencyMs'>> {
  const aiModel = getModel(provider, model);

  const result = await generateText({
    model: aiModel,
    prompt,
    system: options.system,
    maxTokens: options.maxTokens,
    temperature: options.temperature,
  } as any);

  return {
    text: result.text,
    provider,
    model,
    usage: {
      inputTokens: (result.usage as any)?.promptTokens ?? (result.usage as any)?.inputTokens ?? 0,
      outputTokens: (result.usage as any)?.completionTokens ?? (result.usage as any)?.outputTokens ?? 0,
    },
  };
}

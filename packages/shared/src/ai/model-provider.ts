/**
 * Model Abstraction Layer — types and interfaces.
 *
 * Supports per-agent per-task model routing:
 * - Each task (classification, code_generation, writing, etc.) can use a different model
 * - Failover: if primary provider fails, try the fallback
 * - Same config format used by TypeScript (Vercel AI SDK) and Python (LangGraph)
 */

export type AIProvider = 'anthropic' | 'openai';

export interface ModelRouteConfig {
  /** Task this config applies to (e.g., 'classification', 'code_generation', 'writing') */
  task: string;
  /** Primary provider */
  provider: AIProvider;
  /** Model identifier (e.g., 'claude-sonnet-4-20250514', 'gpt-4o') */
  model: string;
  /** Fallback if primary fails */
  fallback?: {
    provider: AIProvider;
    model: string;
  };
}

/** Maps task names to model configurations */
export type ModelRoutingTable = Record<string, ModelRouteConfig>;

export interface ModelCallOptions {
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Temperature (0-1) */
  temperature?: number;
  /** System prompt */
  system?: string;
  /** Tenant ID for usage tracking */
  tenantId?: string;
  /** Request ID for correlation */
  requestId?: string;
}

export interface ModelCallResult {
  /** Generated text */
  text: string;
  /** Provider that handled the call */
  provider: AIProvider;
  /** Model used */
  model: string;
  /** Whether fallback was used */
  usedFallback: boolean;
  /** Token usage */
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  /** Latency in ms */
  latencyMs: number;
}

export interface BenchmarkCase {
  /** Description of the test case */
  name: string;
  /** Task type to route through */
  task: string;
  /** Input prompt */
  prompt: string;
  /** Expected output (for fuzzy matching) */
  expectedOutput: string;
  /** System prompt */
  system?: string;
}

export interface BenchmarkResult {
  case: string;
  provider: AIProvider;
  model: string;
  accuracyScore: number;
  latencyMs: number;
  costEstimate: number;
}

/** Default routing table — sensible defaults for common tasks */
export const DEFAULT_ROUTING_TABLE: ModelRoutingTable = {
  classification: {
    task: 'classification',
    provider: 'openai',
    model: 'gpt-4o-mini',
    fallback: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
  },
  code_generation: {
    task: 'code_generation',
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    fallback: { provider: 'openai', model: 'gpt-4o' },
  },
  writing: {
    task: 'writing',
    provider: 'openai',
    model: 'gpt-4o',
    fallback: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
  },
  analysis: {
    task: 'analysis',
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    fallback: { provider: 'openai', model: 'gpt-4o' },
  },
  embedding: {
    task: 'embedding',
    provider: 'openai',
    model: 'text-embedding-3-small',
  },
};

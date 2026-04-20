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
  /** Model identifier (e.g., 'claude-sonnet-4-6-20260416', 'gpt-4o') */
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

/**
 * Default routing table — accuracy-first model selection.
 *
 * Philosophy: The cost of getting it wrong (leaked personal emails, bad coaching advice,
 * wrong agents deployed) far exceeds the cost of premium models. Use the best available
 * model for every critical task. Cheaper models only for routine/mechanical tasks —
 * and those routine tasks are OVERSEEN by a smarter model that validates their output.
 *
 * Critical tasks → Claude Sonnet 4.6 / GPT-5.4 (highest accuracy)
 * Routine tasks → Haiku 4.5 / GPT-4o-mini (fast, overseen by critical model)
 * Oversight → Critical model spot-checks routine model output periodically
 * Embeddings → text-embedding-3-small (specialized, no reasoning needed)
 */
export const DEFAULT_ROUTING_TABLE: ModelRoutingTable = {
  // CRITICAL TASKS — premium models, accuracy is everything
  classification: {
    task: 'classification',
    provider: 'anthropic',
    model: 'claude-opus-4-7-20260420',
    fallback: { provider: 'openai', model: 'gpt-5.4' },
  },
  code_generation: {
    task: 'code_generation',
    provider: 'anthropic',
    model: 'claude-opus-4-7-20260420',
    fallback: { provider: 'openai', model: 'gpt-5.4' },
  },
  writing: {
    task: 'writing',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6-20260416',
    fallback: { provider: 'openai', model: 'gpt-5.4' },
  },
  analysis: {
    task: 'analysis',
    provider: 'anthropic',
    model: 'claude-opus-4-7-20260420',
    fallback: { provider: 'openai', model: 'gpt-5.4' },
  },
  coaching: {
    task: 'coaching',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6-20260416',
    fallback: { provider: 'openai', model: 'gpt-5.4' },
  },
  onboarding: {
    task: 'onboarding',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6-20260416',
    fallback: { provider: 'openai', model: 'gpt-5.4' },
  },
  // ROUTINE TASKS — fast models, overseen by critical model
  // The oversight model (classification/analysis) spot-checks routine output
  // periodically to catch errors before they reach the customer
  reminders: {
    task: 'reminders',
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    fallback: { provider: 'openai', model: 'gpt-4o-mini' },
  },
  formatting: {
    task: 'formatting',
    provider: 'openai',
    model: 'gpt-4o-mini',
    fallback: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
  },
  // OVERSIGHT — smart model validates routine model output
  oversight: {
    task: 'oversight',
    provider: 'anthropic',
    model: 'claude-opus-4-7-20260420',
    fallback: { provider: 'openai', model: 'gpt-5.4' },
  },
  // EMBEDDINGS — specialized, no reasoning needed
  embedding: {
    task: 'embedding',
    provider: 'openai',
    model: 'text-embedding-3-small',
  },
};

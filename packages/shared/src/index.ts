// @wisdomworks/shared — Shared TypeScript types, constants, and utilities

// Event types
export type { DomainEvent } from './types/signals';

// Event schemas
export { domainEventSchema } from './schemas/signal-schemas';
export type { DomainEventInput } from './schemas/signal-schemas';

// Cache
export type { CacheProvider } from './cache-provider';

// AI Model Abstraction Layer
export {
  DEFAULT_ROUTING_TABLE,
  createAIClient,
  getProviderSDK,
  estimateCost,
  modelCallToUsageEvent,
  runBenchmark,
  SAMPLE_BENCHMARK_CASES,
} from './ai';
export type {
  AIProvider,
  ModelRouteConfig,
  ModelRoutingTable,
  ModelCallOptions,
  ModelCallResult,
  BenchmarkCase,
  BenchmarkResult,
  UsageEvent,
  UsageTrackingCallback,
} from './ai';

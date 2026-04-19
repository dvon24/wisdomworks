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

// Deployment Spec
export { BLUEPRINTS, SOLO_EXAMPLE, MID_SIZE_EXAMPLE } from './types/deployment-spec';
export type {
  AxisDeploymentSpec,
  AgentSpec,
  ModelRoutingEntry,
  AgentGovernanceRule,
  IntegrationSpec,
  PricingSpec,
  BlueprintType,
  BlueprintDefinition,
} from './types/deployment-spec';
export { axisDeploymentSpecSchema } from './schemas/deployment-spec-schema';
export type { AxisDeploymentSpecInput } from './schemas/deployment-spec-schema';

// Communication Channels
export { CHANNEL_TYPES, DEFAULT_CHANNEL_ROUTING, ChannelRegistry } from './channels';
export type {
  ChannelMessage,
  ChannelMessageFilter,
  ChannelStatus,
  CommunicationChannel,
  ChannelType,
  ChannelRoutingConfig,
} from './channels';

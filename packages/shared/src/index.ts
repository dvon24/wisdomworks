// @wisdomworks/shared — Shared TypeScript types, constants, and utilities

// Privacy (Story 6.5 — generalized privacy boundary)
export { redactPII, redactPIIText } from './privacy/redact';
export type { PiiCategory, RedactionResult } from './privacy/redact';

// Row HMAC (Story 6.8 — sensitive row tamper detection)
export {
  computeRowHmac,
  verifyRowHmac,
  computeOAuthConnectionHmac,
  computeProjectConnectionHmac,
  computeComplianceProfileHmac,
} from './security/row-hmac';
export type {
  OAuthConnectionHmacFields,
  ProjectConnectionHmacFields,
  ComplianceProfileHmacFields,
} from './security/row-hmac';

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

// Frameworks: Business Types, Industry Templates, Personal Templates
export {
  BUSINESS_TYPE_DICTIONARY,
  BUSINESS_CATEGORIES,
  getBusinessType,
  getBusinessTypesByCategory,
  INDUSTRY_TEMPLATES,
  PROFESSIONAL_SERVICES_TEMPLATE,
  SMALL_BUSINESS_TEMPLATE,
  getTemplate,
  findTemplateForBusiness,
  VERTICAL_TEMPLATES,
  ELECTRICIAN_TEMPLATE,
  RESTAURANT_TEMPLATE,
  SALON_TEMPLATE,
  findVerticalTemplate,
  PERSONAL_TEMPLATES,
  PERSONAL_BLUEPRINTS,
  getPersonalTemplate,
  HUMAN_COACHING_CAPABILITIES,
  AGENT_COACHING_SIGNALS,
  FEEDBACK_DIMENSIONS,
  DEFAULT_LEADERSHIP_COACH_CONFIG,
  createLeadershipCoachSpec,
  shouldProvisionLeadershipCoach,
} from './frameworks';
export type {
  BusinessTypeFramework,
  BusinessCategory,
  IndustryTemplate,
  VerticalTemplate,
  PersonalTemplate,
  LeadershipCoachConfig,
  FeedbackCadence,
} from './frameworks';

// Onboarding Engine
export {
  getRequiredFields,
  suggestBlueprint,
  suggestTemplate,
  getOnboardingSystemPrompt,
  createOnboardingState,
  generateDeploymentSpec,
  generatePreview,
  extractOntology,
  deriveAgentConfigs,
  planProvisioning,
  runAxisDiscovery,
  discoverIntegrations,
  recommendChannelsForRoles,
  documentOrganization,
  AGENT_CATEGORIES,
  categorizeAgent,
  getCategoryDefinition,
} from './onboarding';
export type {
  OnboardingState,
  OnboardingData,
  ConversationMessage,
  DeploymentPreview,
  OntologyEntity,
  OntologyRelationship,
  ExtractedOntology,
  EntityType,
  RelationshipType,
  DerivedAgentConfig,
  AgentTier,
  InstancePayload,
  SignalConnection,
  DiscoveryResult,
  AgentCategory,
  CategoryDefinition,
} from './onboarding';

// Agent Operating Protocol
export {
  AUTONOMY_LEVELS,
  AUTONOMY_DEFINITIONS,
  BASE_AGENT_PROTOCOL,
  createAgentProtocol,
  getDefaultAutonomyForRole,
  mergeTenantProtocol,
} from './protocols';
export type { AutonomyLevel, AutonomyLevelDefinition, AgentOperatingProtocol } from './protocols';

// Agent Features (Epic 2a)
export type {
  ExtractedData,
  MorningBriefing,
  BriefingItem,
  AgentTask,
  AgentState,
  SolutionBrief,
  ProcessRecord,
  AgentSkill,
  LessonLearned,
} from './agents';

// Intent parser (chat command parsing)
export type { CatalogAgent, ActiveAgent, Intent } from './agents/intent-parser';
export {
  DEFAULT_AGENT_CATALOG,
  TIER_PRICE,
  TIER_DESC,
  parseIntent,
  generateIntentReply,
  intentPriceDelta,
  formatPriceDelta,
} from './agents/intent-parser';

// External integrations (Gmail, Google Calendar, Outlook, Apple CalDAV)
export type {
  EmailMessage,
  EmailAttachmentRef,
  FetchedAttachment,
  SendEmailRequest,
  OutboundAttachment,
  CalendarEvent,
  CreateCalendarEvent,
  IntegrationContext,
  IntegrationResult,
  OAuthConnection,
  GscSite,
  GscQueryRow,
  GscPerformanceReport,
  Ga4Property,
  Ga4ReportRow,
  Ga4Report,
} from './integrations';

// Provider namespaces for the agent-tools executors (each is `import * as`-style).
export { googleSearchConsole, googleAnalytics, googleSheets, gmail } from './integrations';
export {
  listEmails,
  sendEmail,
  markEmailRead,
  listEmailAttachments,
  fetchEmailAttachment,
  getEmailReadState,
  searchCloudDocs,
  fetchCloudDoc,
  listCalendarEvents,
  listCalendars,
  listSentEmails,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  analyzeWebsite,
  encryptToken,
  decryptToken,
  assertEncryptionConfigured,
  loadConnectionsForPhone,
  getConnectionForPhone,
} from './integrations';
export type { WebsiteSnapshot, WebsitePlatform } from './integrations';
export type { CloudDocRef, FetchedCloudDoc } from './integrations';

// Client Profiles & Business Intelligence (Epic 2b)
export type {
  ClientProfile,
  VisitRecord,
  ClientPhoto,
  SatisfactionSignal,
  BusinessInsight,
  InsightType,
} from './clients';

// @wisdomworks/db — Drizzle ORM schema + migrations

// Database client
export { db } from './client';

// Schema tables
export {
  tenants,
  tenantConfigs,
  tenantStatusEnum,
  users,
  sessions,
  accounts,
  userRoleEnum,
  usageEvents,
  usageEventTypeEnum,
  governanceRules,
  governanceEvaluations,
  ruleEffectEnum,
  evaluationResultEnum,
  auditLogs,
  billingRecords,
  billingRecordTypeEnum,
  billingStatusEnum,
  entityTypes,
  entities,
  relationshipTypes,
  relationships,
  DEFAULT_ENTITY_TYPES,
  DEFAULT_RELATIONSHIP_TYPES,
  agentConfigs,
  agentInstances,
  agentStatusEnum,
  signalTypes,
  signals,
  DEFAULT_SIGNAL_TYPES,
  processRecords,
  agentSkills,
  lessonsLearned,
} from './schema';

// Types
export type { TenantStatus } from './schema';
export type { UserRole } from './schema';

// Inferred types from Drizzle
export type { InferSelectModel, InferInsertModel } from 'drizzle-orm';

// Health check
export { checkDatabaseHealth } from './health';

// Tenant isolation helpers
export { assertTenantMatch, tenantFilter } from './tenant-scope';

// Lazy client accessor
export { getDb } from './client';

// Test utilities
export {
  createTestTenant,
  createTestUser,
  createTestContext,
  cleanupTestTenant,
} from './testing';
export type { TestTenant, TestUser } from './testing';

// Governance
export { evaluateGovernance } from './governance';
export type { GovernanceCheckRequest, GovernanceCheckResult } from './governance';

// Audit
export { logAudit } from './audit';
export type { AuditLogEntry } from './audit';

// Additional types
export type { RuleEffect, EvaluationResult, UsageEventType } from './schema';

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

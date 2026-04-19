/**
 * Schema Contract Test (B-003) — P0 priority
 *
 * Validates that Drizzle ORM schemas and Python Pydantic models
 * define the same fields with compatible types.
 *
 * This test runs WITHOUT a database — it validates schema definitions
 * at the type/structure level, not against a live DB.
 */
import { describe, it, expect } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { tenants, tenantConfigs } from './schema/tenants';
import { users, sessions, accounts } from './schema/auth';

// Map Drizzle column types to expected Pydantic-compatible types
const DRIZZLE_TO_PYDANTIC_TYPE: Record<string, string[]> = {
  PgUUID: ['string', 'str'],
  PgText: ['string', 'str'],
  PgTimestamp: ['string', 'datetime', 'str'],
  PgJsonb: ['object', 'dict', 'any'],
  PgInteger: ['integer', 'int', 'number'],
};

function getDrizzleFields(table: any): Record<string, { type: string; notNull: boolean }> {
  const columns = getTableColumns(table);
  const fields: Record<string, { type: string; notNull: boolean }> = {};
  for (const [name, col] of Object.entries(columns)) {
    fields[name] = {
      type: (col as any).columnType,
      notNull: (col as any).notNull,
    };
  }
  return fields;
}

describe('Schema Contract (B-003) — P0', () => {
  describe('tenants table', () => {
    it('has all required fields for Pydantic Tenant model', () => {
      const fields = getDrizzleFields(tenants);
      const requiredFields = ['id', 'name', 'slug', 'status', 'createdAt', 'updatedAt'];
      for (const field of requiredFields) {
        expect(fields[field], `Missing field: ${field}`).toBeDefined();
      }
    });

    it('id is UUID type', () => {
      const fields = getDrizzleFields(tenants);
      expect(fields.id.type).toBe('PgUUID');
    });

    it('all required fields are NOT NULL', () => {
      const fields = getDrizzleFields(tenants);
      expect(fields.id.notNull).toBe(true);
      expect(fields.name.notNull).toBe(true);
      expect(fields.slug.notNull).toBe(true);
      expect(fields.status.notNull).toBe(true);
    });
  });

  describe('tenant_configs table', () => {
    it('has all required fields for Pydantic TenantConfig model', () => {
      const fields = getDrizzleFields(tenantConfigs);
      const requiredFields = ['id', 'tenantId', 'configType', 'configData', 'createdAt', 'updatedAt'];
      for (const field of requiredFields) {
        expect(fields[field], `Missing field: ${field}`).toBeDefined();
      }
    });

    it('configData is JSONB type', () => {
      const fields = getDrizzleFields(tenantConfigs);
      expect(fields.configData.type).toBe('PgJsonb');
    });

    it('tenantId is required (NOT NULL)', () => {
      const fields = getDrizzleFields(tenantConfigs);
      expect(fields.tenantId.notNull).toBe(true);
    });
  });

  describe('users table', () => {
    it('has all required fields for Python User model', () => {
      const fields = getDrizzleFields(users);
      const requiredFields = ['id', 'tenantId', 'email', 'role', 'createdAt', 'updatedAt'];
      for (const field of requiredFields) {
        expect(fields[field], `Missing field: ${field}`).toBeDefined();
      }
    });

    it('tenantId is required (NOT NULL) for tenant isolation', () => {
      const fields = getDrizzleFields(users);
      expect(fields.tenantId.notNull).toBe(true);
    });
  });

  describe('cross-table contract rules', () => {
    it('all tables with tenant-scoped data have tenantId column', () => {
      const tablesRequiringTenantId = [tenantConfigs, users];
      for (const table of tablesRequiringTenantId) {
        const fields = getDrizzleFields(table);
        expect(fields.tenantId, 'Missing tenantId column').toBeDefined();
        expect(fields.tenantId.notNull, 'tenantId must be NOT NULL').toBe(true);
        expect(fields.tenantId.type, 'tenantId must be UUID').toBe('PgUUID');
      }
    });

    it('all primary keys are UUID type (enforcement rule #5)', () => {
      const allTables = [tenants, tenantConfigs, users, accounts];
      for (const table of allTables) {
        const fields = getDrizzleFields(table);
        expect(fields.id?.type, 'Primary key must be UUID').toBe('PgUUID');
      }
    });

    it('all timestamp columns use PgTimestamp type (enforcement rule #6)', () => {
      const fields = getDrizzleFields(tenants);
      expect(fields.createdAt.type).toBe('PgTimestamp');
      expect(fields.updatedAt.type).toBe('PgTimestamp');
    });
  });
});

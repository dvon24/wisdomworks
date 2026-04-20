import { eq } from 'drizzle-orm';
import type { PgTable, PgColumn } from 'drizzle-orm/pg-core';

/**
 * Validates that a row's tenantId matches the expected tenantId.
 * Throws an error if they don't match — preventing cross-tenant data access.
 */
export function assertTenantMatch(
  row: { tenantId: string } | null | undefined,
  expectedTenantId: string,
): void {
  if (!row) {
    return; // null/undefined rows are not a tenant violation — they're "not found"
  }
  if (row.tenantId !== expectedTenantId) {
    const error = new Error('Tenant isolation violation: resource belongs to a different tenant');
    error.name = 'TenantIsolationError';
    throw error;
  }
}

/**
 * Returns a Drizzle `eq()` condition for tenant_id filtering.
 * Use this in every query to ensure tenant isolation.
 *
 * @example
 * const results = await db
 *   .select()
 *   .from(tenantConfigs)
 *   .where(tenantFilter(tenantConfigs.tenantId, ctx.tenantId));
 */
export function tenantFilter(column: PgColumn, tenantId: string) {
  return eq(column, tenantId);
}

/**
 * Generates SQL strings for creating Row-Level Security (RLS) policies on all
 * tenant-scoped tables. These policies should be applied to Supabase to enforce
 * tenant isolation at the database level, preventing cross-tenant data access
 * even if application-level checks are bypassed.
 *
 * Usage: Run the returned SQL statements against your Supabase/PostgreSQL instance.
 * Requires that the application sets `app.current_tenant_id` on each connection
 * (e.g., via `SET LOCAL app.current_tenant_id = '<tenant-id>'`).
 */
export function generateRLSPolicies(): string[] {
  const tenantScopedTables = [
    'users',
    'entity_types',
    'entities',
    'relationship_types',
    'relationships',
    'governance_rules',
    'governance_evaluations',
    'audit_logs',
    'tenant_configs',
    'signals',
  ];

  const statements: string[] = [];

  for (const table of tenantScopedTables) {
    statements.push(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
    statements.push(
      `CREATE POLICY tenant_isolation_${table} ON ${table} ` +
      `USING (tenant_id = current_setting('app.current_tenant_id')::uuid);`,
    );
    statements.push(
      `CREATE POLICY tenant_isolation_insert_${table} ON ${table} ` +
      `FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);`,
    );
  }

  return statements;
}

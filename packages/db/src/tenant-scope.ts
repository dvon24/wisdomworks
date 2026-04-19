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

import { v7 as uuid7 } from 'uuid';
import { eq } from 'drizzle-orm';
import { getDb } from '../client';
import { tenants, tenantConfigs, users } from '../schema';
import type { TenantStatus } from '../schema';
import type { UserRole } from '../schema';

export interface TestTenant {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
}

export interface TestUser {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: UserRole;
}

/**
 * Create a test tenant with random slug.
 * Uses the real database — requires DATABASE_URL.
 */
export async function createTestTenant(
  overrides: Partial<{ name: string; slug: string; status: TenantStatus }> = {},
): Promise<TestTenant> {
  const db = getDb();
  const id = uuid7();
  const slug = overrides.slug ?? `test-${id.slice(0, 8)}`;

  const result = await db
    .insert(tenants)
    .values({
      id,
      name: overrides.name ?? `Test Tenant ${slug}`,
      slug,
      status: overrides.status ?? 'active',
    })
    .returning();

  const tenant = result[0]!;
  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    status: tenant.status as TenantStatus,
  };
}

/**
 * Create a test user in a given tenant.
 */
export async function createTestUser(
  tenantId: string,
  overrides: Partial<{ email: string; name: string; role: UserRole }> = {},
): Promise<TestUser> {
  const db = getDb();
  const id = uuid7();

  const result = await db
    .insert(users)
    .values({
      id,
      tenantId,
      email: overrides.email ?? `test-${id.slice(0, 8)}@wisdomworks.test`,
      name: overrides.name ?? 'Test User',
      role: overrides.role ?? 'member',
    })
    .returning();

  const user = result[0]!;
  return {
    id: user.id,
    tenantId: user.tenantId,
    email: user.email,
    name: user.name ?? 'Test User',
    role: user.role as UserRole,
  };
}

/**
 * Create a mock TRPCContext for testing protectedProcedures.
 * Does NOT require a database — pure in-memory context.
 */
export function createTestContext(
  tenantId: string,
  userId: string,
  role: UserRole = 'member',
) {
  return {
    tenantId,
    userId,
    requestId: uuid7(),
    userRole: role,
  };
}

/**
 * Delete all data for a test tenant (cascade).
 * Call in afterEach/afterAll to clean up test data.
 */
export async function cleanupTestTenant(tenantId: string): Promise<void> {
  const db = getDb();
  // Delete in dependency order (or rely on CASCADE)
  await db.delete(users).where(eq(users.tenantId, tenantId));
  await db.delete(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId));
  await db.delete(tenants).where(eq(tenants.id, tenantId));
}

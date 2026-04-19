import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import {
  createTestTenant,
  createTestUser,
  cleanupTestTenant,
} from '@wisdomworks/db';

/**
 * Test seed router — B-004
 * Only available when NODE_ENV === 'test'.
 * Provides API for seeding test data and cleaning up after tests.
 */

function guardTestOnly() {
  if (process.env.NODE_ENV !== 'test') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Test seed router is only available in test environment',
    });
  }
}

export const testSeedRouter = router({
  seedTenant: protectedProcedure
    .input(
      z.object({
        name: z.string().optional(),
        slug: z.string().optional(),
      }).optional(),
    )
    .mutation(async ({ input }) => {
      guardTestOnly();
      return createTestTenant(input ?? {});
    }),

  seedUser: protectedProcedure
    .input(
      z.object({
        tenantId: z.string(),
        email: z.string().optional(),
        name: z.string().optional(),
        role: z.enum(['owner', 'admin', 'member', 'viewer']).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      guardTestOnly();
      const { tenantId, ...overrides } = input;
      return createTestUser(tenantId, overrides);
    }),

  seedAll: protectedProcedure
    .input(
      z.object({
        tenantName: z.string().optional(),
        userCount: z.number().min(1).max(10).optional(),
      }).optional(),
    )
    .mutation(async ({ input }) => {
      guardTestOnly();
      const tenant = await createTestTenant({ name: input?.tenantName });
      const userCount = input?.userCount ?? 1;
      const users = [];
      for (let i = 0; i < userCount; i++) {
        const user = await createTestUser(tenant.id, {
          role: i === 0 ? 'owner' : 'member',
        });
        users.push(user);
      }
      return { tenant, users };
    }),

  cleanup: protectedProcedure
    .input(z.object({ tenantId: z.string() }))
    .mutation(async ({ input }) => {
      guardTestOnly();
      await cleanupTestTenant(input.tenantId);
      return { success: true };
    }),
});

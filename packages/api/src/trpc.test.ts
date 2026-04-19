import { describe, it, expect } from 'vitest';
import { TRPCError } from '@trpc/server';
import { createTRPCContext, router, protectedProcedure, publicProcedure } from './trpc';
import { z } from 'zod';

const UUID_V7_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('createTRPCContext', () => {
  it('generates a requestId in UUID v7 format', () => {
    const ctx = createTRPCContext({ session: null });
    expect(ctx.requestId).toMatch(UUID_V7_REGEX);
  });

  it('includes session when provided', () => {
    const session = {
      user: { id: 'user-123' },
      tenantId: 'tenant-456',
      userRole: 'member',
    };
    const ctx = createTRPCContext({ session });
    expect(ctx.session).toBe(session);
    expect(ctx.session?.user?.id).toBe('user-123');
    expect(ctx.session?.tenantId).toBe('tenant-456');
  });

  it('handles null session', () => {
    const ctx = createTRPCContext({ session: null });
    expect(ctx.session).toBeNull();
    expect(ctx.requestId).toBeDefined();
  });

  it('generates unique requestIds per call', () => {
    const ctx1 = createTRPCContext({ session: null });
    const ctx2 = createTRPCContext({ session: null });
    expect(ctx1.requestId).not.toBe(ctx2.requestId);
  });
});

// Create a test router to exercise the enforceAuth middleware
const testRouter = router({
  protectedRoute: protectedProcedure.query(({ ctx }) => ({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    requestId: ctx.requestId,
    userRole: ctx.userRole,
  })),
});

const createCaller = (session: any) => {
  const ctx = createTRPCContext({ session });
  return testRouter.createCaller(ctx);
};

describe('enforceAuth middleware', () => {
  it('throws UNAUTHORIZED when no session', async () => {
    const caller = createCaller(null);
    await expect(caller.protectedRoute()).rejects.toThrow(TRPCError);
    await expect(caller.protectedRoute()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('throws UNAUTHORIZED when session has no user', async () => {
    const caller = createCaller({ tenantId: 'tenant-1', userRole: 'member' });
    await expect(caller.protectedRoute()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('throws UNAUTHORIZED when session has no tenantId', async () => {
    const caller = createCaller({ user: { id: 'user-1' }, userRole: 'member' });
    await expect(caller.protectedRoute()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      message: 'No tenant associated with this session',
    });
  });

  it('throws UNAUTHORIZED when userRole is invalid', async () => {
    const caller = createCaller({
      user: { id: 'user-1' },
      tenantId: 'tenant-1',
      userRole: 'superadmin', // not a valid role
    });
    await expect(caller.protectedRoute()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('throws UNAUTHORIZED when userRole is missing', async () => {
    const caller = createCaller({
      user: { id: 'user-1' },
      tenantId: 'tenant-1',
      // no userRole
    });
    await expect(caller.protectedRoute()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('passes with valid session and returns correct context', async () => {
    const caller = createCaller({
      user: { id: 'user-123' },
      tenantId: 'tenant-456',
      userRole: 'owner',
    });
    const result = await caller.protectedRoute();
    expect(result.tenantId).toBe('tenant-456');
    expect(result.userId).toBe('user-123');
    expect(result.userRole).toBe('owner');
    expect(result.requestId).toMatch(UUID_V7_REGEX);
  });

  it('works with all valid roles', async () => {
    for (const role of ['owner', 'admin', 'member', 'viewer']) {
      const caller = createCaller({
        user: { id: 'user-1' },
        tenantId: 'tenant-1',
        userRole: role,
      });
      const result = await caller.protectedRoute();
      expect(result.userRole).toBe(role);
    }
  });
});

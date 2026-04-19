import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { v7 as uuid7 } from 'uuid';
import { userRoleEnum } from '@wisdomworks/db';
import type { UserRole } from '@wisdomworks/db';

const VALID_ROLES = new Set<string>(userRoleEnum);

function validateUserRole(role: string | undefined): UserRole {
  if (!role || !VALID_ROLES.has(role)) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: `Invalid or missing user role: '${role}'`,
    });
  }
  return role as UserRole;
}

export interface CreateContextOptions {
  session: {
    user?: {
      id: string;
    };
    tenantId?: string;
    userRole?: string;
  } | null;
}

export interface TRPCContext {
  tenantId: string;
  userId: string;
  requestId: string;
  userRole: UserRole;
}

export function createTRPCContext(opts: CreateContextOptions) {
  const requestId = uuid7();
  return {
    session: opts.session,
    requestId,
  };
}

const t = initTRPC.context<ReturnType<typeof createTRPCContext>>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const enforceAuth = t.middleware(({ ctx, next }) => {
  if (!ctx.session?.user?.id) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Authentication required',
    });
  }

  const tenantId = ctx.session.tenantId;
  if (!tenantId) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'No tenant associated with this session',
    });
  }

  const userRole = validateUserRole(ctx.session.userRole);

  return next({
    ctx: {
      tenantId,
      userId: ctx.session.user.id,
      requestId: ctx.requestId,
      userRole,
    } satisfies TRPCContext,
  });
});

export const protectedProcedure = t.procedure.use(enforceAuth);

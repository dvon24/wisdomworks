import { describe, it, expect } from 'vitest';
import { TRPCError } from '@trpc/server';
import { hasPermission, requirePermission, PERMISSIONS } from './rbac';

describe('hasPermission', () => {
  it('owner has all permissions', () => {
    for (const perm of PERMISSIONS) {
      expect(hasPermission('owner', perm)).toBe(true);
    }
  });

  it('admin has read, write, delete, manage_agents, manage_governance', () => {
    expect(hasPermission('admin', 'read')).toBe(true);
    expect(hasPermission('admin', 'write')).toBe(true);
    expect(hasPermission('admin', 'delete')).toBe(true);
    expect(hasPermission('admin', 'manage_agents')).toBe(true);
    expect(hasPermission('admin', 'manage_governance')).toBe(true);
    expect(hasPermission('admin', 'admin')).toBe(false);
    expect(hasPermission('admin', 'manage_tenants')).toBe(false);
    expect(hasPermission('admin', 'manage_billing')).toBe(false);
  });

  it('member has only read and write', () => {
    expect(hasPermission('member', 'read')).toBe(true);
    expect(hasPermission('member', 'write')).toBe(true);
    expect(hasPermission('member', 'delete')).toBe(false);
    expect(hasPermission('member', 'admin')).toBe(false);
    expect(hasPermission('member', 'manage_agents')).toBe(false);
  });

  it('viewer has only read', () => {
    expect(hasPermission('viewer', 'read')).toBe(true);
    expect(hasPermission('viewer', 'write')).toBe(false);
    expect(hasPermission('viewer', 'delete')).toBe(false);
    expect(hasPermission('viewer', 'admin')).toBe(false);
  });
});

describe('requirePermission', () => {
  it('does not throw for authorized role-permission combinations', () => {
    expect(() => requirePermission('owner', 'admin')).not.toThrow();
    expect(() => requirePermission('admin', 'read')).not.toThrow();
    expect(() => requirePermission('member', 'write')).not.toThrow();
    expect(() => requirePermission('viewer', 'read')).not.toThrow();
  });

  it('throws TRPCError FORBIDDEN for unauthorized access', () => {
    expect(() => requirePermission('viewer', 'write')).toThrow('Forbidden');
    expect(() => requirePermission('member', 'delete')).toThrow('Forbidden');
    expect(() => requirePermission('admin', 'manage_tenants')).toThrow('Forbidden');
  });

  it('thrown error is TRPCError with FORBIDDEN code', () => {
    try {
      requirePermission('viewer', 'admin');
      expect.unreachable('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(TRPCError);
      expect((e as TRPCError).code).toBe('FORBIDDEN');
    }
  });
});

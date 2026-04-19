import { describe, it, expect } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { users, sessions, accounts, userRoleEnum } from './auth';

describe('users schema', () => {
  it('has required columns', () => {
    const columns = getTableColumns(users);
    expect(columns.id).toBeDefined();
    expect(columns.tenantId).toBeDefined();
    expect(columns.name).toBeDefined();
    expect(columns.email).toBeDefined();
    expect(columns.role).toBeDefined();
    expect(columns.createdAt).toBeDefined();
    expect(columns.updatedAt).toBeDefined();
  });

  it('tenant_id is required (not null)', () => {
    const columns = getTableColumns(users);
    expect(columns.tenantId.notNull).toBe(true);
  });

  it('defines valid user role values', () => {
    expect(userRoleEnum).toContain('owner');
    expect(userRoleEnum).toContain('admin');
    expect(userRoleEnum).toContain('member');
    expect(userRoleEnum).toContain('viewer');
    expect(userRoleEnum).toHaveLength(4);
  });
});

describe('sessions schema', () => {
  it('has required columns', () => {
    const columns = getTableColumns(sessions);
    expect(columns.sessionToken).toBeDefined();
    expect(columns.userId).toBeDefined();
    expect(columns.expires).toBeDefined();
  });
});

describe('accounts schema', () => {
  it('has required columns', () => {
    const columns = getTableColumns(accounts);
    expect(columns.id).toBeDefined();
    expect(columns.userId).toBeDefined();
    expect(columns.type).toBeDefined();
    expect(columns.provider).toBeDefined();
    expect(columns.providerAccountId).toBeDefined();
  });

  it('userId is required (not null)', () => {
    const columns = getTableColumns(accounts);
    expect(columns.userId.notNull).toBe(true);
  });
});

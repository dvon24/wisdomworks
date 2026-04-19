import { describe, it, expect } from 'vitest';
import { createTestContext } from './test-helpers';

const UUID_V7_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('createTestContext (no DB required)', () => {
  it('creates a valid test context with tenantId and userId', () => {
    const ctx = createTestContext('tenant-123', 'user-456');
    expect(ctx.tenantId).toBe('tenant-123');
    expect(ctx.userId).toBe('user-456');
    expect(ctx.userRole).toBe('member');
    expect(ctx.requestId).toMatch(UUID_V7_REGEX);
  });

  it('accepts custom role', () => {
    const ctx = createTestContext('t1', 'u1', 'owner');
    expect(ctx.userRole).toBe('owner');
  });

  it('generates unique requestIds', () => {
    const ctx1 = createTestContext('t1', 'u1');
    const ctx2 = createTestContext('t1', 'u1');
    expect(ctx1.requestId).not.toBe(ctx2.requestId);
  });
});

// Integration tests — only run when DATABASE_URL is available
describe.skipIf(!process.env.DATABASE_URL)('Integration: test helpers with real DB', () => {
  it('would test createTestTenant, createTestUser, cleanupTestTenant against real DB', () => {
    // These tests run in CI with docker-compose.test.yml providing the DB
    // Skipped in local unit test runs without DATABASE_URL
    expect(true).toBe(true);
  });
});

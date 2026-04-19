import { describe, it, expect } from 'vitest';
import { assertTenantMatch } from './tenant-scope';

describe('assertTenantMatch', () => {
  const TENANT_A = 'tenant-aaa-111';
  const TENANT_B = 'tenant-bbb-222';

  it('passes when tenantId matches', () => {
    const row = { tenantId: TENANT_A };
    expect(() => assertTenantMatch(row, TENANT_A)).not.toThrow();
  });

  it('throws TenantIsolationError when tenantId does not match (R-001)', () => {
    const row = { tenantId: TENANT_B };
    try {
      assertTenantMatch(row, TENANT_A);
      expect.unreachable('Should have thrown');
    } catch (e: any) {
      expect(e.name).toBe('TenantIsolationError');
      expect(e.message).toContain('Tenant isolation violation');
    }
  });

  it('returns error, not data, for mismatched tenant (negative test — AC #11)', () => {
    const row = { tenantId: TENANT_B, secretData: 'should not be accessible' };
    let threwError = false;
    try {
      assertTenantMatch(row, TENANT_A);
    } catch {
      threwError = true;
    }
    expect(threwError).toBe(true);
  });

  it('does not throw for null/undefined rows (not a violation — just not found)', () => {
    expect(() => assertTenantMatch(null, TENANT_A)).not.toThrow();
    expect(() => assertTenantMatch(undefined, TENANT_A)).not.toThrow();
  });

  it('parametric isolation: Tenant A query returns zero rows from Tenant B (R-001)', () => {
    // Simulate: query returned rows belonging to Tenant B
    const tenantBRows = [
      { tenantId: TENANT_B, name: 'Config 1' },
      { tenantId: TENANT_B, name: 'Config 2' },
    ];

    // Verify every row would be rejected when accessed by Tenant A
    for (const row of tenantBRows) {
      expect(() => assertTenantMatch(row, TENANT_A)).toThrow('Tenant isolation violation');
    }
  });
});

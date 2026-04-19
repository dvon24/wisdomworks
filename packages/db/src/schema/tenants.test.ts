import { describe, it, expect } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { tenants, tenantConfigs, tenantStatusEnum } from './tenants';

describe('tenants schema', () => {
  it('has required columns', () => {
    const columns = getTableColumns(tenants);
    expect(columns.id).toBeDefined();
    expect(columns.name).toBeDefined();
    expect(columns.slug).toBeDefined();
    expect(columns.status).toBeDefined();
    expect(columns.createdAt).toBeDefined();
    expect(columns.updatedAt).toBeDefined();
  });

  it('defines valid tenant status values', () => {
    expect(tenantStatusEnum).toContain('onboarding');
    expect(tenantStatusEnum).toContain('provisioning');
    expect(tenantStatusEnum).toContain('active');
    expect(tenantStatusEnum).toContain('suspended');
    expect(tenantStatusEnum).toContain('decommissioned');
    expect(tenantStatusEnum).toHaveLength(5);
  });
});

describe('tenant_configs schema', () => {
  it('has required columns', () => {
    const columns = getTableColumns(tenantConfigs);
    expect(columns.id).toBeDefined();
    expect(columns.tenantId).toBeDefined();
    expect(columns.configType).toBeDefined();
    expect(columns.configData).toBeDefined();
    expect(columns.createdAt).toBeDefined();
    expect(columns.updatedAt).toBeDefined();
  });

  it('tenant_id column references tenants table', () => {
    const columns = getTableColumns(tenantConfigs);
    expect(columns.tenantId.notNull).toBe(true);
  });
});

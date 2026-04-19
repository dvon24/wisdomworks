import { describe, it, expect } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { billingRecords, billingRecordTypeEnum, billingStatusEnum } from './billing';

describe('billing_records schema', () => {
  it('has required columns', () => {
    const columns = getTableColumns(billingRecords);
    expect(columns.id).toBeDefined();
    expect(columns.tenantId).toBeDefined();
    expect(columns.type).toBeDefined();
    expect(columns.amount).toBeDefined();
    expect(columns.currency).toBeDefined();
    expect(columns.status).toBeDefined();
    expect(columns.stripePaymentId).toBeDefined();
    expect(columns.stripeSubscriptionId).toBeDefined();
    expect(columns.metadata).toBeDefined();
    expect(columns.createdAt).toBeDefined();
    expect(columns.updatedAt).toBeDefined();
  });

  it('tenantId is NOT NULL', () => {
    const columns = getTableColumns(billingRecords);
    expect(columns.tenantId.notNull).toBe(true);
  });

  it('defines valid billing types', () => {
    expect(billingRecordTypeEnum).toContain('deposit');
    expect(billingRecordTypeEnum).toContain('subscription');
    expect(billingRecordTypeEnum).toContain('invoice');
    expect(billingRecordTypeEnum).toContain('refund');
  });

  it('defines valid billing statuses', () => {
    expect(billingStatusEnum).toContain('pending');
    expect(billingStatusEnum).toContain('completed');
    expect(billingStatusEnum).toContain('failed');
    expect(billingStatusEnum).toContain('refunded');
    expect(billingStatusEnum).toContain('cancelled');
  });
});

import { describe, it, expect } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { usageEvents, usageEventTypeEnum } from './metering';

describe('usage_events schema', () => {
  it('has required columns', () => {
    const columns = getTableColumns(usageEvents);
    expect(columns.id).toBeDefined();
    expect(columns.tenantId).toBeDefined();
    expect(columns.eventType).toBeDefined();
    expect(columns.provider).toBeDefined();
    expect(columns.model).toBeDefined();
    expect(columns.inputTokens).toBeDefined();
    expect(columns.outputTokens).toBeDefined();
    expect(columns.latencyMs).toBeDefined();
    expect(columns.costEstimate).toBeDefined();
    expect(columns.createdAt).toBeDefined();
  });

  it('tenantId is required (NOT NULL)', () => {
    const columns = getTableColumns(usageEvents);
    expect(columns.tenantId.notNull).toBe(true);
  });

  it('defines valid usage event types', () => {
    expect(usageEventTypeEnum).toContain('model_call');
    expect(usageEventTypeEnum).toContain('voice_minute');
    expect(usageEventTypeEnum).toContain('sms');
    expect(usageEventTypeEnum).toContain('whatsapp');
    expect(usageEventTypeEnum).toContain('storage');
  });

  it('id is UUID type', () => {
    const columns = getTableColumns(usageEvents);
    expect(columns.id.columnType).toBe('PgUUID');
  });
});

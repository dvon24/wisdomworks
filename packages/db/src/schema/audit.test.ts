import { describe, it, expect } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { auditLogs } from './audit';

describe('audit_logs schema', () => {
  it('has required columns', () => {
    const columns = getTableColumns(auditLogs);
    expect(columns.id).toBeDefined();
    expect(columns.tenantId).toBeDefined();
    expect(columns.userId).toBeDefined();
    expect(columns.agentId).toBeDefined();
    expect(columns.action).toBeDefined();
    expect(columns.resourceType).toBeDefined();
    expect(columns.resourceId).toBeDefined();
    expect(columns.details).toBeDefined();
    expect(columns.requestId).toBeDefined();
    expect(columns.timestamp).toBeDefined();
  });

  it('tenantId is NOT NULL', () => {
    const columns = getTableColumns(auditLogs);
    expect(columns.tenantId.notNull).toBe(true);
  });

  it('id is UUID type', () => {
    const columns = getTableColumns(auditLogs);
    expect(columns.id.columnType).toBe('PgUUID');
  });

  it('details is JSONB type', () => {
    const columns = getTableColumns(auditLogs);
    expect(columns.details.columnType).toBe('PgJsonb');
  });
});

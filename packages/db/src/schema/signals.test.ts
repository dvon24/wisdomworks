import { describe, it, expect } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { signalTypes, signals, DEFAULT_SIGNAL_TYPES } from './signals';

describe('signal_types schema', () => {
  it('has required columns', () => {
    const columns = getTableColumns(signalTypes);
    expect(columns.id).toBeDefined();
    expect(columns.tenantId).toBeDefined();
    expect(columns.name).toBeDefined();
  });

  it('tenantId is NOT NULL', () => {
    expect(getTableColumns(signalTypes).tenantId.notNull).toBe(true);
  });
});

describe('signals schema', () => {
  it('has required columns', () => {
    const columns = getTableColumns(signals);
    expect(columns.id).toBeDefined();
    expect(columns.tenantId).toBeDefined();
    expect(columns.signalTypeId).toBeDefined();
    expect(columns.sourceAgentId).toBeDefined();
    expect(columns.payload).toBeDefined();
    expect(columns.status).toBeDefined();
  });

  it('payload is JSONB', () => {
    expect(getTableColumns(signals).payload.columnType).toBe('PgJsonb');
  });
});

describe('DEFAULT_SIGNAL_TYPES', () => {
  it('defines 8 signal types', () => {
    expect(DEFAULT_SIGNAL_TYPES).toHaveLength(8);
    expect(DEFAULT_SIGNAL_TYPES).toContain('task_handoff');
    expect(DEFAULT_SIGNAL_TYPES).toContain('coaching');
    expect(DEFAULT_SIGNAL_TYPES).toContain('escalation');
  });
});

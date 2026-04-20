import { describe, it, expect } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { agentConfigs, agentInstances, agentStatusEnum } from './agents';

describe('agent_configs schema', () => {
  it('has required columns', () => {
    const columns = getTableColumns(agentConfigs);
    expect(columns.id).toBeDefined();
    expect(columns.tenantId).toBeDefined();
    expect(columns.agentRole).toBeDefined();
    expect(columns.agentName).toBeDefined();
    expect(columns.modelRouting).toBeDefined();
    expect(columns.outputChannels).toBeDefined();
    expect(columns.governanceRules).toBeDefined();
    expect(columns.entityId).toBeDefined();
    expect(columns.status).toBeDefined();
  });

  it('tenantId is NOT NULL', () => {
    const columns = getTableColumns(agentConfigs);
    expect(columns.tenantId.notNull).toBe(true);
  });

  it('modelRouting is JSONB', () => {
    const columns = getTableColumns(agentConfigs);
    expect(columns.modelRouting.columnType).toBe('PgJsonb');
  });
});

describe('agent_instances schema', () => {
  it('has required columns', () => {
    const columns = getTableColumns(agentInstances);
    expect(columns.id).toBeDefined();
    expect(columns.tenantId).toBeDefined();
    expect(columns.agentConfigId).toBeDefined();
    expect(columns.status).toBeDefined();
    expect(columns.lastActivity).toBeDefined();
    expect(columns.stateData).toBeDefined();
    expect(columns.natsSubjects).toBeDefined();
  });

  it('agentConfigId is NOT NULL', () => {
    const columns = getTableColumns(agentInstances);
    expect(columns.agentConfigId.notNull).toBe(true);
  });
});

describe('agentStatusEnum', () => {
  it('defines lifecycle states', () => {
    expect(agentStatusEnum).toContain('pending');
    expect(agentStatusEnum).toContain('provisioning');
    expect(agentStatusEnum).toContain('ready');
    expect(agentStatusEnum).toContain('running');
    expect(agentStatusEnum).toContain('paused');
    expect(agentStatusEnum).toContain('stopped');
    expect(agentStatusEnum).toContain('error');
  });
});

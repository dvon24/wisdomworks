import { describe, it, expect } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { processRecords, agentSkills, lessonsLearned } from './learning';

describe('process_records schema', () => {
  it('has required columns', () => {
    const columns = getTableColumns(processRecords);
    expect(columns.id).toBeDefined();
    expect(columns.tenantId).toBeDefined();
    expect(columns.intent).toBeDefined();
    expect(columns.processSteps).toBeDefined();
    expect(columns.decisions).toBeDefined();
    expect(columns.endState).toBeDefined();
    expect(columns.evaluation).toBeDefined();
  });

  it('tenantId is NOT NULL', () => {
    expect(getTableColumns(processRecords).tenantId.notNull).toBe(true);
  });
});

describe('agent_skills schema', () => {
  it('has required columns', () => {
    const columns = getTableColumns(agentSkills);
    expect(columns.id).toBeDefined();
    expect(columns.tenantId).toBeDefined();
    expect(columns.skillName).toBeDefined();
    expect(columns.triggerConditions).toBeDefined();
    expect(columns.actionSteps).toBeDefined();
    expect(columns.evidence).toBeDefined();
    expect(columns.confidence).toBeDefined();
    expect(columns.status).toBeDefined();
  });
});

describe('lessons_learned schema', () => {
  it('has required columns', () => {
    const columns = getTableColumns(lessonsLearned);
    expect(columns.id).toBeDefined();
    expect(columns.tenantId).toBeDefined();
    expect(columns.whatWentWrong).toBeDefined();
    expect(columns.correctiveAction).toBeDefined();
    expect(columns.appliesTo).toBeDefined();
  });
});

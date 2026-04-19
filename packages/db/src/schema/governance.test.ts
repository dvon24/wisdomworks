import { describe, it, expect } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { governanceRules, governanceEvaluations, ruleEffectEnum, evaluationResultEnum } from './governance';

describe('governance_rules schema', () => {
  it('has required columns', () => {
    const columns = getTableColumns(governanceRules);
    expect(columns.id).toBeDefined();
    expect(columns.tenantId).toBeDefined();
    expect(columns.ruleType).toBeDefined();
    expect(columns.scope).toBeDefined();
    expect(columns.action).toBeDefined();
    expect(columns.effect).toBeDefined();
    expect(columns.priority).toBeDefined();
    expect(columns.config).toBeDefined();
    expect(columns.active).toBeDefined();
  });

  it('tenantId is NOT NULL', () => {
    const columns = getTableColumns(governanceRules);
    expect(columns.tenantId.notNull).toBe(true);
  });

  it('defines valid rule effects', () => {
    expect(ruleEffectEnum).toContain('allow');
    expect(ruleEffectEnum).toContain('deny');
    expect(ruleEffectEnum).toHaveLength(2);
  });
});

describe('governance_evaluations schema', () => {
  it('has required columns', () => {
    const columns = getTableColumns(governanceEvaluations);
    expect(columns.id).toBeDefined();
    expect(columns.tenantId).toBeDefined();
    expect(columns.ruleId).toBeDefined();
    expect(columns.agentId).toBeDefined();
    expect(columns.action).toBeDefined();
    expect(columns.result).toBeDefined();
    expect(columns.reasoning).toBeDefined();
    expect(columns.timestamp).toBeDefined();
  });

  it('defines valid evaluation results', () => {
    expect(evaluationResultEnum).toContain('permitted');
    expect(evaluationResultEnum).toContain('blocked');
    expect(evaluationResultEnum).toContain('escalated');
    expect(evaluationResultEnum).toHaveLength(3);
  });
});

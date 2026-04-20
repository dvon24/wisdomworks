import { describe, it, expect } from 'vitest';
import {
  AUTONOMY_LEVELS,
  AUTONOMY_DEFINITIONS,
  BASE_AGENT_PROTOCOL,
  createAgentProtocol,
} from './agent-protocol';

describe('Autonomy Levels', () => {
  it('defines 4 levels: L1-L4', () => {
    expect(AUTONOMY_LEVELS).toHaveLength(4);
    expect(AUTONOMY_LEVELS).toContain('L1');
    expect(AUTONOMY_LEVELS).toContain('L4');
  });

  it('L1 requires approval', () => {
    expect(AUTONOMY_DEFINITIONS.L1.approvalRequired).toBe(true);
  });

  it('L4 is exception-only', () => {
    expect(AUTONOMY_DEFINITIONS.L4.approvalRequired).toBe(false);
    expect(AUTONOMY_DEFINITIONS.L4.notificationMode).toBe('exception_only');
  });
});

describe('BASE_AGENT_PROTOCOL', () => {
  it('enforces tenant-scoped data only', () => {
    expect(BASE_AGENT_PROTOCOL.dataRules.tenantScopedOnly).toBe(true);
    expect(BASE_AGENT_PROTOCOL.dataRules.noCrossTenantAccess).toBe(true);
  });

  it('enforces structured signals only', () => {
    expect(BASE_AGENT_PROTOCOL.signalRules.structuredMetadataOnly).toBe(true);
  });

  it('requires audit logging for everything', () => {
    expect(BASE_AGENT_PROTOCOL.auditMandate.logAllActions).toBe(true);
    expect(BASE_AGENT_PROTOCOL.auditMandate.noSilentOperations).toBe(true);
  });

  it('includes BMAD mandate', () => {
    expect(BASE_AGENT_PROTOCOL.bmadMandate.monitorDomain).toBe(true);
    expect(BASE_AGENT_PROTOCOL.bmadMandate.generateSolutionBriefs).toBe(true);
  });

  it('defaults to L1 (most restrictive)', () => {
    expect(BASE_AGENT_PROTOCOL.autonomyLevel).toBe('L1');
  });

  it('has 5 escalation triggers', () => {
    expect(BASE_AGENT_PROTOCOL.escalationTriggers.length).toBeGreaterThanOrEqual(5);
    expect(BASE_AGENT_PROTOCOL.escalationTriggers).toContain('confidence_below_threshold');
  });
});

describe('createAgentProtocol', () => {
  it('creates protocol with specified autonomy level', () => {
    const protocol = createAgentProtocol('L3');
    expect(protocol.autonomyLevel).toBe('L3');
    // Base rules still enforced
    expect(protocol.dataRules.tenantScopedOnly).toBe(true);
    expect(protocol.auditMandate.logAllActions).toBe(true);
  });

  it('allows additional escalation triggers', () => {
    const protocol = createAgentProtocol('L2', ['custom_trigger']);
    expect(protocol.escalationTriggers).toContain('custom_trigger');
    expect(protocol.escalationTriggers).toContain('confidence_below_threshold');
  });

  it('cannot loosen base rules', () => {
    const protocol = createAgentProtocol('L4');
    // Even at L4, these are still enforced
    expect(protocol.dataRules.noCrossTenantAccess).toBe(true);
    expect(protocol.signalRules.userConsentRequired).toBe(true);
    expect(protocol.auditMandate.noSilentOperations).toBe(true);
  });
});

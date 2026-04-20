/**
 * Story 1.14 — Agent Operating Protocol & Behavioral Framework
 *
 * Every AI agent inherits this base protocol at instantiation.
 * Operators can TIGHTEN but never LOOSEN the base rules.
 */

export const AUTONOMY_LEVELS = ['L1', 'L2', 'L3', 'L4'] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

export interface AutonomyLevelDefinition {
  level: AutonomyLevel;
  name: string;
  description: string;
  approvalRequired: boolean;
  notificationMode: 'before_action' | 'after_action' | 'weekly_report' | 'exception_only';
}

export const AUTONOMY_DEFINITIONS: Record<AutonomyLevel, AutonomyLevelDefinition> = {
  L1: {
    level: 'L1',
    name: 'Approval Required',
    description: 'All actions need human approval before execution',
    approvalRequired: true,
    notificationMode: 'before_action',
  },
  L2: {
    level: 'L2',
    name: 'Notify and Act',
    description: 'Agent acts then notifies the owner',
    approvalRequired: false,
    notificationMode: 'after_action',
  },
  L3: {
    level: 'L3',
    name: 'Autonomous with Reporting',
    description: 'Agent acts autonomously, reports weekly',
    approvalRequired: false,
    notificationMode: 'weekly_report',
  },
  L4: {
    level: 'L4',
    name: 'Fully Autonomous',
    description: 'Exception-only reporting — agent escalates only on errors or novel situations',
    approvalRequired: false,
    notificationMode: 'exception_only',
  },
};

export interface AgentOperatingProtocol {
  version: string;

  dataRules: {
    tenantScopedOnly: true;
    noCrossTenantAccess: true;
    noRawEmailPersistence: true;
    purgeReclassifiedWithinMinutes: 5;
  };

  signalRules: {
    structuredMetadataOnly: true;
    userConsentRequired: true;
    governanceRulesEnforced: true;
  };

  autonomyLevel: AutonomyLevel;

  escalationTriggers: string[];

  failureProtocol: {
    modelCallFailure: 'retry_once_then_fallback_then_notify';
    peerUnreachable: 'queue_signal_retry_backoff_escalate_after_3';
  };

  auditMandate: {
    logAllActions: true;
    logAllDecisions: true;
    logAllSignals: true;
    noSilentOperations: true;
  };

  bmadMandate: {
    monitorDomain: true;
    detectPatterns: true;
    generateSolutionBriefs: true;
  };
}

/** The base protocol every agent inherits. Cannot be loosened. */
export const BASE_AGENT_PROTOCOL: AgentOperatingProtocol = {
  version: '1.0.0',
  dataRules: {
    tenantScopedOnly: true,
    noCrossTenantAccess: true,
    noRawEmailPersistence: true,
    purgeReclassifiedWithinMinutes: 5,
  },
  signalRules: {
    structuredMetadataOnly: true,
    userConsentRequired: true,
    governanceRulesEnforced: true,
  },
  autonomyLevel: 'L1', // Default — most restrictive. Upgradeable per agent.
  escalationTriggers: [
    'confidence_below_threshold',
    'financial_impact_above_limit',
    'compliance_boundary_crossed',
    'novel_situation_no_matching_rule',
    'consecutive_failures',
  ],
  failureProtocol: {
    modelCallFailure: 'retry_once_then_fallback_then_notify',
    peerUnreachable: 'queue_signal_retry_backoff_escalate_after_3',
  },
  auditMandate: {
    logAllActions: true,
    logAllDecisions: true,
    logAllSignals: true,
    noSilentOperations: true,
  },
  bmadMandate: {
    monitorDomain: true,
    detectPatterns: true,
    generateSolutionBriefs: true,
  },
};

/**
 * Create a protocol for an agent with a specific autonomy level.
 * The base rules cannot be loosened — only autonomy level and escalation can be customized.
 */
export function createAgentProtocol(
  autonomyLevel: AutonomyLevel = 'L1',
  additionalEscalationTriggers: string[] = [],
): AgentOperatingProtocol {
  return {
    ...BASE_AGENT_PROTOCOL,
    autonomyLevel,
    escalationTriggers: [
      ...BASE_AGENT_PROTOCOL.escalationTriggers,
      ...additionalEscalationTriggers,
    ],
  };
}

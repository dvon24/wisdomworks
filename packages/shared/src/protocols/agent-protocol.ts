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

/**
 * Story 1.14 — pick a sensible default autonomy level per agent based on its
 * role. Coordinator/orchestrator agents start at L2 (notify-and-act) because
 * they're the user's mouthpiece. Specialist worker agents (sales, marketing,
 * finance) start at L1 (approval-required) because their actions have
 * external impact. Owner can promote per-agent later.
 */
export function getDefaultAutonomyForRole(role: string, name: string): AutonomyLevel {
  const haystack = `${role} ${name}`.toLowerCase();
  if (/orchestrat|coordinator|personal assistant|chief of staff/.test(haystack)) return 'L2';
  if (/research|insights|analytics|intelligence/.test(haystack)) return 'L3';
  // Anything externally-acting (email, sales, marketing, finance) defaults to L1
  return 'L1';
}

interface TenantProtocolOverride {
  autonomyLevel?: AutonomyLevel;
  additionalEscalationTriggers?: string[];
  // Tenants can ADD strict requirements but can't disable any of these
  // (the function drops any false values silently).
  dataRules?: Partial<AgentOperatingProtocol['dataRules']>;
  signalRules?: Partial<AgentOperatingProtocol['signalRules']>;
}

const AUTONOMY_RANK: Record<AutonomyLevel, number> = { L1: 0, L2: 1, L3: 2, L4: 3 };

/**
 * Merge a per-agent default protocol with a tenant-level override. Enforces
 * the "tighten not loosen" rule — operators can ONLY make things stricter:
 *
 *   - autonomyLevel can only DECREASE (more approval, not less)
 *   - escalation triggers can only be ADDED, never removed
 *   - data/signal rule flags can only be set TRUE (enabled), never FALSE
 *
 * Audit + BMAD mandates are baked into BASE_AGENT_PROTOCOL and never moved.
 */
export function mergeTenantProtocol(
  base: AgentOperatingProtocol,
  override: TenantProtocolOverride | null | undefined,
): AgentOperatingProtocol {
  if (!override) return base;

  // Autonomy: take the more conservative (lower-rank) of the two
  let resolvedAutonomy = base.autonomyLevel;
  if (override.autonomyLevel && AUTONOMY_RANK[override.autonomyLevel] < AUTONOMY_RANK[resolvedAutonomy]) {
    resolvedAutonomy = override.autonomyLevel;
  }

  // Escalation triggers: union (add only)
  const escalationTriggers = Array.from(new Set([
    ...base.escalationTriggers,
    ...(override.additionalEscalationTriggers ?? []),
  ]));

  // Data/signal rules: only allow TRUE flags (loosening to false ignored)
  const dataRules = { ...base.dataRules };
  for (const [k, v] of Object.entries(override.dataRules ?? {})) {
    if (v === true) (dataRules as any)[k] = true;
  }
  const signalRules = { ...base.signalRules };
  for (const [k, v] of Object.entries(override.signalRules ?? {})) {
    if (v === true) (signalRules as any)[k] = true;
  }

  return {
    ...base,
    autonomyLevel: resolvedAutonomy,
    escalationTriggers,
    dataRules,
    signalRules,
  };
}

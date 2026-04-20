/**
 * Leadership Coach Agent Behavior Definition
 *
 * The Leadership Coach has three roles:
 * 1. Coach the HUMAN — skills development, scenario practice
 * 2. Coach the AGENTS — performance analysis, improvement signals
 * 3. Performance FEEDBACK — business, operational, leadership insights
 *
 * Auto-provisioned by the Axis team when a management role is detected.
 */

import type { AgentSpec, AgentGovernanceRule } from '../types/deployment-spec';

/** Topics the Leadership Coach can help humans with */
export const HUMAN_COACHING_CAPABILITIES = [
  'difficult_conversations',
  'performance_review_preparation',
  'delegation_strategies',
  'conflict_resolution',
  'team_dynamics_analysis',
  'situational_leadership',
  'decision_making',
  'executive_presence',
  'scenario_practice',
] as const;

/** What the Leadership Coach monitors in other agents */
export const AGENT_COACHING_SIGNALS = [
  'declining_effectiveness',
  'communication_friction',
  'repeated_escalations',
  'missed_deadlines',
  'low_confidence_scores',
  'governance_violations',
  'coordination_failures',
] as const;

/** Performance feedback dimensions */
export const FEEDBACK_DIMENSIONS = {
  business: [
    'revenue_trends',
    'client_engagement_gaps',
    'missed_opportunities',
    'growth_indicators',
  ],
  operational: [
    'time_on_delegatable_tasks',
    'autonomy_level_recommendations',
    'process_bottlenecks',
    'agent_utilization',
  ],
  leadership: [
    'micromanagement_patterns',
    'bmad_proposal_response_rate',
    'decision_consistency',
    'delegation_effectiveness',
    'team_morale_signals',
  ],
} as const;

export type FeedbackCadence = 'realtime' | 'daily_digest' | 'weekly_summary';

export interface LeadershipCoachConfig {
  /** Coaching capabilities enabled for this deployment */
  humanCoachingEnabled: boolean;
  /** Agent-to-agent coaching enabled */
  agentCoachingEnabled: boolean;
  /** Performance feedback enabled */
  performanceFeedbackEnabled: boolean;
  /** How often feedback is delivered */
  feedbackCadence: FeedbackCadence;
  /** Feedback delivery channel */
  feedbackChannel: string;
  /** Minimum confidence before sending agent coaching signal */
  agentCoachingConfidenceThreshold: number;
}

export const DEFAULT_LEADERSHIP_COACH_CONFIG: LeadershipCoachConfig = {
  humanCoachingEnabled: true,
  agentCoachingEnabled: true,
  performanceFeedbackEnabled: true,
  feedbackCadence: 'weekly_summary',
  feedbackChannel: 'whatsapp',
  agentCoachingConfidenceThreshold: 0.7,
};

/**
 * Create the Leadership Coach agent spec.
 * Called by the Axis team when a management role is detected.
 */
export function createLeadershipCoachSpec(
  config: Partial<LeadershipCoachConfig> = {},
): AgentSpec {
  const finalConfig = { ...DEFAULT_LEADERSHIP_COACH_CONFIG, ...config };

  return {
    role: 'leadership_coach',
    name: 'Leadership Coach',
    modelRouting: {
      coaching: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-6-20260416',
        fallback: { provider: 'openai', model: 'gpt-5.4' },
      },
      scenario_practice: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-6-20260416',
      },
      agent_performance_analysis: {
        provider: 'openai',
        model: 'gpt-4o',
      },
      feedback_generation: {
        provider: 'openai',
        model: 'gpt-4o',
      },
      friction_mediation: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-6-20260416',
      },
    },
    outputChannels: [finalConfig.feedbackChannel, 'dashboard'],
    governanceRules: [
      { action: 'coaching_human', effect: 'allow' },
      { action: 'coaching_agent', effect: 'allow' },
      { action: 'performance_feedback', effect: 'allow' },
      { action: 'mediate_friction', effect: 'allow' },
      // Can read peer agent signals and audit data for coaching
      { action: 'read_agent_signals', effect: 'allow' },
      { action: 'read_audit_data', effect: 'allow' },
    ],
  };
}

/**
 * Check if a role should have a Leadership Coach provisioned.
 * Any role that manages others gets a coach.
 */
export function shouldProvisionLeadershipCoach(
  roleRelationships: { type: string; targetRole: string }[],
): boolean {
  return roleRelationships.some(
    (r) => r.type === 'manages' || r.type === 'leads' || r.type === 'supervises',
  );
}

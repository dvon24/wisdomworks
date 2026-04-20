import { describe, it, expect } from 'vitest';
import {
  HUMAN_COACHING_CAPABILITIES,
  AGENT_COACHING_SIGNALS,
  FEEDBACK_DIMENSIONS,
  DEFAULT_LEADERSHIP_COACH_CONFIG,
  createLeadershipCoachSpec,
  shouldProvisionLeadershipCoach,
} from './leadership-coach';

describe('Leadership Coach', () => {
  it('defines human coaching capabilities', () => {
    expect(HUMAN_COACHING_CAPABILITIES).toContain('difficult_conversations');
    expect(HUMAN_COACHING_CAPABILITIES).toContain('scenario_practice');
    expect(HUMAN_COACHING_CAPABILITIES.length).toBeGreaterThanOrEqual(8);
  });

  it('defines agent coaching signals to monitor', () => {
    expect(AGENT_COACHING_SIGNALS).toContain('declining_effectiveness');
    expect(AGENT_COACHING_SIGNALS).toContain('coordination_failures');
  });

  it('defines feedback across 3 dimensions', () => {
    expect(FEEDBACK_DIMENSIONS.business.length).toBeGreaterThan(0);
    expect(FEEDBACK_DIMENSIONS.operational.length).toBeGreaterThan(0);
    expect(FEEDBACK_DIMENSIONS.leadership.length).toBeGreaterThan(0);
  });

  it('default config enables all coaching types', () => {
    expect(DEFAULT_LEADERSHIP_COACH_CONFIG.humanCoachingEnabled).toBe(true);
    expect(DEFAULT_LEADERSHIP_COACH_CONFIG.agentCoachingEnabled).toBe(true);
    expect(DEFAULT_LEADERSHIP_COACH_CONFIG.performanceFeedbackEnabled).toBe(true);
    expect(DEFAULT_LEADERSHIP_COACH_CONFIG.feedbackCadence).toBe('weekly_summary');
  });
});

describe('createLeadershipCoachSpec', () => {
  it('creates a valid agent spec', () => {
    const spec = createLeadershipCoachSpec();
    expect(spec.role).toBe('leadership_coach');
    expect(spec.name).toBe('Leadership Coach');
    expect(Object.keys(spec.modelRouting).length).toBeGreaterThanOrEqual(4);
    expect(spec.outputChannels).toContain('dashboard');
  });

  it('uses Anthropic for coaching tasks', () => {
    const spec = createLeadershipCoachSpec();
    expect(spec.modelRouting.coaching.provider).toBe('anthropic');
    expect(spec.modelRouting.scenario_practice.provider).toBe('anthropic');
  });

  it('allows custom config overrides', () => {
    const spec = createLeadershipCoachSpec({ feedbackChannel: 'email' });
    expect(spec.outputChannels).toContain('email');
  });

  it('has governance rules for agent coaching', () => {
    const spec = createLeadershipCoachSpec();
    expect(spec.governanceRules.some((r) => r.action === 'coaching_agent')).toBe(true);
    expect(spec.governanceRules.some((r) => r.action === 'read_agent_signals')).toBe(true);
  });
});

describe('shouldProvisionLeadershipCoach', () => {
  it('returns true when role manages others', () => {
    expect(shouldProvisionLeadershipCoach([
      { type: 'manages', targetRole: 'developer' },
    ])).toBe(true);
  });

  it('returns false when role has no management relationships', () => {
    expect(shouldProvisionLeadershipCoach([
      { type: 'reports_to', targetRole: 'manager' },
      { type: 'collaborates_with', targetRole: 'designer' },
    ])).toBe(false);
  });

  it('returns false for empty relationships', () => {
    expect(shouldProvisionLeadershipCoach([])).toBe(false);
  });
});

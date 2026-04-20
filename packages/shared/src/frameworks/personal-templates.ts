/**
 * Personal Templates — for individual (non-business) use.
 * Same AxisDeploymentSpec schema as business templates.
 * Stricter privacy governance defaults, especially for Health & Wellness.
 */

import type { AgentSpec, AgentGovernanceRule } from '../types/deployment-spec';

export interface PersonalTemplate {
  id: string;
  name: string;
  description: string;
  defaultAgents: AgentSpec[];
  privacyLevel: 'standard' | 'strict' | 'hipaa';
  defaultGovernanceOverrides: AgentGovernanceRule[];
}

/** HIPAA-grade governance rules for health/wellness templates */
const HIPAA_GOVERNANCE: AgentGovernanceRule[] = [
  { action: 'share_data', effect: 'deny' },
  { action: 'export_data', effect: 'deny', conditions: { requiresApproval: true } },
  { action: 'access_notes', effect: 'allow', conditions: { auditTrailRequired: true } },
];

export const PERSONAL_TEMPLATES: PersonalTemplate[] = [
  {
    id: 'personal_assistant',
    name: 'Personal Assistant',
    description: 'Calendar, reminders, task management, life organization',
    defaultAgents: [
      {
        role: 'assistant',
        name: 'Personal Assistant',
        modelRouting: {
          task_management: { provider: 'openai', model: 'gpt-4o-mini' },
          scheduling: { provider: 'openai', model: 'gpt-4o-mini' },
          writing: { provider: 'openai', model: 'gpt-4o' },
        },
        outputChannels: ['whatsapp', 'calendar'],
        governanceRules: [{ action: '*', effect: 'allow' }],
      },
      {
        role: 'organizer',
        name: 'Life Organizer',
        modelRouting: {
          reminders: { provider: 'openai', model: 'gpt-4o-mini' },
          planning: { provider: 'openai', model: 'gpt-4o' },
        },
        outputChannels: ['whatsapp', 'sms'],
        governanceRules: [{ action: '*', effect: 'allow' }],
      },
    ],
    privacyLevel: 'standard',
    defaultGovernanceOverrides: [],
  },
  {
    id: 'creative_professional',
    name: 'Creative Professional',
    description: 'Personal brand, trend curation, portfolio management, inspiration',
    defaultAgents: [
      {
        role: 'brand_manager',
        name: 'Brand Manager',
        modelRouting: {
          content_creation: { provider: 'openai', model: 'gpt-4o' },
          trend_analysis: { provider: 'openai', model: 'gpt-4o' },
          social_strategy: { provider: 'openai', model: 'gpt-4o' },
        },
        outputChannels: ['whatsapp', 'email'],
        governanceRules: [
          { action: 'post_public', effect: 'deny', conditions: { requiresApproval: true } },
        ],
      },
      {
        role: 'inspiration',
        name: 'Inspiration Agent',
        modelRouting: {
          curation: { provider: 'openai', model: 'gpt-4o-mini' },
          research: { provider: 'openai', model: 'gpt-4o' },
        },
        outputChannels: ['whatsapp'],
        governanceRules: [{ action: '*', effect: 'allow' }],
      },
      {
        role: 'portfolio',
        name: 'Portfolio Manager',
        modelRouting: {
          organization: { provider: 'openai', model: 'gpt-4o-mini' },
          presentation: { provider: 'openai', model: 'gpt-4o' },
        },
        outputChannels: ['email', 'dashboard'],
        governanceRules: [{ action: '*', effect: 'allow' }],
      },
    ],
    privacyLevel: 'standard',
    defaultGovernanceOverrides: [],
  },
  {
    id: 'health_wellness',
    name: 'Health & Wellness',
    description: 'Session notes, health tracking, journaling, wellness routines — HIPAA-grade privacy',
    defaultAgents: [
      {
        role: 'wellness_coach',
        name: 'Wellness Coach',
        modelRouting: {
          journaling_prompts: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
          wellness_planning: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
          health_tracking: { provider: 'openai', model: 'gpt-4o-mini' },
        },
        outputChannels: ['whatsapp'],
        governanceRules: HIPAA_GOVERNANCE,
      },
      {
        role: 'session_notes',
        name: 'Session Notes Agent',
        modelRouting: {
          note_taking: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
          summary: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
        },
        outputChannels: ['dashboard'],
        governanceRules: HIPAA_GOVERNANCE,
      },
    ],
    privacyLevel: 'hipaa',
    defaultGovernanceOverrides: HIPAA_GOVERNANCE,
  },
  {
    id: 'student',
    name: 'Student',
    description: 'Assignment management, study schedules, career prep, research assistance',
    defaultAgents: [
      {
        role: 'study_assistant',
        name: 'Study Assistant',
        modelRouting: {
          homework_help: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
          scheduling: { provider: 'openai', model: 'gpt-4o-mini' },
          research: { provider: 'openai', model: 'gpt-4o' },
        },
        outputChannels: ['whatsapp', 'calendar'],
        governanceRules: [{ action: '*', effect: 'allow' }],
      },
      {
        role: 'career_prep',
        name: 'Career Prep Agent',
        modelRouting: {
          resume_review: { provider: 'openai', model: 'gpt-4o' },
          interview_prep: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
        },
        outputChannels: ['whatsapp', 'email'],
        governanceRules: [{ action: '*', effect: 'allow' }],
      },
    ],
    privacyLevel: 'standard',
    defaultGovernanceOverrides: [],
  },
  {
    id: 'leadership_development',
    name: 'Leadership Development',
    description: 'Coaching, scenario practice, reading curation, 360-feedback, executive presence',
    defaultAgents: [
      {
        role: 'leadership_coach',
        name: 'Leadership Coach',
        modelRouting: {
          coaching: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
          scenario_practice: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
          feedback_analysis: { provider: 'openai', model: 'gpt-4o' },
        },
        outputChannels: ['whatsapp', 'email'],
        governanceRules: [{ action: '*', effect: 'allow' }],
      },
      {
        role: 'learning_curator',
        name: 'Learning Curator',
        modelRouting: {
          reading_list: { provider: 'openai', model: 'gpt-4o' },
          insight_summary: { provider: 'openai', model: 'gpt-4o-mini' },
        },
        outputChannels: ['whatsapp'],
        governanceRules: [{ action: '*', effect: 'allow' }],
      },
    ],
    privacyLevel: 'standard',
    defaultGovernanceOverrides: [],
  },
];

/** Personal blueprint definitions (from Story 0.9 — added here for completeness) */
export const PERSONAL_BLUEPRINTS = {
  individual: {
    type: 'personal' as const,
    label: 'Individual',
    userRange: [1, 1] as [number, number],
    agentRange: [2, 3] as [number, number],
    priceRange: [5, 15] as [number, number],
    description: 'Single user personal assistant',
  },
  family: {
    type: 'personal' as const,
    label: 'Family',
    userRange: [2, 6] as [number, number],
    agentRange: [4, 8] as [number, number],
    priceRange: [15, 30] as [number, number],
    description: 'Family household coordination',
  },
  creator: {
    type: 'personal' as const,
    label: 'Creator',
    userRange: [1, 1] as [number, number],
    agentRange: [4, 6] as [number, number],
    priceRange: [20, 40] as [number, number],
    description: 'Content creator with brand/content focus',
  },
};

export function getPersonalTemplate(id: string): PersonalTemplate | undefined {
  return PERSONAL_TEMPLATES.find((t) => t.id === id);
}

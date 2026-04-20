/**
 * AxisDeploymentSpec — the complete deployment configuration for a customer.
 * Generated from: Blueprint × Template × Onboarding Conversation
 * Stored in: tenant_configs with config_type = 'deployment_spec'
 */

import type { AIProvider } from '../ai/model-provider';

export interface AxisDeploymentSpec {
  organization: {
    name: string;
    industry: string;
    size: 'solo' | 'small_team' | 'mid_size' | 'enterprise';
    compliance?: string[];
  };
  surfaces: {
    webDashboard: boolean;
    website?: boolean;
    mobileApp?: boolean;
    desktopApp?: boolean;
    globe?: boolean;
  };
  agents: AgentSpec[];
  integrations: IntegrationSpec[];
  pricing: PricingSpec;
  blueprint: BlueprintType;
  template: string;
}

export interface AgentSpec {
  role: string;
  name: string;
  modelRouting: Record<string, ModelRoutingEntry>;
  outputChannels: string[];
  governanceRules: AgentGovernanceRule[];
}

export interface ModelRoutingEntry {
  provider: AIProvider;
  model: string;
  benchmarkScore?: number;
  fallback?: {
    provider: AIProvider;
    model: string;
  };
}

export interface AgentGovernanceRule {
  action: string;
  effect: 'allow' | 'deny';
  conditions?: Record<string, unknown>;
}

export interface IntegrationSpec {
  type: string;
  config: Record<string, unknown>;
  status?: 'configured' | 'pending' | 'disabled';
}

export interface PricingSpec {
  tier: BlueprintType;
  monthlyBase: number;
  modelCostEstimate: number;
  total: number;
  deposit: number;
  trialDays: number;
}

export type BlueprintType =
  | 'personal'
  | 'solo'
  | 'small_team'
  | 'mid_size'
  | 'enterprise'
  | 'air_gapped';

export interface BlueprintDefinition {
  type: BlueprintType;
  label: string;
  agentCountRange: [number, number];
  signalComplexity: 'linear' | 'hub_spoke' | 'mesh' | 'hierarchical';
  governanceDepth: 'minimal' | 'light' | 'standard' | 'strict' | 'maximum';
  description: string;
}

/** All available blueprints */
export const BLUEPRINTS: Record<BlueprintType, BlueprintDefinition> = {
  personal: {
    type: 'personal',
    label: 'Personal',
    agentCountRange: [2, 3],
    signalComplexity: 'linear',
    governanceDepth: 'minimal',
    description: 'Individual use — personal assistant, creative, wellness, student, leadership development',
  },
  solo: {
    type: 'solo',
    label: 'Solo Business',
    agentCountRange: [3, 4],
    signalComplexity: 'linear',
    governanceDepth: 'minimal',
    description: '1-2 people — hair stylist, electrician, freelancer',
  },
  small_team: {
    type: 'small_team',
    label: 'Small Team',
    agentCountRange: [8, 12],
    signalComplexity: 'hub_spoke',
    governanceDepth: 'light',
    description: '3-20 people — small restaurant, real estate office, small shop',
  },
  mid_size: {
    type: 'mid_size',
    label: 'Mid-Size Organization',
    agentCountRange: [30, 60],
    signalComplexity: 'mesh',
    governanceDepth: 'standard',
    description: '20-200 people — consulting firm, mid-size manufacturer',
  },
  enterprise: {
    type: 'enterprise',
    label: 'Enterprise',
    agentCountRange: [100, 300],
    signalComplexity: 'hierarchical',
    governanceDepth: 'strict',
    description: '200+ people — defense contractor, hospital system, large corporation',
  },
  air_gapped: {
    type: 'air_gapped',
    label: 'Air-Gapped',
    agentCountRange: [1, 300],
    signalComplexity: 'hierarchical',
    governanceDepth: 'maximum',
    description: 'Any size — SCIF, classified environments, zero internet dependency',
  },
};

/** Seed example: Solo hair stylist */
export const SOLO_EXAMPLE: AxisDeploymentSpec = {
  organization: { name: 'Salon Bella', industry: 'personal_services', size: 'solo' },
  surfaces: { webDashboard: true, website: true },
  agents: [
    {
      role: 'scheduler',
      name: 'Scheduling Agent',
      modelRouting: {
        parse_appointments: { provider: 'openai', model: 'gpt-4o-mini' },
        write_confirmations: { provider: 'openai', model: 'gpt-4o-mini' },
      },
      outputChannels: ['whatsapp', 'sms', 'calendar'],
      governanceRules: [{ action: '*', effect: 'allow' }],
    },
    {
      role: 'marketing',
      name: 'Marketing Agent',
      modelRouting: {
        write_promos: { provider: 'openai', model: 'gpt-4o' },
        analyze_engagement: { provider: 'openai', model: 'gpt-4o-mini' },
      },
      outputChannels: ['email', 'whatsapp'],
      governanceRules: [
        { action: 'send_external', effect: 'deny', conditions: { requiresApproval: true } },
      ],
    },
    {
      role: 'customer_service',
      name: 'Customer Care Agent',
      modelRouting: {
        respond_reviews: { provider: 'openai', model: 'gpt-4o' },
        followup: { provider: 'openai', model: 'gpt-4o-mini' },
      },
      outputChannels: ['email', 'whatsapp'],
      governanceRules: [{ action: '*', effect: 'allow' }],
    },
  ],
  integrations: [
    { type: 'calendar', config: { provider: 'google' }, status: 'pending' },
  ],
  pricing: { tier: 'solo', monthlyBase: 75, modelCostEstimate: 12, total: 87, deposit: 50, trialDays: 30 },
  blueprint: 'solo',
  template: 'small_business',
};

/** Seed example: Mid-size consulting firm */
export const MID_SIZE_EXAMPLE: AxisDeploymentSpec = {
  organization: { name: 'WisdomWorks Consulting', industry: 'professional_services', size: 'mid_size', compliance: ['SOC2'] },
  surfaces: { webDashboard: true, website: true, desktopApp: true, globe: true },
  agents: [
    {
      role: 'founder',
      name: 'Founder Agent',
      modelRouting: {
        orchestration: { provider: 'anthropic', model: 'claude-sonnet-4-6-20260416' },
        strategy: { provider: 'anthropic', model: 'claude-sonnet-4-6-20260416' },
      },
      outputChannels: ['email', 'dashboard'],
      governanceRules: [{ action: '*', effect: 'allow' }],
    },
    {
      role: 'cto',
      name: 'CTO Agent',
      modelRouting: {
        architecture: { provider: 'anthropic', model: 'claude-sonnet-4-6-20260416' },
        code_review: { provider: 'anthropic', model: 'claude-sonnet-4-6-20260416' },
      },
      outputChannels: ['email', 'terminal', 'dashboard'],
      governanceRules: [{ action: '*', effect: 'allow' }],
    },
  ],
  integrations: [
    { type: 'email', config: { provider: 'exchange' }, status: 'configured' },
    { type: 'calendar', config: { provider: 'outlook' }, status: 'configured' },
    { type: 'directory', config: { provider: 'entra_id' }, status: 'configured' },
  ],
  pricing: { tier: 'mid_size', monthlyBase: 2000, modelCostEstimate: 150, total: 2150, deposit: 500, trialDays: 60 },
  blueprint: 'mid_size',
  template: 'professional_services',
};

/**
 * Story 1.7 — AxisDeploymentSpec Generation from Onboarding Data
 *
 * Takes collected onboarding data + suggested blueprint/template
 * and produces a validated AxisDeploymentSpec.
 */

import type { AxisDeploymentSpec, BlueprintType, PricingSpec } from '../types/deployment-spec';
import { BLUEPRINTS } from '../types/deployment-spec';
import { axisDeploymentSpecSchema } from '../schemas/deployment-spec-schema';
import { findTemplateForBusiness, getTemplate } from '../frameworks';
import { suggestBlueprint } from './onboarding-engine';
import type { OnboardingData } from './onboarding-engine';

/** Deposit amounts by tier */
const DEPOSIT_AMOUNTS: Record<BlueprintType, number> = {
  personal: 10,
  solo: 50,
  small_team: 200,
  mid_size: 500,
  enterprise: 2000,
  air_gapped: 5000,
};

/** Trial days by tier */
const TRIAL_DAYS: Record<BlueprintType, number> = {
  personal: 30,
  solo: 30,
  small_team: 30,
  mid_size: 60,
  enterprise: 60,
  air_gapped: 60,
};

/** Base monthly pricing by tier */
const BASE_PRICING: Record<BlueprintType, number> = {
  personal: 10,
  solo: 75,
  small_team: 200,
  mid_size: 2000,
  enterprise: 10000,
  air_gapped: 0,
};

/**
 * Generate an AxisDeploymentSpec from onboarding data.
 * Returns a validated spec or throws on validation failure.
 */
export function generateDeploymentSpec(data: OnboardingData): AxisDeploymentSpec {
  const blueprint = suggestBlueprint(data.employeeCount ?? 1);
  const businessType = data.businessType ?? data.industry ?? 'unknown';
  const templateMatch = findTemplateForBusiness(businessType);
  const template = templateMatch ?? getTemplate('small_business')!;
  const templateId = template.id;

  // Determine surfaces
  const isLargeOrg = blueprint === 'mid_size' || blueprint === 'enterprise';
  const surfaces = {
    webDashboard: true,
    website: data.desiredCapabilities?.includes('website') ?? !isLargeOrg,
    desktopApp: isLargeOrg,
    globe: isLargeOrg,
  };

  // Build agent roster from template
  const agents = template.defaultAgents.map((agent) => ({
    ...agent,
  }));

  // Determine integrations from existing tools
  const integrations = (data.existingTools ?? []).map((tool) => ({
    type: tool,
    config: {},
    status: 'pending' as const,
  }));

  // Calculate pricing
  const modelCostEstimate = estimateModelCosts(agents.length, blueprint);
  const pricing: PricingSpec = {
    tier: blueprint,
    monthlyBase: BASE_PRICING[blueprint],
    modelCostEstimate,
    total: BASE_PRICING[blueprint] + modelCostEstimate,
    deposit: DEPOSIT_AMOUNTS[blueprint],
    trialDays: TRIAL_DAYS[blueprint],
  };

  const spec: AxisDeploymentSpec = {
    organization: {
      name: data.organizationName ?? 'Unnamed Organization',
      industry: data.industry ?? 'unknown',
      size: blueprint === 'personal' ? 'solo' : blueprint === 'air_gapped' ? 'enterprise' : blueprint as any,
      compliance: data.complianceRequirements,
    },
    surfaces,
    agents,
    integrations,
    pricing,
    blueprint,
    template: templateId,
  };

  // Validate against Zod schema
  axisDeploymentSpecSchema.parse(spec);

  return spec;
}

function estimateModelCosts(agentCount: number, tier: BlueprintType): number {
  const costPerAgentPerMonth: Record<BlueprintType, number> = {
    personal: 0.50,
    solo: 3,
    small_team: 4,
    mid_size: 3,
    enterprise: 2.5,
    air_gapped: 0,
  };
  return Math.round(agentCount * (costPerAgentPerMonth[tier] ?? 3));
}

/**
 * Story 1.8 — Generate preview data from a spec.
 */
export interface DeploymentPreview {
  agentRoster: { role: string; name: string; capabilities: string[] }[];
  costBreakdown: {
    tier: string;
    monthlyBase: number;
    modelCosts: number;
    total: number;
    deposit: number;
    trialDays: number;
  };
  surfaces: string[];
  integrations: string[];
  blueprint: string;
  template: string;
}

export function generatePreview(spec: AxisDeploymentSpec): DeploymentPreview {
  return {
    agentRoster: spec.agents.map((a) => ({
      role: a.role,
      name: a.name,
      capabilities: Object.keys(a.modelRouting),
    })),
    costBreakdown: {
      tier: spec.pricing.tier,
      monthlyBase: spec.pricing.monthlyBase,
      modelCosts: spec.pricing.modelCostEstimate,
      total: spec.pricing.total,
      deposit: spec.pricing.deposit,
      trialDays: spec.pricing.trialDays,
    },
    surfaces: Object.entries(spec.surfaces)
      .filter(([_, v]) => v)
      .map(([k]) => k),
    integrations: spec.integrations.map((i) => i.type),
    blueprint: spec.blueprint,
    template: spec.template,
  };
}

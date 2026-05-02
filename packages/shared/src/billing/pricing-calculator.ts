/**
 * Dynamic Pricing Calculator — determines monthly cost based on actual usage profile.
 *
 * Price = (agent costs + estimated token usage + platform fee) × margin multiplier
 *
 * The customer never sees the breakdown. They see one number: "$X/month for your AI team."
 * We see the margin on the backend.
 */

// ─── Token Costs (per 1M tokens, as of 2026) ───

const TOKEN_COSTS = {
  'opus': { input: 15, output: 75, cachedInput: 1.5 },
  'sonnet': { input: 3, output: 15, cachedInput: 0.30 },
  'haiku': { input: 0.80, output: 4, cachedInput: 0.08 },
} as const;

type ModelTier = keyof typeof TOKEN_COSTS;

// ─── Business Complexity Profiles ───
// Business type determines what KIND of work agents do, which determines model mix

interface ComplexityProfile {
  /** Multiplier on base cost — complex work costs more */
  costMultiplier: number;
  /** Override model tier for client-facing agents */
  clientFacingTier: ModelTier;
  /** Override model tier for analysis/strategy agents */
  analysisTier: ModelTier;
  /** How often oversight needs to run (higher = more frequent) */
  oversightFrequency: number;
}

const BUSINESS_COMPLEXITY: Record<string, ComplexityProfile> = {
  // Simple operations — mostly scheduling, reminders, basic comms
  beauty: { costMultiplier: 1.0, clientFacingTier: 'haiku', analysisTier: 'haiku', oversightFrequency: 0.5 },
  salon: { costMultiplier: 1.0, clientFacingTier: 'haiku', analysisTier: 'haiku', oversightFrequency: 0.5 },
  restaurant: { costMultiplier: 1.1, clientFacingTier: 'haiku', analysisTier: 'sonnet', oversightFrequency: 0.5 },
  retail: { costMultiplier: 1.1, clientFacingTier: 'haiku', analysisTier: 'sonnet', oversightFrequency: 0.5 },
  fitness: { costMultiplier: 1.0, clientFacingTier: 'haiku', analysisTier: 'haiku', oversightFrequency: 0.5 },
  cleaning: { costMultiplier: 1.0, clientFacingTier: 'haiku', analysisTier: 'haiku', oversightFrequency: 0.5 },

  // Moderate complexity — content, sales, coordination
  marketing: { costMultiplier: 1.8, clientFacingTier: 'sonnet', analysisTier: 'sonnet', oversightFrequency: 1.0 },
  real_estate: { costMultiplier: 1.5, clientFacingTier: 'sonnet', analysisTier: 'sonnet', oversightFrequency: 1.0 },
  ecommerce: { costMultiplier: 1.3, clientFacingTier: 'haiku', analysisTier: 'sonnet', oversightFrequency: 0.8 },
  construction: { costMultiplier: 1.4, clientFacingTier: 'haiku', analysisTier: 'sonnet', oversightFrequency: 1.0 },
  logistics: { costMultiplier: 1.4, clientFacingTier: 'haiku', analysisTier: 'sonnet', oversightFrequency: 1.0 },
  healthcare: { costMultiplier: 1.6, clientFacingTier: 'sonnet', analysisTier: 'sonnet', oversightFrequency: 1.5 },
  education: { costMultiplier: 1.3, clientFacingTier: 'sonnet', analysisTier: 'sonnet', oversightFrequency: 0.8 },

  // High complexity — analysis, compliance, reasoning-heavy
  legal: { costMultiplier: 2.5, clientFacingTier: 'sonnet', analysisTier: 'opus', oversightFrequency: 2.0 },
  finance: { costMultiplier: 2.3, clientFacingTier: 'sonnet', analysisTier: 'opus', oversightFrequency: 2.0 },
  accounting: { costMultiplier: 2.3, clientFacingTier: 'sonnet', analysisTier: 'opus', oversightFrequency: 2.0 },
  insurance: { costMultiplier: 2.0, clientFacingTier: 'sonnet', analysisTier: 'opus', oversightFrequency: 1.5 },
  consulting: { costMultiplier: 2.0, clientFacingTier: 'sonnet', analysisTier: 'opus', oversightFrequency: 1.5 },
  technology: { costMultiplier: 2.8, clientFacingTier: 'sonnet', analysisTier: 'opus', oversightFrequency: 2.0 },
  engineering: { costMultiplier: 2.5, clientFacingTier: 'sonnet', analysisTier: 'opus', oversightFrequency: 2.0 },
  defense: { costMultiplier: 3.0, clientFacingTier: 'sonnet', analysisTier: 'opus', oversightFrequency: 3.0 },
};

/** Default complexity for unknown business types */
const DEFAULT_COMPLEXITY: ComplexityProfile = {
  costMultiplier: 1.5,
  clientFacingTier: 'haiku',
  analysisTier: 'sonnet',
  oversightFrequency: 1.0,
};

function getComplexity(businessType: string): ComplexityProfile {
  const key = businessType.toLowerCase().replace(/[^a-z]/g, '_');
  return BUSINESS_COMPLEXITY[key] ?? DEFAULT_COMPLEXITY;
}

// ─── Agent Cost Profiles ───

/** Estimated monthly token usage per agent tier, based on task mix */
interface AgentCostProfile {
  tier: ModelTier;
  /** Average messages/interactions this agent handles per month */
  estimatedMonthlyInteractions: number;
  /** Average input tokens per interaction (with caching) */
  avgInputTokens: number;
  /** Average output tokens per interaction */
  avgOutputTokens: number;
  /** Percentage of input tokens served from cache */
  cacheHitRate: number;
}

const AGENT_PROFILES: Record<string, AgentCostProfile> = {
  // Tier 1: Owner/manager personal assistant — complex reasoning, moderate volume
  personal_assistant: {
    tier: 'sonnet',
    estimatedMonthlyInteractions: 300,
    avgInputTokens: 2000,
    avgOutputTokens: 400,
    cacheHitRate: 0.85,
  },
  // Tier 1: Department head agent — analysis, decision-making
  department_head: {
    tier: 'sonnet',
    estimatedMonthlyInteractions: 200,
    avgInputTokens: 2500,
    avgOutputTokens: 500,
    cacheHitRate: 0.80,
  },
  // Tier 2: Coordination agent — scheduling, client management
  coordination: {
    tier: 'haiku',
    estimatedMonthlyInteractions: 500,
    avgInputTokens: 1500,
    avgOutputTokens: 300,
    cacheHitRate: 0.90,
  },
  // Tier 3: Employee personal assistant — simple tasks, high volume
  employee_assistant: {
    tier: 'haiku',
    estimatedMonthlyInteractions: 150,
    avgInputTokens: 1000,
    avgOutputTokens: 200,
    cacheHitRate: 0.90,
  },
  // Cross-cutting: Analytics/compliance — periodic analysis
  analytics: {
    tier: 'sonnet',
    estimatedMonthlyInteractions: 50,
    avgInputTokens: 3000,
    avgOutputTokens: 800,
    cacheHitRate: 0.70,
  },
  // Oversight: Smart model spot-checking routine output
  oversight: {
    tier: 'opus',
    estimatedMonthlyInteractions: 30,
    avgInputTokens: 2000,
    avgOutputTokens: 300,
    cacheHitRate: 0.80,
  },
};

// ─── Pricing Inputs ───

export interface PricingInput {
  employeeCount: number;
  clientVolumeMonthly: number;
  communicationChannels: string[];
  businessType: string;
  /** Cost-of-living multiplier (1.0 = US average) */
  costOfLivingMultiplier?: number;
}

export interface PricingBreakdown {
  /** What the customer pays */
  monthlyPrice: number;
  /** Our cost to serve */
  monthlyCost: number;
  /** Gross margin percentage */
  marginPercent: number;
  /** Number of agents deployed */
  agentCount: number;
  /** Agent breakdown by tier */
  agents: { role: string; tier: ModelTier; monthlyCost: number }[];
  /** Estimated monthly token usage */
  estimatedTokens: { input: number; output: number; cached: number };
  /** Price per agent (what the customer sees) */
  pricePerAgent: number;
  /** Currency */
  currency: string;
  currencySymbol: string;
}

const TARGET_MARGIN = 0.70; // 70% gross margin target
const MIN_PRICE = 49;       // Floor price regardless of calculation
const PLATFORM_FEE = 5;     // Base platform cost per tenant (hosting, storage, etc.)

/**
 * Calculate the monthly price for a customer based on their profile.
 */
export function calculatePricing(input: PricingInput): PricingBreakdown {
  const complexity = getComplexity(input.businessType);
  const agents = determineAgents(input, complexity);

  // Calculate token costs for each agent
  const agentCosts = agents.map((agent) => {
    const profile = AGENT_PROFILES[agent.profileKey] ?? AGENT_PROFILES.employee_assistant!;
    // Use complexity-adjusted tier if the agent has one
    const effectiveTier = agent.tierOverride ?? profile.tier;
    const costs = TOKEN_COSTS[effectiveTier];

    // Scale interactions by client volume
    const volumeMultiplier = getVolumeMultiplier(input.clientVolumeMonthly, agent.profileKey);
    const interactions = Math.round(profile.estimatedMonthlyInteractions * volumeMultiplier);

    // Calculate token costs with caching
    const cachedInputTokens = profile.avgInputTokens * profile.cacheHitRate * interactions;
    const uncachedInputTokens = profile.avgInputTokens * (1 - profile.cacheHitRate) * interactions;
    const outputTokens = profile.avgOutputTokens * interactions;

    const inputCost = (uncachedInputTokens / 1_000_000) * costs.input
      + (cachedInputTokens / 1_000_000) * costs.cachedInput;
    const outputCost = (outputTokens / 1_000_000) * costs.output;

    return {
      role: agent.role,
      tier: effectiveTier,
      monthlyCost: inputCost + outputCost,
      inputTokens: uncachedInputTokens + cachedInputTokens,
      outputTokens,
      cachedTokens: cachedInputTokens,
    };
  });

  // Apply complexity multiplier — complex businesses generate longer outputs, more reasoning
  const rawTokenCost = agentCosts.reduce((sum, a) => sum + a.monthlyCost, 0);
  const totalCost = (rawTokenCost * complexity.costMultiplier) + PLATFORM_FEE;
  const totalInputTokens = agentCosts.reduce((sum, a) => sum + a.inputTokens, 0);
  const totalOutputTokens = agentCosts.reduce((sum, a) => sum + a.outputTokens, 0);
  const totalCachedTokens = agentCosts.reduce((sum, a) => sum + a.cachedTokens, 0);

  // Calculate price: cost / (1 - target margin)
  let monthlyPrice = totalCost / (1 - TARGET_MARGIN);

  // Apply cost-of-living adjustment
  const colMultiplier = input.costOfLivingMultiplier ?? 1.0;
  monthlyPrice *= colMultiplier;

  // Round to nearest $5
  monthlyPrice = Math.max(MIN_PRICE, Math.ceil(monthlyPrice / 5) * 5);

  // Determine currency
  const { currency, currencySymbol } = getCurrency(colMultiplier);

  const marginPercent = ((monthlyPrice - totalCost) / monthlyPrice) * 100;

  return {
    monthlyPrice,
    monthlyCost: Math.round(totalCost * 100) / 100,
    marginPercent: Math.round(marginPercent),
    agentCount: agents.length,
    agents: agentCosts.map((a) => ({ role: a.role, tier: a.tier, monthlyCost: Math.round(a.monthlyCost * 100) / 100 })),
    estimatedTokens: {
      input: Math.round(totalInputTokens),
      output: Math.round(totalOutputTokens),
      cached: Math.round(totalCachedTokens),
    },
    pricePerAgent: Math.round((monthlyPrice / agents.length) * 100) / 100,
    currency,
    currencySymbol,
  };
}

// ─── Agent Determination ───

interface AgentSpec {
  role: string;
  profileKey: string;
  /** Override the default model tier based on business complexity */
  tierOverride?: ModelTier;
}

function determineAgents(input: PricingInput, complexity: ComplexityProfile): AgentSpec[] {
  const agents: AgentSpec[] = [];
  const employeeCount = input.employeeCount || 1;

  // Every customer gets a personal assistant — tier based on complexity
  // Law firm owner gets Sonnet PA, nail salon owner gets Haiku PA
  agents.push({
    role: 'Personal Assistant',
    profileKey: 'personal_assistant',
    tierOverride: complexity.analysisTier === 'opus' ? 'sonnet' : complexity.clientFacingTier === 'sonnet' ? 'sonnet' : undefined,
  });

  if (employeeCount <= 2) {
    // Solo / micro business
    agents.push({ role: 'Client Manager', profileKey: 'coordination', tierOverride: complexity.clientFacingTier });
    if (input.communicationChannels?.length > 1) {
      agents.push({ role: 'Communications', profileKey: 'coordination', tierOverride: complexity.clientFacingTier });
    }
  } else if (employeeCount <= 20) {
    // Small team
    agents.push({ role: 'Client Manager', profileKey: 'coordination', tierOverride: complexity.clientFacingTier });
    agents.push({ role: 'Scheduler', profileKey: 'coordination' });
    agents.push({ role: 'Analytics', profileKey: 'analytics', tierOverride: complexity.analysisTier });
    // Department heads
    const deptCount = Math.min(Math.floor(employeeCount / 5), 4);
    for (let i = 0; i < deptCount; i++) {
      agents.push({ role: `Department Lead ${i + 1}`, profileKey: 'department_head', tierOverride: complexity.analysisTier });
    }
    // Employee assistants
    for (let i = 0; i < employeeCount; i++) {
      agents.push({ role: `Employee ${i + 1} Assistant`, profileKey: 'employee_assistant', tierOverride: complexity.clientFacingTier });
    }
  } else {
    // Mid-size / enterprise
    agents.push({ role: 'Operations', profileKey: 'department_head', tierOverride: complexity.analysisTier });
    agents.push({ role: 'Client Relations', profileKey: 'coordination', tierOverride: complexity.clientFacingTier });
    agents.push({ role: 'Analytics', profileKey: 'analytics', tierOverride: complexity.analysisTier });
    agents.push({ role: 'HR', profileKey: 'coordination' });
    agents.push({ role: 'Compliance', profileKey: 'analytics', tierOverride: complexity.analysisTier });
    // Department heads (1 per 10 employees)
    const deptCount = Math.min(Math.ceil(employeeCount / 10), 10);
    for (let i = 0; i < deptCount; i++) {
      agents.push({ role: `Department Lead ${i + 1}`, profileKey: 'department_head', tierOverride: complexity.analysisTier });
    }
    // Employee assistants
    for (let i = 0; i < employeeCount; i++) {
      agents.push({ role: `Employee ${i + 1} Assistant`, profileKey: 'employee_assistant', tierOverride: complexity.clientFacingTier });
    }
  }

  // Oversight agent — frequency scales with complexity
  // Law firm needs more oversight than a nail salon
  agents.push({ role: 'Quality Oversight', profileKey: 'oversight' });

  return agents;
}

/**
 * Scale agent interactions based on client volume.
 * More clients = more messages the agent handles.
 */
function getVolumeMultiplier(clientVolume: number, profileKey: string): number {
  if (!clientVolume || clientVolume <= 0) return 1.0;

  // Client-facing agents scale with volume
  const clientFacing = ['personal_assistant', 'coordination'];
  if (!clientFacing.includes(profileKey)) return 1.0;

  // Base: 30 clients/mo = 1.0x, scales logarithmically
  return Math.max(1.0, Math.log2(clientVolume / 30 + 1));
}

function getCurrency(colMultiplier: number): { currency: string; currencySymbol: string } {
  // Rough mapping — in production, use location data
  if (colMultiplier >= 0.85 && colMultiplier <= 1.15) return { currency: 'USD', currencySymbol: '$' };
  if (colMultiplier >= 0.75 && colMultiplier < 0.85) return { currency: 'EUR', currencySymbol: '€' };
  return { currency: 'USD', currencySymbol: '$' };
}

/**
 * Format the price for display to the customer.
 * They see one number — not the breakdown.
 */
export function formatPrice(pricing: PricingBreakdown): string {
  return `${pricing.currencySymbol}${pricing.monthlyPrice}/month`;
}

/**
 * Format a summary for internal use (Devon's dashboard).
 */
export function formatPricingSummary(pricing: PricingBreakdown): string {
  return [
    `Price: ${pricing.currencySymbol}${pricing.monthlyPrice}/mo`,
    `Cost: ${pricing.currencySymbol}${pricing.monthlyCost}/mo`,
    `Margin: ${pricing.marginPercent}%`,
    `Agents: ${pricing.agentCount} (${pricing.currencySymbol}${pricing.pricePerAgent}/agent)`,
    `Tokens/mo: ~${Math.round(pricing.estimatedTokens.input / 1000)}K input, ~${Math.round(pricing.estimatedTokens.output / 1000)}K output (${Math.round(pricing.estimatedTokens.cached / pricing.estimatedTokens.input * 100)}% cached)`,
  ].join('\n');
}

import { z } from 'zod';

const modelRoutingEntrySchema = z.object({
  provider: z.enum(['anthropic', 'openai']),
  model: z.string().min(1),
  benchmarkScore: z.number().optional(),
  fallback: z.object({
    provider: z.enum(['anthropic', 'openai']),
    model: z.string().min(1),
  }).optional(),
});

const agentGovernanceRuleSchema = z.object({
  action: z.string().min(1),
  effect: z.enum(['allow', 'deny']),
  conditions: z.record(z.string(), z.unknown()).optional(),
});

const agentSpecSchema = z.object({
  role: z.string().min(1),
  name: z.string().min(1),
  modelRouting: z.record(z.string(), modelRoutingEntrySchema),
  outputChannels: z.array(z.string()),
  governanceRules: z.array(agentGovernanceRuleSchema),
});

const integrationSpecSchema = z.object({
  type: z.string().min(1),
  config: z.record(z.string(), z.unknown()),
  status: z.enum(['configured', 'pending', 'disabled']).optional(),
});

const pricingSpecSchema = z.object({
  tier: z.enum(['personal', 'solo', 'small_team', 'mid_size', 'enterprise', 'air_gapped']),
  monthlyBase: z.number().min(0),
  modelCostEstimate: z.number().min(0),
  total: z.number().min(0),
  deposit: z.number().min(0),
  trialDays: z.number().int().min(1),
});

export const axisDeploymentSpecSchema = z.object({
  organization: z.object({
    name: z.string().min(1),
    industry: z.string().min(1),
    size: z.enum(['solo', 'small_team', 'mid_size', 'enterprise']),
    compliance: z.array(z.string()).optional(),
  }),
  surfaces: z.object({
    webDashboard: z.boolean(),
    website: z.boolean().optional(),
    mobileApp: z.boolean().optional(),
    desktopApp: z.boolean().optional(),
    globe: z.boolean().optional(),
  }),
  agents: z.array(agentSpecSchema).min(1),
  integrations: z.array(integrationSpecSchema),
  pricing: pricingSpecSchema,
  blueprint: z.enum(['personal', 'solo', 'small_team', 'mid_size', 'enterprise', 'air_gapped']),
  template: z.string().min(1),
});

export type AxisDeploymentSpecInput = z.infer<typeof axisDeploymentSpecSchema>;

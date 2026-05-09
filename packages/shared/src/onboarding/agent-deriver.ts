/**
 * Story 1.11 — Agent derivation + model routing assignment.
 *
 * Takes the AxisDeploymentSpec (and optionally the AI's structured payload
 * for richer per-agent metadata) and emits agent_configs payloads ready to
 * write via upsert_agent_configs. Each derived config has:
 *
 *   - agent_role / agent_name from the spec
 *   - model_routing per task (uses spec's modelRouting if present, otherwise
 *     a sensible default for the agent's primary tier)
 *   - output_channels
 *   - governance_rules (empty by default — Story 0.8 fills these in later)
 *   - entity_lookup_name / entity_lookup_type so the writer Postgres function
 *     can join to ontology_entities by name
 *   - the founder/owner gets a synthetic 'orchestrator' agent
 */

import type { AxisDeploymentSpec, AgentSpec, ModelRoutingEntry } from '../types/deployment-spec';

export type AgentTier = 'Opus' | 'Sonnet' | 'Haiku';

export interface DerivedAgentConfig {
  agent_role: string;
  agent_name: string;
  model_routing: Record<string, ModelRoutingEntry>;
  output_channels: string[];
  governance_rules: any[];
  entity_lookup_name: string;
  entity_lookup_type: 'role' | 'department';
  status: 'pending';
  config: Record<string, unknown>;
}

/** Default model assignments per tier, used when spec doesn't supply routing */
const DEFAULT_ROUTING: Record<AgentTier, Record<string, ModelRoutingEntry>> = {
  Opus: {
    primary: { provider: 'anthropic', model: 'claude-opus-4-20250514', fallback: { provider: 'openai', model: 'gpt-4o' } },
    reasoning: { provider: 'anthropic', model: 'claude-opus-4-20250514' },
    summarization: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
  },
  Sonnet: {
    primary: { provider: 'anthropic', model: 'claude-sonnet-4-20250514', fallback: { provider: 'openai', model: 'gpt-4o' } },
    reasoning: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
    summarization: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
  },
  Haiku: {
    primary: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', fallback: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' } },
    reasoning: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
    summarization: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
  },
};

function inferTierFromAgent(agent: AgentSpec, structuredAgent?: any): AgentTier {
  const fromStructured = (structuredAgent?.aiModel ?? '').toString();
  if (fromStructured) {
    if (/opus/i.test(fromStructured)) return 'Opus';
    if (/haiku/i.test(fromStructured)) return 'Haiku';
    return 'Sonnet';
  }
  // Inspect modelRouting on the spec — if any entry is opus, treat as Opus
  const routes = Object.values(agent.modelRouting ?? {});
  const hasOpus = routes.some((r) => /opus/i.test(r.model ?? ''));
  const hasSonnet = routes.some((r) => /sonnet/i.test(r.model ?? ''));
  if (hasOpus) return 'Opus';
  if (hasSonnet) return 'Sonnet';
  return 'Haiku';
}

/**
 * Derive agent_configs payloads from a generated spec.
 *
 * @param spec  The AxisDeploymentSpec from Story 1.7 / generateDeploymentSpec
 * @param structured  Optional — the AI's free-form structured payload used to
 *                    enrich tier inference and pull custom names
 */
export function deriveAgentConfigs(
  spec: AxisDeploymentSpec,
  structured?: any,
): DerivedAgentConfig[] {
  const out: DerivedAgentConfig[] = [];
  const structuredAgents: any[] = structured?.agents ?? [];

  for (const agent of spec.agents ?? []) {
    // Try to pair this spec agent with an AI-structured counterpart by name match
    const structuredMatch = structuredAgents.find(
      (a: any) => (a?.name ?? '').toLowerCase() === agent.name.toLowerCase(),
    ) ?? structuredAgents.find(
      (a: any) => (a?.role ?? '').toLowerCase() === agent.role.toLowerCase(),
    );

    const tier = inferTierFromAgent(agent, structuredMatch);
    const routing = (agent.modelRouting && Object.keys(agent.modelRouting).length > 0)
      ? agent.modelRouting
      : DEFAULT_ROUTING[tier];

    out.push({
      agent_role: agent.role,
      agent_name: agent.name,
      model_routing: routing,
      output_channels: agent.outputChannels ?? structuredMatch?.channels ?? ['WhatsApp'],
      governance_rules: agent.governanceRules ?? [],
      entity_lookup_name: agent.name,
      entity_lookup_type: 'role',
      status: 'pending',
      config: {
        tier,
        description: structuredMatch?.description,
        emoji: structuredMatch?.emoji,
        tools: structuredMatch?.tools ?? [],
        strengths: structuredMatch?.strengths ?? [],
        limitations: structuredMatch?.limitations ?? [],
      },
    });
  }

  // Synthesise an orchestrator for the founder/owner if none of the spec
  // agents already serves that role. Linked to the org as a department-of-one.
  const hasOrchestrator = out.some((a) =>
    /orchestrat|coordinator|personal assistant|chief of staff/i.test(a.agent_role) ||
    /orchestrat|coordinator|personal assistant|chief of staff/i.test(a.agent_name),
  );
  if (!hasOrchestrator && spec.organization?.name) {
    out.push({
      agent_role: 'Orchestrator',
      agent_name: 'Iris',
      model_routing: DEFAULT_ROUTING.Opus,
      output_channels: ['WhatsApp', 'CommandDeck'],
      governance_rules: [],
      entity_lookup_name: spec.organization.name,
      entity_lookup_type: 'department',
      status: 'pending',
      config: {
        tier: 'Opus',
        description: `Founder's personal orchestrator. Coordinates the rest of the team and is the primary point of contact via WhatsApp and the Command Deck.`,
        synthesised: true,
      },
    });
  }

  return out;
}

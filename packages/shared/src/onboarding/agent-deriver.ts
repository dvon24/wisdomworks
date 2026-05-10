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
import { categorizeAgent, getCategoryDefinition } from './agent-categories';

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
/**
 * Fuzzy-match a structured AI agent to a template spec agent by role pattern.
 * Used to inherit structural defaults (modelRouting, outputChannels,
 * governanceRules) without overwriting the AI's chosen names/personality.
 */
function findTemplateForAgent(
  aiAgent: any,
  specAgents: AgentSpec[],
): AgentSpec | undefined {
  const haystack = `${aiAgent?.name ?? ''} ${aiAgent?.role ?? ''}`.toLowerCase();
  // 1. Exact name match (rare but cheap)
  let match = specAgents.find((s) => s.name.toLowerCase() === (aiAgent?.name ?? '').toLowerCase());
  if (match) return match;
  // 2. Role keyword match against template role
  match = specAgents.find((s) => {
    const role = s.role.toLowerCase();
    if (/scheduler|schedul/i.test(role) && /schedul|calendar|appoint|booking/i.test(haystack)) return true;
    if (/marketing|brand|content/i.test(role) && /market|content|brand|social|instagram/i.test(haystack)) return true;
    if (/customer|service|support|care/i.test(role) && /customer|support|care|service|client.*relations/i.test(haystack)) return true;
    if (/website|web.manager/i.test(role) && /website|web.*manager|web.*site/i.test(haystack)) return true;
    if (/operations|ops|logistics/i.test(role) && /operation|ops|logistics|business.*manager/i.test(haystack)) return true;
    if (/sales|business.*development|biz.*dev/i.test(role) && /sales|business.*dev|biz.*dev|account/i.test(haystack)) return true;
    if (/analytics|research|insights|intelligence/i.test(role) && /analytic|research|insight|intelligence|strateg/i.test(haystack)) return true;
    return false;
  });
  return match;
}

export function deriveAgentConfigs(
  spec: AxisDeploymentSpec,
  structured?: any,
): DerivedAgentConfig[] {
  const out: DerivedAgentConfig[] = [];
  const structuredAgents: any[] = structured?.agents ?? [];
  const specAgents: AgentSpec[] = spec.agents ?? [];

  // PREFER the AI-generated team as the source of truth for names/roles.
  // Template spec agents only contribute structural defaults (routing,
  // channels, governance) when fuzzy-matched by role pattern.
  const sourceAgents = structuredAgents.length > 0 ? structuredAgents : specAgents;
  const usingAI = structuredAgents.length > 0;

  for (const aiAgent of sourceAgents) {
    if (!aiAgent?.name) continue;
    const templateMatch = usingAI ? findTemplateForAgent(aiAgent, specAgents) : (aiAgent as AgentSpec);

    const tier = inferTierFromAgent(
      // build a shim that satisfies inferTierFromAgent's expectations
      { modelRouting: templateMatch?.modelRouting ?? {}, name: aiAgent.name, role: aiAgent.role ?? '' } as any,
      usingAI ? aiAgent : undefined,
    );
    const routing = (templateMatch?.modelRouting && Object.keys(templateMatch.modelRouting).length > 0)
      ? templateMatch.modelRouting
      : DEFAULT_ROUTING[tier];

    // Category is the agent's lane — modeled on BMAD's module concept.
    // Drives the stay-in-lane prompt guidance and downstream UI grouping.
    const category = categorizeAgent({
      name: aiAgent.name,
      role: aiAgent.role,
      description: aiAgent.description,
    });
    const categoryDef = getCategoryDefinition(category);

    out.push({
      agent_role: aiAgent.role ?? templateMatch?.role ?? 'Specialist',
      agent_name: aiAgent.name,
      model_routing: routing,
      // Prefer the AI's explicit channels, then category typicals, then template
      output_channels: aiAgent.channels?.length
        ? aiAgent.channels
        : (categoryDef.typicalChannels.length
          ? categoryDef.typicalChannels
          : templateMatch?.outputChannels ?? ['WhatsApp']),
      governance_rules: templateMatch?.governanceRules ?? [],
      entity_lookup_name: aiAgent.name,
      entity_lookup_type: 'role',
      status: 'pending',
      config: {
        tier,
        category,
        category_label: categoryDef.label,
        category_emoji: categoryDef.emoji,
        category_domain: categoryDef.domain,
        description: aiAgent.description,
        emoji: aiAgent.emoji ?? categoryDef.emoji,
        tools: aiAgent.tools ?? [],
        strengths: aiAgent.strengths ?? [],
        limitations: aiAgent.limitations ?? [],
        template_role: templateMatch?.role,
      },
    });
  }

  // Synthesise an orchestrator only if NO source agent serves that role.
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

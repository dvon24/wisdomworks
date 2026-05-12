/**
 * Story 1.13 — Axis Integration Discovery & Org Documentation.
 *
 * Discovery does three things, all pure functions:
 *
 *   1. discoverIntegrations() walks the customer's actual oauth_connections
 *      (what they've actually authorised) and the AI's structured payload
 *      (what they MENTIONED) and produces an enriched integrations array
 *      ready to merge back into the AxisDeploymentSpec. Each integration
 *      gets a 'configured' / 'pending' / 'disabled' status.
 *
 *   2. recommendChannelsForRoles() takes the discovered integrations and the
 *      derived agent configs, then suggests output_channel additions per
 *      role category (FR92).
 *
 *   3. documentOrganization() emits a single ontology entity of type
 *      'documentation' that captures mission / tool inventory / operational
 *      patterns (FR93). The narrative lives in metadata.text so the
 *      Command Deck / Axis dashboard can render it as-is.
 */

import type { AxisDeploymentSpec, IntegrationSpec } from '../types/deployment-spec';
import type { OntologyEntity } from './ontology-extractor';
import type { DerivedAgentConfig } from './agent-deriver';

interface ConnectionLite {
  provider: string;
  service: string;
  account_email?: string;
  status?: string;
}

/** Map a (provider, service) pair to the capabilities it grants */
const PROVIDER_CAPABILITIES: Record<string, Record<string, string[]>> = {
  google: {
    email: ['read_email', 'send_email', 'search_email', 'draft_email'],
    calendar: ['read_calendar', 'create_event', 'update_event', 'find_free_time'],
  },
  microsoft: {
    email: ['read_email', 'send_email', 'search_email', 'draft_email'],
    calendar: ['read_calendar', 'create_event', 'update_event', 'find_free_time'],
  },
  apple: {
    calendar: ['read_calendar', 'create_event', 'find_free_time'],
  },
  yahoo: {
    email: ['read_email', 'send_email', 'search_email'],
  },
  imap: {
    email: ['read_email', 'send_email'],
  },
  meta: {
    instagram: ['read_dms', 'post_content', 'schedule_content'],
  },
};

/** A category each role implies; used by recommendChannelsForRoles */
const ROLE_CATEGORIES: { match: RegExp; category: string; preferredChannels: string[] }[] = [
  { match: /sales|biz dev|account/i, category: 'sales', preferredChannels: ['Email', 'CRM'] },
  { match: /support|customer|service/i, category: 'support', preferredChannels: ['WhatsApp', 'Email', 'Chat'] },
  { match: /operations|ops|logistics/i, category: 'operations', preferredChannels: ['Email', 'Calendar'] },
  { match: /marketing|brand|content/i, category: 'marketing', preferredChannels: ['Instagram', 'Email'] },
  { match: /finance|book|accounting/i, category: 'finance', preferredChannels: ['Email'] },
  { match: /assistant|coordinator|orchestrator|chief of staff/i, category: 'orchestrator', preferredChannels: ['WhatsApp', 'CommandDeck'] },
];

export interface DiscoveryResult {
  /** Enriched integrations array to merge into spec.integrations */
  integrations: IntegrationSpec[];
  /** Recommended channel additions per agent name */
  recommendedChannels: Record<string, string[]>;
  /** Documentation ontology entity to write */
  documentation: OntologyEntity;
}

export function discoverIntegrations(
  spec: AxisDeploymentSpec,
  structured: any,
  connections: ConnectionLite[],
): IntegrationSpec[] {
  // Keys are normalized lowercase to dedup across (a) connected providers,
  // (b) AI-mentioned strings, and (c) spec entries. Previously each layer
  // used its own casing so "WhatsApp" / "whatsapp" / "WHATSAPP" all got
  // their own row.
  const seen = new Map<string, IntegrationSpec>();
  const norm = (s: string) => s.toLowerCase().trim();

  // A 'service' bucket — "yahoo/email" should subsume a plain "email" mention.
  // Track which generic services are already covered by a configured connection
  // so duplicate generic mentions get skipped.
  const coveredServices = new Set<string>();

  // 1. Anything the user has actually authorised counts as 'configured'
  for (const conn of connections ?? []) {
    if (!conn.provider || !conn.service) continue;
    const key = norm(`${conn.provider}/${conn.service}`);
    const capabilities = PROVIDER_CAPABILITIES[conn.provider]?.[conn.service] ?? [];
    seen.set(key, {
      type: `${conn.provider}/${conn.service}`,
      config: {
        account: conn.account_email,
        capabilities,
      },
      status: 'configured',
    });
    coveredServices.add(norm(conn.service)); // 'email', 'calendar', etc.
  }

  // 2. Tools mentioned during onboarding but not connected → 'pending'
  for (const mention of structured?.detectedIntegrations ?? []) {
    const key = norm(mention.toString());
    if (seen.has(key)) continue;
    // Skip generic service names already covered by a configured provider
    // ("email" mention is redundant when "yahoo/email" is configured)
    if (coveredServices.has(key)) continue;
    seen.set(key, {
      type: key,
      config: { source: 'mentioned_during_onboarding' },
      status: 'pending',
    });
  }

  // 3. Anything the spec already named that didn't show up above
  for (const existing of spec.integrations ?? []) {
    const key = norm(existing.type);
    if (seen.has(key)) continue;
    if (coveredServices.has(key)) continue;
    seen.set(key, existing);
  }

  return Array.from(seen.values());
}

export function recommendChannelsForRoles(
  integrations: IntegrationSpec[],
  configs: DerivedAgentConfig[],
): Record<string, string[]> {
  const out: Record<string, string[]> = {};

  // What channels are actually available given configured integrations
  const haveEmail = integrations.some((i) =>
    i.status === 'configured' && /email|mail/i.test(i.type),
  );
  const haveCalendar = integrations.some((i) =>
    i.status === 'configured' && /calendar/i.test(i.type),
  );
  const haveInstagram = integrations.some((i) =>
    i.status === 'configured' && /instagram|meta/i.test(i.type),
  );

  for (const cfg of configs) {
    const role = `${cfg.agent_role} ${cfg.agent_name}`;
    const matched = ROLE_CATEGORIES.find((c) => c.match.test(role));
    if (!matched) continue;

    const additions: string[] = [];
    for (const ch of matched.preferredChannels) {
      // Only recommend channels we can actually fulfil
      if (ch === 'Email' && !haveEmail) continue;
      if (ch === 'Calendar' && !haveCalendar) continue;
      if (ch === 'Instagram' && !haveInstagram) continue;
      // Don't recommend something the agent already has
      if (cfg.output_channels.some((c) => c.toLowerCase() === ch.toLowerCase())) continue;
      additions.push(ch);
    }
    if (additions.length > 0) out[cfg.agent_name] = additions;
  }

  return out;
}

export function documentOrganization(
  spec: AxisDeploymentSpec,
  structured: any,
  integrations: IntegrationSpec[],
  configs: DerivedAgentConfig[],
): OntologyEntity {
  const orgName = spec.organization?.name ?? 'Unknown';
  const tools = integrations.map((i) => `${i.type} (${i.status})`).join(', ');
  // Primary contact: prefer the agent flagged category=orchestrator (BMAD
  // categorization), fall back to role-regex with "personal assistant"
  // matched BEFORE "coordinator" so Iris beats Riley when both exist.
  const orchestrator =
    configs.find((c) => (c.config as any)?.category === 'orchestrator') ??
    configs.find((c) => /personal assistant|chief of staff/i.test(c.agent_role)) ??
    configs.find((c) => /orchestrat/i.test(c.agent_role)) ??
    configs.find((c) => /coordinator|assistant/i.test(c.agent_role));
  const teamSummary = configs.map((c) => `- ${c.agent_name} (${c.agent_role})`).join('\n');
  const painPoints = (structured?.painPoints ?? []).slice(0, 5).join('; ') || 'none captured';

  const industry = spec.organization?.industry ?? 'business';
  // Mission line: avoid the awkward "X operates as a Y" template that produces
  // ungrammatical output for compound names ("WisdomWorks and Au7o operates
  // as a Solo entrepreneur"). Use a neutral noun-phrase layout instead.
  const missionLine = structured?.businessName
    ? `${structured.businessName} — ${industry}.`
    : `Operations within the ${industry} space.`;

  const text = [
    `# ${orgName}`,
    ``,
    `**Industry**: ${industry}`,
    `**Size**: ${spec.organization?.size ?? 'unknown'}`,
    `**Plan**: ${spec.blueprint} (${spec.template})`,
    ``,
    `## Mission`,
    missionLine,
    ``,
    `## Team`,
    teamSummary || '(no agents yet)',
    orchestrator ? `\nPrimary point of contact: **${orchestrator.agent_name}** (${orchestrator.agent_role}).` : '',
    ``,
    `## Tool inventory`,
    tools || '(no tools configured)',
    ``,
    `## Operational patterns`,
    `- Pain points being addressed: ${painPoints}`,
    `- Active surfaces: ${Object.entries(spec.surfaces ?? {}).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none'}`,
  ].filter(Boolean).join('\n');

  return {
    entity_type: 'documentation',
    name: `${orgName} — Org Documentation`,
    metadata: {
      text,
      generated_at: new Date().toISOString(),
      sources: ['axis_discovery'],
      integrations_count: integrations.length,
      agents_count: configs.length,
    },
    source: 'axis_validated',
  };
}

export function runAxisDiscovery(
  spec: AxisDeploymentSpec,
  structured: any,
  connections: ConnectionLite[],
  configs: DerivedAgentConfig[],
): DiscoveryResult {
  const integrations = discoverIntegrations(spec, structured, connections);
  const recommendedChannels = recommendChannelsForRoles(integrations, configs);
  const documentation = documentOrganization(spec, structured, integrations, configs);
  return { integrations, recommendedChannels, documentation };
}

/**
 * Story 1.10 — Ontology extraction from onboarding data + spec.
 *
 * Pure function: takes the AI's structured onboarding payload and the
 * generated AxisDeploymentSpec, returns the entities and relationships
 * that should land in the ontology tables.
 *
 * No LLM calls — this runs every onboarding turn alongside spec generation.
 */

import type { AxisDeploymentSpec } from '../types/deployment-spec';

export type EntityType =
  | 'employee'
  | 'role'
  | 'department'
  | 'project'
  | 'client'
  | 'capability'
  | 'risk'
  | 'decision'
  | 'task'
  | 'innovation';

export type RelationshipType =
  | 'reports_to'
  | 'works_on'
  | 'manages'
  | 'collaborates_with'
  | 'serves'
  | 'depends_on'
  | 'owns';

export interface OntologyEntity {
  entity_type: EntityType;
  name: string;
  metadata?: Record<string, unknown>;
  source?: 'human' | 'agent_inferred' | 'axis_validated';
}

export interface OntologyRelationship {
  from_type: EntityType;
  from_name: string;
  to_type: EntityType;
  to_name: string;
  relationship_type: RelationshipType;
  metadata?: Record<string, unknown>;
  source?: 'human' | 'agent_inferred' | 'axis_validated';
}

export interface ExtractedOntology {
  entities: OntologyEntity[];
  relationships: OntologyRelationship[];
}

/**
 * Extract entities + relationships from the onboarding structured payload
 * and the generated AxisDeploymentSpec.
 */
export function extractOntology(
  structured: any,
  spec: AxisDeploymentSpec | null,
): ExtractedOntology {
  const entitiesMap = new Map<string, OntologyEntity>();
  const relationships: OntologyRelationship[] = [];

  const addEntity = (entity_type: EntityType, name: string, metadata?: Record<string, unknown>) => {
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const key = `${entity_type}:${trimmed.toLowerCase()}`;
    if (!entitiesMap.has(key)) {
      entitiesMap.set(key, { entity_type, name: trimmed, metadata });
    } else if (metadata) {
      const existing = entitiesMap.get(key)!;
      existing.metadata = { ...(existing.metadata ?? {}), ...metadata };
    }
  };

  // 1. The organization itself becomes a department-of-one
  if (spec?.organization?.name) {
    addEntity('department', spec.organization.name, {
      industry: spec.organization.industry,
      size: spec.organization.size,
    });
  }

  // 2. Each agent in the spec is a role; if they have a sub-team, those become roles too
  for (const agent of spec?.agents ?? []) {
    addEntity('role', agent.name, {
      role: agent.role,
      output_channels: agent.outputChannels,
    });
    // Owner relationship: organization owns role
    if (spec?.organization?.name) {
      relationships.push({
        from_type: 'department',
        from_name: spec.organization.name,
        to_type: 'role',
        to_name: agent.name,
        relationship_type: 'owns',
      });
    }
  }

  // 3. From the AI's free-form structured payload, harvest sub-team rosters as
  // roles and link them to their parent agent via reports_to.
  for (const a of structured?.agents ?? []) {
    if (!a?.name) continue;
    addEntity('role', a.name, { role: a.role, channels: a.channels, tools: a.tools });
    const subAgents = a.subTeam?.agents ?? [];
    for (const sub of subAgents) {
      if (!sub?.name) continue;
      addEntity('role', sub.name, { role: sub.role, parent_role: a.name });
      relationships.push({
        from_type: 'role',
        from_name: sub.name,
        to_type: 'role',
        to_name: a.name,
        relationship_type: 'reports_to',
      });
    }
  }

  // 4. Tools + integrations become capabilities so agents can introspect them
  for (const integration of spec?.integrations ?? []) {
    addEntity('capability', integration.type, { source_layer: 'integration' });
  }
  for (const tool of structured?.detectedIntegrations ?? []) {
    addEntity('capability', tool, { source_layer: 'tool_mention' });
  }

  // 5. Pain points become risks so future BMAD agents can target them
  for (const pain of structured?.painPoints ?? []) {
    if (typeof pain === 'string' && pain.trim()) {
      addEntity('risk', pain.slice(0, 120), { pain_point: true });
    }
  }

  return {
    entities: Array.from(entitiesMap.values()),
    relationships,
  };
}

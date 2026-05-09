/**
 * Story 1.12 — Agent provisioning planner.
 *
 * Pure function: takes a generated AxisDeploymentSpec + the derived agent
 * configs and computes the *wiring plan* for each agent — its NATS subjects
 * and which other agents it talks to based on the blueprint's signal
 * topology (linear / hub_spoke / mesh / hierarchical).
 *
 * Real NATS pub/sub doesn't exist yet. This story stores the routing table
 * so when the runtime comes online it knows who connects to whom.
 */

import type { AxisDeploymentSpec, BlueprintDefinition } from '../types/deployment-spec';
import { BLUEPRINTS } from '../types/deployment-spec';
import type { DerivedAgentConfig } from './agent-deriver';

export interface InstancePayload {
  agent_name: string;
  nats_subjects: string[];
  signal_connections: SignalConnection[];
  governance_snapshot: any[];
  metadata: Record<string, unknown>;
}

export interface SignalConnection {
  to_agent_name: string;
  direction: 'in' | 'out' | 'both';
  subject: string;
}

const baseSubject = (tenantPhone: string, agentName: string) =>
  `wisdomworks.${tenantPhone}.agent.${agentName.toLowerCase().replace(/\s+/g, '_')}`;

/**
 * Plan provisioning for every derived config based on the spec's blueprint
 * topology. Returns the InstancePayload[] you can pass straight to
 * provision_agents Postgres function.
 */
export function planProvisioning(
  tenantPhone: string,
  spec: AxisDeploymentSpec,
  configs: DerivedAgentConfig[],
): InstancePayload[] {
  const blueprint: BlueprintDefinition = BLUEPRINTS[spec.blueprint] ?? BLUEPRINTS.solo;
  const topology = blueprint.signalComplexity;
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');

  // The "hub" (for hub_spoke / hierarchical) is whichever agent is the
  // orchestrator — typically the first one or the one with role
  // matching coordinator/orchestrator/personal-assistant.
  const hubIndex = configs.findIndex((c) =>
    /orchestrat|coordinator|personal assistant|chief of staff/i.test(c.agent_role) ||
    /orchestrat|coordinator|personal assistant|chief of staff/i.test(c.agent_name),
  );
  const hub = hubIndex >= 0 ? configs[hubIndex]! : configs[0];

  return configs.map((cfg, i) => {
    const subjects: string[] = [
      `${baseSubject(cleanPhone, cfg.agent_name)}.work_inbox`,
      `${baseSubject(cleanPhone, cfg.agent_name)}.events`,
    ];
    const connections: SignalConnection[] = [];

    if (topology === 'linear') {
      // A → B → C: each agent receives from prev and sends to next
      const prev = configs[i - 1];
      const next = configs[i + 1];
      if (prev) connections.push({
        to_agent_name: prev.agent_name,
        direction: 'in',
        subject: `${baseSubject(cleanPhone, prev.agent_name)}.events`,
      });
      if (next) connections.push({
        to_agent_name: next.agent_name,
        direction: 'out',
        subject: `${baseSubject(cleanPhone, next.agent_name)}.work_inbox`,
      });
    } else if (topology === 'hub_spoke') {
      // Spokes only talk to the hub
      if (hub && cfg.agent_name !== hub.agent_name) {
        connections.push({
          to_agent_name: hub.agent_name,
          direction: 'both',
          subject: `${baseSubject(cleanPhone, hub.agent_name)}.work_inbox`,
        });
      }
      if (hub && cfg.agent_name === hub.agent_name) {
        // Hub subscribes to every other agent's events
        for (const other of configs) {
          if (other.agent_name === hub.agent_name) continue;
          connections.push({
            to_agent_name: other.agent_name,
            direction: 'in',
            subject: `${baseSubject(cleanPhone, other.agent_name)}.events`,
          });
        }
      }
    } else if (topology === 'mesh') {
      // Every agent subscribes to every other agent's events (high-volume,
      // best for small teams)
      for (const other of configs) {
        if (other.agent_name === cfg.agent_name) continue;
        connections.push({
          to_agent_name: other.agent_name,
          direction: 'both',
          subject: `${baseSubject(cleanPhone, other.agent_name)}.events`,
        });
      }
    } else if (topology === 'hierarchical') {
      // Tree based on the existing reports_to relationship hint embedded in
      // config.tier or role; fallback to hub-spoke if we can't infer levels
      if (hub && cfg.agent_name !== hub.agent_name) {
        connections.push({
          to_agent_name: hub.agent_name,
          direction: 'out',
          subject: `${baseSubject(cleanPhone, hub.agent_name)}.work_inbox`,
        });
      }
    }

    return {
      agent_name: cfg.agent_name,
      nats_subjects: subjects,
      signal_connections: connections,
      governance_snapshot: cfg.governance_rules ?? [],
      metadata: {
        topology,
        tier: (cfg.config as any)?.tier ?? 'Sonnet',
        is_hub: hub?.agent_name === cfg.agent_name,
      },
    };
  });
}

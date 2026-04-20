import { pgTable, text, timestamp, uuid, jsonb, index } from 'drizzle-orm/pg-core';
import { v7 as uuid7 } from 'uuid';
import { tenants } from './tenants';

export const agentStatusEnum = ['pending', 'provisioning', 'ready', 'running', 'paused', 'stopped', 'error'] as const;
export type AgentStatus = (typeof agentStatusEnum)[number];

/**
 * Agent configurations — defines what an agent does, which models it uses.
 * Derived from AxisDeploymentSpec during onboarding.
 */
export const agentConfigs = pgTable(
  'agent_configs',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuid7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    agentRole: text('agent_role').notNull(),
    agentName: text('agent_name').notNull(),
    modelRouting: jsonb('model_routing').notNull(),
    outputChannels: jsonb('output_channels').notNull(), // string[]
    governanceRules: jsonb('governance_rules').notNull(), // AgentGovernanceRule[]
    entityId: uuid('entity_id'), // linked ontology entity (FR164-166)
    status: text('status').notNull().$type<AgentStatus>().default('pending'),
    config: jsonb('config'), // additional agent-specific config
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdateFn(() => new Date()),
  },
  (table) => [
    index('idx_agent_configs_tenant').on(table.tenantId),
    index('idx_agent_configs_tenant_role').on(table.tenantId, table.agentRole),
    index('idx_agent_configs_model_routing').using('gin', table.modelRouting),
  ],
);

/**
 * Agent instances — running instances of agent configs.
 * Created during provisioning, managed through lifecycle.
 */
export const agentInstances = pgTable(
  'agent_instances',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuid7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    agentConfigId: uuid('agent_config_id')
      .notNull()
      .references(() => agentConfigs.id, { onDelete: 'cascade' }),
    status: text('status').notNull().$type<AgentStatus>().default('provisioning'),
    lastActivity: timestamp('last_activity', { withTimezone: true }),
    stateData: jsonb('state_data'), // agent runtime state
    natsSubjects: jsonb('nats_subjects'), // string[] — subscribed NATS subjects
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdateFn(() => new Date()),
  },
  (table) => [
    index('idx_agent_instances_tenant').on(table.tenantId),
    index('idx_agent_instances_tenant_status').on(table.tenantId, table.status),
    index('idx_agent_instances_config').on(table.agentConfigId),
  ],
);

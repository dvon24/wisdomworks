import { pgTable, text, timestamp, uuid, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { v7 as uuid7 } from 'uuid';
import { tenants } from './tenants';

/**
 * Signal types — categories of inter-agent communication.
 */
export const signalTypes = pgTable(
  'signal_types',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuid7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_signal_types_tenant_name').on(table.tenantId, table.name),
  ],
);

/**
 * Signals — structured metadata communications between agents.
 * Never raw email content (FR21).
 */
export const signals = pgTable(
  'signals',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuid7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    signalTypeId: uuid('signal_type_id')
      .notNull()
      .references(() => signalTypes.id),
    sourceAgentId: text('source_agent_id').notNull(),
    targetAgentId: text('target_agent_id'),
    payload: jsonb('payload').notNull(),
    metadata: jsonb('metadata'),
    status: text('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_signals_tenant').on(table.tenantId),
    index('idx_signals_tenant_created').on(table.tenantId, table.createdAt),
    index('idx_signals_source').on(table.sourceAgentId),
    index('idx_signals_target').on(table.targetAgentId),
    index('idx_signals_payload').using('gin', table.payload),
  ],
);

/** Default signal types to seed per tenant */
export const DEFAULT_SIGNAL_TYPES = [
  'task_handoff',
  'information_request',
  'deadline_alert',
  'discovery',
  'innovation',
  'status_update',
  'coaching',
  'escalation',
] as const;

import { pgTable, text, timestamp, uuid, integer, numeric, jsonb, index } from 'drizzle-orm/pg-core';
import { v7 as uuid7 } from 'uuid';
import { tenants } from './tenants';

export const usageEventTypeEnum = ['model_call', 'voice_minute', 'sms', 'whatsapp', 'storage'] as const;
export type UsageEventType = (typeof usageEventTypeEnum)[number];

export const usageEvents = pgTable(
  'usage_events',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuid7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull().$type<UsageEventType>(),
    provider: text('provider'),
    model: text('model'),
    task: text('task'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    latencyMs: integer('latency_ms'),
    costEstimate: numeric('cost_estimate', { precision: 10, scale: 6 }),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_usage_events_tenant_created').on(table.tenantId, table.createdAt),
  ],
);

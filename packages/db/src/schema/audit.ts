import { pgTable, text, timestamp, uuid, jsonb, index } from 'drizzle-orm/pg-core';
import { v7 as uuid7 } from 'uuid';
import { tenants } from './tenants';

/**
 * Audit logs — captures 100% of platform actions (NFR14).
 * Every agent action, signal processing event, admin operation logged.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuid7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    userId: uuid('user_id'),
    agentId: text('agent_id'),
    action: text('action').notNull(),
    resourceType: text('resource_type'),
    resourceId: text('resource_id'),
    details: jsonb('details'),
    requestId: text('request_id'),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_audit_logs_tenant_timestamp').on(table.tenantId, table.timestamp),
    index('idx_audit_logs_tenant_action').on(table.tenantId, table.action),
    index('idx_audit_logs_request_id').on(table.requestId),
  ],
);

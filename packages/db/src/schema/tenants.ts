import { pgTable, text, timestamp, jsonb, uuid, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { v7 as uuid7 } from 'uuid';

export const tenantStatusEnum = ['onboarding', 'provisioning', 'active', 'suspended', 'decommissioned'] as const;
export type TenantStatus = (typeof tenantStatusEnum)[number];

export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuid7()),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    status: text('status').notNull().$type<TenantStatus>().$defaultFn(() => 'onboarding' as TenantStatus),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdateFn(() => new Date()),
  },
  (table) => [
    check('chk_tenant_status', sql`${table.status} IN ('onboarding', 'provisioning', 'active', 'suspended', 'decommissioned')`),
  ],
);

export const tenantConfigs = pgTable(
  'tenant_configs',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuid7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    configType: text('config_type').notNull(),
    configData: jsonb('config_data').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdateFn(() => new Date()),
  },
  (table) => [
    uniqueIndex('uq_tenant_configs_tenant_type').on(table.tenantId, table.configType),
    index('idx_tenant_configs_config_data').using('gin', table.configData),
  ],
);

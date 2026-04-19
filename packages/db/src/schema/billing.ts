import { pgTable, text, timestamp, uuid, numeric, jsonb, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { v7 as uuid7 } from 'uuid';
import { tenants } from './tenants';

export const billingRecordTypeEnum = ['deposit', 'subscription', 'invoice', 'refund'] as const;
export type BillingRecordType = (typeof billingRecordTypeEnum)[number];

export const billingStatusEnum = ['pending', 'completed', 'failed', 'refunded', 'cancelled'] as const;
export type BillingStatus = (typeof billingStatusEnum)[number];

export const billingRecords = pgTable(
  'billing_records',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuid7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    type: text('type').notNull().$type<BillingRecordType>(),
    amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),
    currency: text('currency').notNull().default('usd'),
    status: text('status').notNull().$type<BillingStatus>().default('pending'),
    stripePaymentId: text('stripe_payment_id'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdateFn(() => new Date()),
  },
  (table) => [
    index('idx_billing_records_tenant').on(table.tenantId),
    index('idx_billing_records_stripe_payment').on(table.stripePaymentId),
    check('chk_billing_type', sql`${table.type} IN ('deposit', 'subscription', 'invoice', 'refund')`),
    check('chk_billing_status', sql`${table.status} IN ('pending', 'completed', 'failed', 'refunded', 'cancelled')`),
  ],
);

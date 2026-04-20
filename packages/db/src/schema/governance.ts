import { pgTable, text, timestamp, uuid, jsonb, boolean, integer, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { v7 as uuid7 } from 'uuid';
import { tenants } from './tenants';

export const ruleEffectEnum = ['allow', 'deny'] as const;
export type RuleEffect = (typeof ruleEffectEnum)[number];

export const evaluationResultEnum = ['permitted', 'blocked', 'escalated'] as const;
export type EvaluationResult = (typeof evaluationResultEnum)[number];

/**
 * Governance rules — allow/deny policies per agent per action type.
 * Configurable per tenant. Evaluated before every agent action.
 */
export const governanceRules = pgTable(
  'governance_rules',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuid7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    ruleType: text('rule_type').notNull(),
    scope: text('scope').notNull(), // 'global', 'agent:{agentId}', 'action:{actionType}'
    action: text('action').notNull(), // action type this rule applies to
    effect: text('effect').notNull().$type<RuleEffect>(),
    priority: integer('priority').notNull().default(0), // higher = evaluated first
    config: jsonb('config'), // additional rule configuration
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdateFn(() => new Date()),
  },
  (table) => [
    index('idx_governance_rules_tenant').on(table.tenantId),
    index('idx_governance_rules_tenant_active').on(table.tenantId, table.active),
    check('chk_rule_effect', sql`${table.effect} IN ('allow', 'deny')`),
  ],
);

/**
 * Governance evaluations — audit trail of every rule check.
 * Logs what was attempted, which rule matched, and the decision.
 */
export const governanceEvaluations = pgTable(
  'governance_evaluations',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuid7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    ruleId: uuid('rule_id').references(() => governanceRules.id),
    agentId: text('agent_id'),
    action: text('action').notNull(),
    result: text('result').notNull().$type<EvaluationResult>(),
    reasoning: text('reasoning'),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_governance_evaluations_tenant').on(table.tenantId),
    check('chk_evaluation_result', sql`${table.result} IN ('permitted', 'blocked', 'escalated')`),
  ],
);

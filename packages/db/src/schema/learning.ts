import { pgTable, text, timestamp, uuid, jsonb, integer, real, index } from 'drizzle-orm/pg-core';
import { v7 as uuid7 } from 'uuid';
import { tenants } from './tenants';

/**
 * Stories 2.14-2.15 — Organizational Learning Engine tables.
 * Process capture, skill formation, and lessons learned.
 */

export const processRecords = pgTable(
  'process_records',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuid7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    agentId: text('agent_id'),
    userId: uuid('user_id'),
    intent: text('intent').notNull(),
    processSteps: jsonb('process_steps').notNull(),
    decisions: jsonb('decisions').notNull(),
    endState: jsonb('end_state').notNull(),
    evaluation: text('evaluation').notNull(), // success | partial | failure
    reflection: jsonb('reflection'),
    tags: jsonb('tags'),
    durationMs: integer('duration_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_process_records_tenant').on(table.tenantId),
    index('idx_process_records_tenant_created').on(table.tenantId, table.createdAt),
    index('idx_process_records_tags').using('gin', table.tags),
  ],
);

export const agentSkills = pgTable(
  'agent_skills',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuid7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    agentId: text('agent_id'), // null = shared across agents
    skillName: text('skill_name').notNull(),
    triggerConditions: jsonb('trigger_conditions').notNull(),
    actionSteps: jsonb('action_steps').notNull(),
    evidence: jsonb('evidence').notNull(),
    confidence: real('confidence').notNull(),
    status: text('status').notNull().default('candidate'), // candidate | active | deprecated
    createdFrom: uuid('created_from'), // process_record_id
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_agent_skills_tenant').on(table.tenantId),
    index('idx_agent_skills_tenant_status').on(table.tenantId, table.status),
  ],
);

export const lessonsLearned = pgTable(
  'lessons_learned',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuid7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    processRecordId: uuid('process_record_id')
      .references(() => processRecords.id),
    whatWentWrong: text('what_went_wrong').notNull(),
    correctiveAction: text('corrective_action').notNull(),
    appliesTo: text('applies_to').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_lessons_learned_tenant').on(table.tenantId),
    index('idx_lessons_learned_applies_to').on(table.tenantId, table.appliesTo),
  ],
);

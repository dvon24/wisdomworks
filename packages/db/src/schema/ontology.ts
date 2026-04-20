import { pgTable, text, timestamp, uuid, jsonb, real, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { v7 as uuid7 } from 'uuid';
import { tenants } from './tenants';

/**
 * Entity types — categories of things in an organization's ontology.
 * Seed data: employee, role, department, project, client, capability, risk, decision, task, innovation, contract
 */
export const entityTypes = pgTable(
  'entity_types',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuid7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    metadataSchema: jsonb('metadata_schema'), // Zod-compatible JSON schema for this type's metadata
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_entity_types_tenant_name').on(table.tenantId, table.name),
  ],
);

/**
 * Entities — the core objects in an organization's ontology.
 * Typed core columns + JSONB metadata for type-specific attributes.
 * Vector embedding for semantic search.
 */
export const entities = pgTable(
  'entities',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuid7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    entityTypeId: uuid('entity_type_id')
      .notNull()
      .references(() => entityTypes.id),
    name: text('name').notNull(),
    status: text('status').notNull().default('active'),
    metadata: jsonb('metadata'),
    // pgvector embedding — uses sql`` for custom column type
    // Actual column created via migration: embedding vector(1536)
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdateFn(() => new Date()),
  },
  (table) => [
    index('idx_entities_tenant').on(table.tenantId),
    index('idx_entities_tenant_type').on(table.tenantId, table.entityTypeId),
    index('idx_entities_metadata').using('gin', table.metadata),
  ],
);

/**
 * Relationship types — how entities connect to each other.
 * Seed data: reports_to, works_on, manages, collaborates_with, owns, depends_on
 */
export const relationshipTypes = pgTable(
  'relationship_types',
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
    uniqueIndex('uq_relationship_types_tenant_name').on(table.tenantId, table.name),
  ],
);

/**
 * Relationships — connections between entities with confidence scoring.
 */
export const relationships = pgTable(
  'relationships',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuid7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    sourceEntityId: uuid('source_entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    targetEntityId: uuid('target_entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    relationshipTypeId: uuid('relationship_type_id')
      .notNull()
      .references(() => relationshipTypes.id),
    metadata: jsonb('metadata'),
    confidence: real('confidence').default(1.0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_relationships_tenant').on(table.tenantId),
    index('idx_relationships_source').on(table.sourceEntityId),
    index('idx_relationships_target').on(table.targetEntityId),
    index('idx_relationships_metadata').using('gin', table.metadata),
  ],
);

/** Default entity type names to seed per tenant */
export const DEFAULT_ENTITY_TYPES = [
  'employee', 'role', 'department', 'project', 'client',
  'capability', 'risk', 'decision', 'task', 'innovation', 'contract',
] as const;

/** Default relationship type names to seed per tenant */
export const DEFAULT_RELATIONSHIP_TYPES = [
  'reports_to', 'works_on', 'manages', 'collaborates_with', 'owns', 'depends_on',
] as const;

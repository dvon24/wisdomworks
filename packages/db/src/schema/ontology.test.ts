import { describe, it, expect } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import {
  entityTypes,
  entities,
  relationshipTypes,
  relationships,
  DEFAULT_ENTITY_TYPES,
  DEFAULT_RELATIONSHIP_TYPES,
} from './ontology';

describe('entity_types schema', () => {
  it('has required columns', () => {
    const columns = getTableColumns(entityTypes);
    expect(columns.id).toBeDefined();
    expect(columns.tenantId).toBeDefined();
    expect(columns.name).toBeDefined();
    expect(columns.description).toBeDefined();
    expect(columns.metadataSchema).toBeDefined();
  });

  it('tenantId is NOT NULL', () => {
    const columns = getTableColumns(entityTypes);
    expect(columns.tenantId.notNull).toBe(true);
  });
});

describe('entities schema', () => {
  it('has required columns', () => {
    const columns = getTableColumns(entities);
    expect(columns.id).toBeDefined();
    expect(columns.tenantId).toBeDefined();
    expect(columns.entityTypeId).toBeDefined();
    expect(columns.name).toBeDefined();
    expect(columns.status).toBeDefined();
    expect(columns.metadata).toBeDefined();
    expect(columns.createdAt).toBeDefined();
    expect(columns.updatedAt).toBeDefined();
  });

  it('tenantId is NOT NULL', () => {
    const columns = getTableColumns(entities);
    expect(columns.tenantId.notNull).toBe(true);
  });

  it('entityTypeId is NOT NULL', () => {
    const columns = getTableColumns(entities);
    expect(columns.entityTypeId.notNull).toBe(true);
  });

  it('metadata is JSONB type', () => {
    const columns = getTableColumns(entities);
    expect(columns.metadata.columnType).toBe('PgJsonb');
  });
});

describe('relationship_types schema', () => {
  it('has required columns', () => {
    const columns = getTableColumns(relationshipTypes);
    expect(columns.id).toBeDefined();
    expect(columns.tenantId).toBeDefined();
    expect(columns.name).toBeDefined();
  });
});

describe('relationships schema', () => {
  it('has required columns', () => {
    const columns = getTableColumns(relationships);
    expect(columns.id).toBeDefined();
    expect(columns.tenantId).toBeDefined();
    expect(columns.sourceEntityId).toBeDefined();
    expect(columns.targetEntityId).toBeDefined();
    expect(columns.relationshipTypeId).toBeDefined();
    expect(columns.metadata).toBeDefined();
    expect(columns.confidence).toBeDefined();
  });

  it('all foreign keys are NOT NULL', () => {
    const columns = getTableColumns(relationships);
    expect(columns.tenantId.notNull).toBe(true);
    expect(columns.sourceEntityId.notNull).toBe(true);
    expect(columns.targetEntityId.notNull).toBe(true);
    expect(columns.relationshipTypeId.notNull).toBe(true);
  });
});

describe('default seed data', () => {
  it('defines 11 entity types', () => {
    expect(DEFAULT_ENTITY_TYPES).toHaveLength(11);
    expect(DEFAULT_ENTITY_TYPES).toContain('employee');
    expect(DEFAULT_ENTITY_TYPES).toContain('department');
    expect(DEFAULT_ENTITY_TYPES).toContain('project');
    expect(DEFAULT_ENTITY_TYPES).toContain('innovation');
  });

  it('defines 6 relationship types', () => {
    expect(DEFAULT_RELATIONSHIP_TYPES).toHaveLength(6);
    expect(DEFAULT_RELATIONSHIP_TYPES).toContain('reports_to');
    expect(DEFAULT_RELATIONSHIP_TYPES).toContain('manages');
    expect(DEFAULT_RELATIONSHIP_TYPES).toContain('depends_on');
  });
});

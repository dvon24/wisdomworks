import { describe, it, expect, vi } from 'vitest';

// Mock nats-client to avoid real NATS connection in unit tests
vi.mock('./nats-client', () => ({
  publishEvent: vi.fn(),
}));

import { createDomainEvent } from './event-publisher';

const UUID_V7_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_8601_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

describe('createDomainEvent', () => {
  it('generates a valid UUID v7 id', () => {
    const event = createDomainEvent(
      'signals.tenant-123.created',
      'tenant-123',
      'test-service',
      { foo: 'bar' },
    );
    expect(event.id).toMatch(UUID_V7_REGEX);
  });

  it('generates an ISO 8601 timestamp', () => {
    const event = createDomainEvent(
      'signals.tenant-123.created',
      'tenant-123',
      'test-service',
      { foo: 'bar' },
    );
    expect(event.timestamp).toMatch(ISO_8601_REGEX);
  });

  it('sets type to the provided subject', () => {
    const event = createDomainEvent(
      'ontology.tenant-456.entity.updated',
      'tenant-456',
      'ontology-service',
      { entityId: '123' },
    );
    expect(event.type).toBe('ontology.tenant-456.entity.updated');
  });

  it('sets tenantId and source correctly', () => {
    const event = createDomainEvent(
      'signals.my-tenant.created',
      'my-tenant',
      'signal-layer',
      {},
    );
    expect(event.tenantId).toBe('my-tenant');
    expect(event.source).toBe('signal-layer');
  });

  it('includes optional metadata', () => {
    const event = createDomainEvent(
      'signals.tenant-1.created',
      'tenant-1',
      'test',
      {},
      { requestId: 'req-789' },
    );
    expect(event.metadata).toEqual({ requestId: 'req-789' });
  });

  it('generates unique ids for each event', () => {
    const e1 = createDomainEvent('signals.t1.created', 't1', 'test', {});
    const e2 = createDomainEvent('signals.t1.created', 't1', 'test', {});
    expect(e1.id).not.toBe(e2.id);
  });

  it('throws for invalid subject format', () => {
    expect(() =>
      createDomainEvent('INVALID', 'tenant-1', 'test', {}),
    ).toThrow();
  });
});

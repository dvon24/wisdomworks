import { describe, it, expect } from 'vitest';
import { domainEventSchema } from './signal-schemas';

const validEvent = {
  id: '019756a0-b1c2-7def-8abc-123456789012',
  type: 'signals.tenant123.created',
  tenantId: 'tenant123',
  timestamp: '2026-04-19T10:00:00.000Z',
  source: 'signal-layer',
  data: { message: 'hello' },
};

describe('domainEventSchema', () => {
  it('accepts a valid DomainEvent', () => {
    const result = domainEventSchema.safeParse(validEvent);
    expect(result.success).toBe(true);
  });

  it('accepts event with optional metadata', () => {
    const result = domainEventSchema.safeParse({
      ...validEvent,
      metadata: { requestId: 'req-123', correlationId: 'corr-456' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects event with missing id', () => {
    const { id, ...noId } = validEvent;
    const result = domainEventSchema.safeParse(noId);
    expect(result.success).toBe(false);
  });

  it('rejects event with missing tenantId', () => {
    const { tenantId, ...noTenant } = validEvent;
    const result = domainEventSchema.safeParse(noTenant);
    expect(result.success).toBe(false);
  });

  it('rejects event with missing type', () => {
    const { type, ...noType } = validEvent;
    const result = domainEventSchema.safeParse(noType);
    expect(result.success).toBe(false);
  });

  it('rejects invalid UUID format', () => {
    const result = domainEventSchema.safeParse({
      ...validEvent,
      id: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-v7 UUID (v4 format)', () => {
    const result = domainEventSchema.safeParse({
      ...validEvent,
      id: '550e8400-e29b-41d4-a716-446655440000', // v4, not v7
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid timestamp format', () => {
    const result = domainEventSchema.safeParse({
      ...validEvent,
      timestamp: '2026/04/19 10:00:00',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid NATS subject format', () => {
    const result = domainEventSchema.safeParse({
      ...validEvent,
      type: 'SIGNALS.TENANT.CREATED', // uppercase not allowed
    });
    expect(result.success).toBe(false);
  });

  it('accepts multi-segment NATS subjects', () => {
    const result = domainEventSchema.safeParse({
      ...validEvent,
      type: 'ontology.tenant-123.entity.updated',
    });
    expect(result.success).toBe(true);
  });
});

import { v7 as uuid7 } from 'uuid';
import { domainEventSchema } from '@wisdomworks/shared';
import type { DomainEvent } from '@wisdomworks/shared';
import { publishEvent } from './nats-client';

/**
 * Factory to create a validated DomainEvent<T>.
 * Generates UUID v7 id and ISO 8601 timestamp automatically.
 * Subject format: {domain}.{tenant_id}.{action} (dot-separated, lowercase)
 */
export function createDomainEvent<T>(
  type: string,
  tenantId: string,
  source: string,
  data: T,
  metadata?: Record<string, unknown>,
): DomainEvent<T> {
  const event: DomainEvent<T> = {
    id: uuid7(),
    type,
    tenantId,
    timestamp: new Date().toISOString(),
    source,
    data,
    metadata,
  };

  // Validate against schema before returning
  domainEventSchema.parse(event);

  return event;
}

/**
 * Create and publish a DomainEvent in one step.
 */
export async function emitEvent<T>(
  type: string,
  tenantId: string,
  source: string,
  data: T,
  metadata?: Record<string, unknown>,
): Promise<DomainEvent<T>> {
  const event = createDomainEvent(type, tenantId, source, data, metadata);
  await publishEvent(event);
  return event;
}

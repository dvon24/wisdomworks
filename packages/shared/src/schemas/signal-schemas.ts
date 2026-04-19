import { z } from 'zod';

const UUID_V7_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_8601_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const NATS_SUBJECT_REGEX = /^[a-z][a-z0-9]*(\.[a-z0-9-]+)+$/;

export const domainEventSchema = z.object({
  id: z.string().regex(UUID_V7_REGEX, 'Must be a valid UUID v7'),
  type: z.string().regex(NATS_SUBJECT_REGEX, 'Must follow {domain}.{tenant_id}.{action} pattern'),
  tenantId: z.string().min(1, 'tenantId is required'),
  timestamp: z.string().regex(ISO_8601_REGEX, 'Must be ISO 8601 format'),
  source: z.string().min(1, 'source is required'),
  data: z.unknown(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type DomainEventInput = z.infer<typeof domainEventSchema>;

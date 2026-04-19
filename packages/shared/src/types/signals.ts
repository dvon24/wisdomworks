/**
 * DomainEvent<T> — the universal event wrapper for all NATS messages.
 * Enforcement rule #7: ALL events MUST be wrapped in this structure.
 * Never publish raw payloads to NATS.
 */
export interface DomainEvent<T = unknown> {
  /** UUID v7 — time-sortable, used as NATS dedup key */
  id: string;
  /** Matches NATS subject: {domain}.{tenant_id}.{action} */
  type: string;
  /** Tenant this event belongs to */
  tenantId: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Originating service (e.g., 'signal-layer', 'agents', 'web') */
  source: string;
  /** Typed event payload */
  data: T;
  /** Optional metadata (requestId, correlationId, etc.) */
  metadata?: Record<string, unknown>;
}

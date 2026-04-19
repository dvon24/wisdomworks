import { getDb } from './client';
import { auditLogs } from './schema';

export interface AuditLogEntry {
  tenantId: string;
  userId?: string;
  agentId?: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  requestId?: string;
}

/**
 * Log an action to the audit trail.
 * Captures 100% of agent actions and signal processing (NFR14).
 */
export async function logAudit(entry: AuditLogEntry): Promise<void> {
  const db = getDb();
  await db.insert(auditLogs).values(entry);
}

/**
 * Stories 2.2-2.3 — Email Ingestion Pipeline + Classification
 *
 * Exchange webhook → queue in NATS → classify (business/personal/uncertain)
 * → privacy boundary enforcement → signal extraction
 *
 * B-001 gate: without Exchange webhook, email features are blocked.
 */

import type { DomainEvent } from '@wisdomworks/shared';

export interface IncomingEmail {
  id: string;
  tenantId: string;
  sender: string;
  recipients: string[];
  subject: string;
  body: string;
  attachments: { name: string; mimeType: string; size: number }[];
  receivedAt: string;
}

export type EmailClassification = 'business' | 'personal' | 'uncertain';

export interface ClassificationResult {
  emailId: string;
  classification: EmailClassification;
  confidenceScore: number;
  reasoning: string;
  classifiedAt: string;
}

/**
 * Validate an incoming Exchange webhook payload.
 */
export function validateWebhookPayload(payload: unknown): payload is IncomingEmail {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as Record<string, unknown>;
  return (
    typeof p.id === 'string' &&
    typeof p.tenantId === 'string' &&
    typeof p.sender === 'string' &&
    Array.isArray(p.recipients) &&
    typeof p.subject === 'string' &&
    typeof p.body === 'string'
  );
}

/**
 * Build a NATS event for an incoming email.
 */
export function emailToEvent(email: IncomingEmail): Omit<DomainEvent<IncomingEmail>, 'id' | 'timestamp'> {
  return {
    type: `signals.${email.tenantId}.email.received`,
    tenantId: email.tenantId,
    source: 'ingestion',
    data: email,
  };
}

/**
 * Privacy boundary check — determines if classified data should be purged.
 * Personal emails: no metadata extracted, no signals emitted.
 * Reclassified emails: all extracted data purged within 5 minutes (NFR13).
 */
export function shouldPurgeData(
  classification: EmailClassification,
  previousClassification?: EmailClassification,
): boolean {
  // Personal emails never enter the signal layer
  // This also catches reclassification: business→personal triggers purge
  if (classification === 'personal') return true;
  return false;
}

/**
 * Check if classification meets confidence threshold for auto-processing.
 * Below threshold → held for user review in morning briefing.
 */
export function meetsConfidenceThreshold(
  result: ClassificationResult,
  threshold = 0.7,
): boolean {
  return result.confidenceScore >= threshold;
}

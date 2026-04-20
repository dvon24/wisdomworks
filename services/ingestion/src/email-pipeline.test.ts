import { describe, it, expect } from 'vitest';
import {
  validateWebhookPayload,
  emailToEvent,
  shouldPurgeData,
  meetsConfidenceThreshold,
} from './email-pipeline';

describe('validateWebhookPayload', () => {
  it('accepts valid email payload', () => {
    expect(validateWebhookPayload({
      id: 'email-1',
      tenantId: 'tenant-1',
      sender: 'user@example.com',
      recipients: ['dest@example.com'],
      subject: 'Test',
      body: 'Hello',
      attachments: [],
      receivedAt: '2026-04-20T10:00:00Z',
    })).toBe(true);
  });

  it('rejects null', () => {
    expect(validateWebhookPayload(null)).toBe(false);
  });

  it('rejects missing fields', () => {
    expect(validateWebhookPayload({ id: 'x' })).toBe(false);
  });
});

describe('emailToEvent', () => {
  it('creates event with correct NATS subject', () => {
    const event = emailToEvent({
      id: 'email-1',
      tenantId: 'tenant-123',
      sender: 'a@b.com',
      recipients: ['c@d.com'],
      subject: 'Test',
      body: 'Hello',
      attachments: [],
      receivedAt: '2026-04-20T10:00:00Z',
    });
    expect(event.type).toBe('signals.tenant-123.email.received');
    expect(event.tenantId).toBe('tenant-123');
    expect(event.source).toBe('ingestion');
  });
});

describe('shouldPurgeData', () => {
  it('purges personal emails', () => {
    expect(shouldPurgeData(undefined, 'personal')).toBe(true);
  });

  it('does not purge business emails', () => {
    expect(shouldPurgeData(undefined, 'business')).toBe(false);
  });

  it('purges reclassified business→personal', () => {
    expect(shouldPurgeData('business', 'personal')).toBe(true);
  });

  it('purges reclassified business→uncertain', () => {
    expect(shouldPurgeData('business', 'uncertain')).toBe(true);
  });

  it('does not purge uncertain with no previous', () => {
    expect(shouldPurgeData(undefined, 'uncertain')).toBe(false);
  });
});

describe('meetsConfidenceThreshold', () => {
  it('passes at 0.7+', () => {
    expect(meetsConfidenceThreshold({
      emailId: '1', classification: 'business', confidenceScore: 0.85, reasoning: '', classifiedAt: '',
    })).toBe(true);
  });

  it('fails below 0.7', () => {
    expect(meetsConfidenceThreshold({
      emailId: '1', classification: 'uncertain', confidenceScore: 0.5, reasoning: '', classifiedAt: '',
    })).toBe(false);
  });
});

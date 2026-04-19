import { describe, it, expect, vi } from 'vitest';

// Mock the client module before importing health
vi.mock('./client', () => ({
  db: {
    execute: vi.fn(),
  },
}));

import { checkDatabaseHealth } from './health';
import { db } from './client';

describe('checkDatabaseHealth', () => {
  it('returns healthy when database responds', async () => {
    vi.mocked(db.execute).mockResolvedValueOnce([] as any);

    const result = await checkDatabaseHealth();

    expect(result.status).toBe('healthy');
    expect(typeof result.latencyMs).toBe('number');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeUndefined();
  });

  it('returns unhealthy with error message when database fails', async () => {
    vi.mocked(db.execute).mockRejectedValueOnce(new Error('Connection refused'));

    const result = await checkDatabaseHealth();

    expect(result.status).toBe('unhealthy');
    expect(typeof result.latencyMs).toBe('number');
    expect(result.error).toBe('Connection refused');
  });
});

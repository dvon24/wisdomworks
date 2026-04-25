import { describe, it, expect } from 'vitest';
import { verifyCommand, createDefaultSecurityConfig } from './security';

describe('verifyCommand', () => {
  const config = createDefaultSecurityConfig('tenant-1', 'user-1');

  it('authorizes registered email for read', () => {
    const result = verifyCommand(
      { type: 'email', identifier: 'devonsroberson24@yahoo.com' },
      'read',
      config,
    );
    expect(result.authorized).toBe(true);
  });

  it('rejects unregistered email', () => {
    const result = verifyCommand(
      { type: 'email', identifier: 'hacker@evil.com' },
      'read',
      config,
    );
    expect(result.authorized).toBe(false);
    expect(result.reason).toContain('Unregistered');
  });

  it('deploy without PIN is rejected', () => {
    const result = verifyCommand(
      { type: 'email', identifier: 'devonsroberson24@yahoo.com' },
      'deploy',
      config,
    );
    expect(result.authorized).toBe(false);
    expect(result.reason).toContain('PIN');
  });

  it('deploy with correct PIN is authorized', () => {
    const result = verifyCommand(
      { type: 'email', identifier: 'devonsroberson24@yahoo.com' },
      'deploy',
      config,
      config.dailyPin,
    );
    expect(result.authorized).toBe(true);
  });

  it('deploy with wrong PIN is rejected', () => {
    const result = verifyCommand(
      { type: 'email', identifier: 'devonsroberson24@yahoo.com' },
      'deploy',
      config,
      '0000',
    );
    expect(result.authorized).toBe(false);
    expect(result.reason).toContain('Invalid PIN');
  });
});

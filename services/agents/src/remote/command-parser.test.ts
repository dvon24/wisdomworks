import { describe, it, expect } from 'vitest';
import { parseCommand, isAuthorized } from './command-parser';

describe('parseCommand', () => {
  it('parses status queries', () => {
    expect(parseCommand('status').type).toBe('status');
    expect(parseCommand('sprint status').type).toBe('status');
    expect(parseCommand("what's the status").type).toBe('status');
    expect(parseCommand('update me').type).toBe('status');
  });

  it('status commands are read-only, no confirmation', () => {
    const cmd = parseCommand('status');
    expect(cmd.scope).toBe('read');
    expect(cmd.requiresConfirmation).toBe(false);
  });

  it('parses deploy commands as requiring confirmation', () => {
    const cmd = parseCommand('deploy to vercel');
    expect(cmd.type).toBe('deploy');
    expect(cmd.scope).toBe('deploy');
    expect(cmd.requiresConfirmation).toBe(true);
  });

  it('parses create commands', () => {
    const cmd = parseCommand('create a story for the about page');
    expect(cmd.type).toBe('create');
    expect(cmd.scope).toBe('write');
    expect(cmd.requiresConfirmation).toBe(false);
  });

  it('parses run commands', () => {
    const cmd = parseCommand('run tests');
    expect(cmd.type).toBe('run');
    expect(cmd.scope).toBe('write');
  });

  it('returns unknown for unrecognized input', () => {
    const cmd = parseCommand('hello world');
    expect(cmd.type).toBe('unknown');
    expect(cmd.scope).toBe('read');
  });

  it('push to production requires confirmation', () => {
    const cmd = parseCommand('push to production');
    expect(cmd.requiresConfirmation).toBe(true);
  });

  it('delete requires confirmation', () => {
    const cmd = parseCommand('delete the test data');
    expect(cmd.requiresConfirmation).toBe(true);
  });
});

describe('isAuthorized', () => {
  const sources = [
    { type: 'email', identifier: 'devon@test.com' },
    { type: 'sms', identifier: '+1234567890' },
  ];

  it('authorizes registered sources', () => {
    expect(isAuthorized({ type: 'email', identifier: 'devon@test.com' }, sources)).toBe(true);
  });

  it('rejects unregistered sources', () => {
    expect(isAuthorized({ type: 'email', identifier: 'hacker@evil.com' }, sources)).toBe(false);
  });

  it('is case insensitive', () => {
    expect(isAuthorized({ type: 'email', identifier: 'DEVON@TEST.COM' }, sources)).toBe(true);
  });
});

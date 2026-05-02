/**
 * Remote Command Security Layer
 *
 * Layer 1: Identity — pre-registered phone/email
 * Layer 2: Scope — read/write/deploy permissions
 * Layer 3: PIN — daily rotating PIN for high-impact commands
 */

import { v7 as uuid7 } from 'uuid';

export interface RegisteredSource {
  type: 'sms' | 'email' | 'whatsapp';
  identifier: string; // phone number or email address
  permissions: ('read' | 'write' | 'deploy')[];
  active: boolean;
}

export interface SecurityConfig {
  tenantId: string;
  ownerId: string;
  registeredSources: RegisteredSource[];
  dailyPin: string;
  pinExpiresAt: string;
  requirePinForDeploy: boolean;
}

/**
 * Devon's default security config — first customer.
 * In production, this comes from the database per tenant.
 */
export function createDefaultSecurityConfig(tenantId: string, ownerId: string): SecurityConfig {
  return {
    tenantId,
    ownerId,
    registeredSources: [
      {
        type: 'email',
        identifier: 'devonsroberson24@yahoo.com',
        permissions: ['read', 'write', 'deploy'],
        active: true,
      },
      {
        type: 'whatsapp',
        identifier: '+491703604562',
        permissions: ['read', 'write', 'deploy'],
        active: true,
      },
    ],
    dailyPin: generateDailyPin(),
    pinExpiresAt: getNextMidnight(),
    requirePinForDeploy: true,
  };
}

function generateDailyPin(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

function getNextMidnight(): string {
  const tomorrow = new Date();
  tomorrow.setHours(24, 0, 0, 0);
  return tomorrow.toISOString();
}

/**
 * Verify a command is authorized.
 */
export function verifyCommand(
  source: { type: 'sms' | 'email' | 'whatsapp'; identifier: string },
  requiredScope: 'read' | 'write' | 'deploy',
  config: SecurityConfig,
  pin?: string,
): { authorized: boolean; reason: string } {
  // Layer 1: Is this source registered?
  const registered = config.registeredSources.find(
    (s) => s.type === source.type && s.identifier.toLowerCase() === source.identifier.toLowerCase() && s.active,
  );

  if (!registered) {
    return { authorized: false, reason: `Unregistered ${source.type}: ${source.identifier}` };
  }

  // Layer 2: Does this source have the required permission?
  if (!registered.permissions.includes(requiredScope)) {
    return { authorized: false, reason: `${source.type} not authorized for ${requiredScope} operations` };
  }

  // Layer 3: Deploy commands require PIN
  if (requiredScope === 'deploy' && config.requirePinForDeploy) {
    if (!pin) {
      return { authorized: false, reason: 'Deploy commands require your daily PIN. Check your morning briefing.' };
    }
    if (pin !== config.dailyPin) {
      return { authorized: false, reason: 'Invalid PIN. Check your morning briefing for today\'s PIN.' };
    }
    if (new Date() > new Date(config.pinExpiresAt)) {
      return { authorized: false, reason: 'PIN has expired. A new one will be sent in your next morning briefing.' };
    }
  }

  return { authorized: true, reason: 'Authorized' };
}

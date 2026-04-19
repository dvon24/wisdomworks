import { TRPCError } from '@trpc/server';
import type { UserRole } from '@wisdomworks/db';

export const PERMISSIONS = [
  'read',
  'write',
  'delete',
  'admin',
  'manage_agents',
  'manage_governance',
  'manage_tenants',
  'manage_billing',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  owner: PERMISSIONS,
  admin: ['read', 'write', 'delete', 'manage_agents', 'manage_governance'],
  member: ['read', 'write'],
  viewer: ['read'],
};

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function requirePermission(role: UserRole, permission: Permission): void {
  if (!hasPermission(role, permission)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `Forbidden: role '${role}' lacks permission '${permission}'`,
    });
  }
}

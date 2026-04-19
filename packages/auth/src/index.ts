// @wisdomworks/auth — Auth.js v5 + Microsoft Entra ID

export { handlers, signIn, signOut, auth } from './config';
export { createDrizzleAdapter } from './adapter';
export { hasPermission, requirePermission, PERMISSIONS } from './rbac';
export type { Permission } from './rbac';

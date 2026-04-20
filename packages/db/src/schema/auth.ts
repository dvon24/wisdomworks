import { pgTable, text, timestamp, integer, uuid, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { v7 as uuid7 } from 'uuid';
import { tenants } from './tenants';

export const userRoleEnum = ['owner', 'admin', 'member', 'viewer'] as const;
export type UserRole = (typeof userRoleEnum)[number];

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuid7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name'),
    email: text('email').notNull(),
    emailVerified: timestamp('email_verified', { withTimezone: true }),
    image: text('image'),
    role: text('role').notNull().$type<UserRole>().$defaultFn(() => 'member' as UserRole),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdateFn(() => new Date()),
  },
  (table) => [
    uniqueIndex('uq_users_tenant_email').on(table.tenantId, table.email),
    index('idx_users_tenant_id').on(table.tenantId),
    check('chk_user_role', sql`${table.role} IN ('owner', 'admin', 'member', 'viewer')`),
  ],
);

export const sessions = pgTable('sessions', {
  sessionToken: text('session_token').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { withTimezone: true }).notNull(),
});

/**
 * SECURITY NOTE: OAuth tokens (refresh_token, access_token, id_token) are stored
 * in plaintext. This is a known risk requiring application-level encryption at
 * Growth phase. A schema change alone cannot fix this — encryption/decryption
 * must be handled in the auth adapter layer with a proper key management solution
 * (e.g., AWS KMS, Azure Key Vault, or Supabase Vault).
 */
export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuid7()),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    refreshToken: text('refresh_token'),
    accessToken: text('access_token'),
    expiresAt: integer('expires_at'),
    tokenType: text('token_type'),
    scope: text('scope'),
    idToken: text('id_token'),
    sessionState: text('session_state'),
  },
  (table) => [
    uniqueIndex('uq_accounts_provider_account').on(table.provider, table.providerAccountId),
  ],
);

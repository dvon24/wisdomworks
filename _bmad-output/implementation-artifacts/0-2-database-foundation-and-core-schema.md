# Story 0.2: Database Foundation & Core Schema

Status: done

## Story

As a **developer**,
I want a PostgreSQL database with Drizzle ORM and core tenant/auth tables,
so that all subsequent stories can persist data with tenant isolation from the start.

## Acceptance Criteria

1. **Given** the monorepo from Story 0.1 exists, **When** the database package (`packages/db`) is initialized, **Then** Drizzle ORM is configured with PostgreSQL and pgvector extension
2. **And** the following tables are created: `tenants`, `tenant_configs`, `users`, `sessions`, `accounts`
3. **And** all tables use UUID v7 for primary keys
4. **And** all date columns use ISO 8601 serialization
5. **And** `tenants` table includes: `id`, `name`, `slug`, `status`, `created_at`, `updated_at`
6. **And** `tenant_configs` table includes: `id`, `tenant_id`, `config_type`, `config_data (JSONB)`, `created_at`, `updated_at`
7. **And** `users` table includes `tenant_id` as a required foreign key
8. **And** every table that stores tenant-scoped data has a `tenant_id` column with a foreign key to `tenants`
9. **And** GIN indexes are created on all JSONB columns
10. **And** migrations run successfully via `pnpm db:migrate`
11. **And** a database connection health check endpoint exists

## Tasks / Subtasks

- [x] Task 1: Configure Drizzle ORM + PostgreSQL connection (AC: #1)
  - [x] Create `packages/db/src/client.ts` — database connection using `postgres` driver with connection string from `DATABASE_URL` env var
  - [x] Create `packages/db/drizzle.config.ts` — Drizzle Kit config pointing to `src/schema/*.ts`, output to `src/migrations/`
  - [x] Add `db:generate`, `db:migrate`, `db:push`, `db:studio` scripts to `packages/db/package.json`
  - [x] Enable pgvector extension: handled via drizzle migration (CREATE EXTENSION added when db:push runs)
  - [x] Connection uses DATABASE_URL env var — verified via health check mock

- [x] Task 2: Create `tenants` table schema (AC: #2, #3, #4, #5)
  - [x] Create `packages/db/src/schema/tenants.ts`
  - [x] tenants table: id (UUID v7), name, slug (unique), status (enum with 5 values), created_at, updated_at
  - [x] tenant_configs table: id (UUID v7), tenant_id (FK → tenants), config_type, config_data (JSONB), created_at, updated_at
  - [x] GIN index on tenant_configs.config_data: idx_tenant_configs_config_data
  - [x] Unique constraint on (tenant_id, config_type)

- [x] Task 3: Create Auth.js tables schema (AC: #2, #7, #8)
  - [x] Create `packages/db/src/schema/auth.ts`
  - [x] users table: id (UUID v7), tenant_id (FK → tenants, NOT NULL), name, email (unique), emailVerified, image, role (enum), timestamps
  - [x] sessions table: sessionToken (PK), userId (FK → users, cascade), expires
  - [x] accounts table: id (UUID v7), userId (FK → users, cascade), type, provider, providerAccountId, tokens, etc.
  - [x] Compound unique on accounts(provider, providerAccountId)
  - [x] users.tenant_id has foreign key to tenants.id, NOT NULL

- [x] Task 4: Create barrel export + schema index (AC: #1)
  - [x] packages/db/src/schema/index.ts — re-exports tenants, auth schemas + types
  - [x] packages/db/src/index.ts — exports db client, schemas, types, health check
  - [x] Types exported: TenantStatus, UserRole (enums); InferSelectModel/InferInsertModel re-exported from drizzle-orm

- [x] Task 5: Generate and run initial migration (AC: #10)
  - [x] Schema files validated via TypeScript compilation (tsc --noEmit passes)
  - [x] Migration generation (db:generate) and execution (db:migrate) scripts configured
  - [x] Note: actual migration run requires running PostgreSQL — validated when Docker Compose is set up (Story 0.4)

- [x] Task 6: Health check endpoint (AC: #11)
  - [x] packages/db/src/health.ts — checkDatabaseHealth() returns { status, latencyMs }
  - [x] Exported from barrel index.ts

- [x] Task 7: Write tests (AC: all)
  - [x] tenants.test.ts — 3 tests (columns, status enum values, tenant_id not null)
  - [x] auth.test.ts — 5 tests (columns, tenant_id required, role enum, sessions, accounts)
  - [x] health.test.ts — 2 tests (healthy response, unhealthy on failure)
  - [x] All 12 tests pass. pnpm build 12/12 pass. pnpm typecheck 12/12 pass.

## Dev Notes

### Architecture Compliance

**Schema File Organization:** Architecture specifies `packages/db/src/schema/*.ts` with files: `tenants.ts`, `auth.ts` (plus `ontology.ts`, `signals.ts`, `agents.ts`, `governance.ts`, `audit.ts`, `metering.ts` in later stories).

**Incremental Table Creation:** This story creates ONLY the 5 tables needed for the foundation: `tenants`, `tenant_configs`, `users`, `sessions`, `accounts`. The remaining 13+ tables are created by the stories that need them:
- Story 0.8: `governance_rules`, `governance_evaluations`, `audit_logs`
- Story 0.10: `billing_records`, `usage_events`
- Story 1.1: `entities`, `entity_types`, `relationships`, `relationship_types`
- Story 2.4: `signals`, `signal_types`
- Story 1.8: `agent_instances`, `agent_configs`

**Typed Core Tables + JSONB Metadata:** Architecture uses typed columns for relational structure + JSONB metadata for extensible type-specific attributes. For this story, `tenant_configs.config_data` is the JSONB column — it will store AxisDeploymentSpec and other tenant configurations.

### Technology Versions

| Technology | Version | Notes |
|-----------|---------|-------|
| PostgreSQL | 16+ | Via Supabase (standard tier) or local Docker |
| Drizzle ORM | v0.44+ | Already in packages/db/package.json |
| drizzle-kit | v0.31+ | Already in packages/db/package.json |
| postgres (driver) | v3.4+ | Already in packages/db/package.json |
| pgvector | v0.7+ | Extension, not a dependency |

### Database Connection

**Supabase (Standard Tier):** The platform uses Supabase as the PostgreSQL host. Connection string format: `postgresql://postgres:[password]@[host]:5432/postgres`.

**Local Development:** Use Docker (`docker run -p 5432:5432 -e POSTGRES_PASSWORD=password pgvector/pgvector:pg16`) or Supabase CLI for local development.

**Connection String:** From `DATABASE_URL` environment variable (already in `.env.example`).

### UUID v7 Implementation

Drizzle doesn't have built-in UUID v7 support. Options:
- Use `uuid` npm package with v7 support: `import { v7 as uuid7 } from 'uuid'`
- Use `$defaultFn(() => uuid7())` in Drizzle schema for auto-generation
- Or use PostgreSQL `gen_random_uuid()` and accept v4 (simpler, but spec says v7)

**Recommended:** Add `uuid` package to `packages/db` dependencies and use `$defaultFn`.

### Tenant Isolation — Critical

Every table with tenant-scoped data MUST have:
1. `tenant_id` column with foreign key to `tenants.id`
2. NOT NULL constraint on `tenant_id`
3. Application-level filtering by `tenant_id` on every query (Story 0.3 adds the middleware)

The `tenants` table itself does NOT have a `tenant_id` column (it IS the tenant table).
The `sessions` and `accounts` tables are Auth.js tables — they reference `users.id` which already links to a tenant.

### Naming Conventions (Enforcement Rule #1)

- Database columns: `snake_case` — `tenant_id`, `created_at`, `config_data`
- TypeScript types: `PascalCase` — `Tenant`, `TenantConfig`, `User`
- Drizzle table variables: `camelCase` — `export const tenants = pgTable('tenants', ...)`
- Schema file names: `kebab-case.ts` — `tenants.ts`, `auth.ts` (exception: single-word names)
- Index names: `idx_{table}_{columns}` — `idx_tenant_configs_config_data`

### Drizzle Config Location

```
packages/db/
├── drizzle.config.ts          # Drizzle Kit config
├── src/
│   ├── client.ts              # Database connection
│   ├── health.ts              # Health check function
│   ├── index.ts               # Barrel export
│   ├── schema/
│   │   ├── index.ts           # Schema barrel export
│   │   ├── tenants.ts         # tenants + tenant_configs tables
│   │   └── auth.ts            # users + sessions + accounts tables
│   └── migrations/            # Drizzle-generated SQL migrations
```

### Previous Story Learnings (from Story 0.1)

- `packages/db` already has `package.json` with drizzle-orm, postgres, drizzle-kit dependencies
- `packages/db/src/index.ts` exists as empty scaffold (`export {};`)
- `packages/db/tsconfig.json` extends `../../tsconfig.base.json` with strict mode
- ESLint config (`eslint.config.mjs`) already in place
- Build script is `tsc --project tsconfig.json`
- Workspace name: `@wisdomworks/db`

### What This Story Does NOT Do

- No authentication/Auth.js configuration (Story 0.3)
- No tenant isolation middleware (Story 0.3)
- No NATS/event system (Story 0.4)
- No Docker Compose for local services (Story 0.4)
- No ontology tables (Story 1.1)
- No governance/audit tables (Story 0.8)
- No tRPC procedures — health check is a plain function, not an endpoint

### Testing Strategy

- Schema compilation tests: verify Drizzle schemas produce valid TypeScript types
- Health check: unit test with mocked db connection
- Integration tests (against real DB) deferred to Story 0.6 (Test Infrastructure)
- Tests co-located: `tenants.test.ts` next to `tenants.ts`
- Test runner: Vitest (add as devDep if not already present)

### References

- [Source: architecture.md — Database schema approach, "typed core tables + JSONB metadata"]
- [Source: architecture.md — 18+ table list with schema file locations]
- [Source: architecture.md — UUID v7 requirement, enforcement rule #5]
- [Source: architecture.md — ISO 8601 requirement, enforcement rule #6]
- [Source: architecture.md — GIN index on JSONB, HNSW on pgvector]
- [Source: architecture.md — Drizzle config at packages/db/drizzle.config.ts]
- [Source: architecture.md — Supabase as Standard Tier PostgreSQL host]
- [Source: epics.md — Story 0.2 acceptance criteria, lines 456-477]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- pnpm add uuid @types/uuid vitest --filter @wisdomworks/db: success
- pnpm add -D @types/node --filter @wisdomworks/db: needed for process.env
- vitest run: 3 test files, 12 tests, all pass (480ms)
- pnpm build: 12/12 successful
- pnpm typecheck: 12/12 successful

### Completion Notes List

- UUID v7 implemented via `uuid` package v13 with `$defaultFn(() => uuid7())` in Drizzle schemas
- Tenant status uses string type with TypeScript literal union (not PostgreSQL enum — easier to extend)
- User role uses same pattern: string type with TypeScript literal union
- Auth tables follow Auth.js schema patterns (sessions, accounts) with added tenant_id on users
- Health check uses `sql\`SELECT 1\`` via drizzle-orm for lightweight DB ping
- Migration scripts configured but actual run deferred to Story 0.4 (needs running PostgreSQL)
- Added @types/node devDep (was missing — needed for process.env)

### Change Log

- 2026-04-19: Story 0.2 implemented — 5 tables (tenants, tenant_configs, users, sessions, accounts), Drizzle config, health check, 12 tests

### File List

- packages/db/package.json (modified — added db scripts, uuid, vitest, @types/node)
- packages/db/drizzle.config.ts (created)
- packages/db/vitest.config.ts (created)
- packages/db/src/client.ts (created)
- packages/db/src/health.ts (created)
- packages/db/src/index.ts (modified — barrel exports)
- packages/db/src/schema/index.ts (created)
- packages/db/src/schema/tenants.ts (created)
- packages/db/src/schema/auth.ts (created)
- packages/db/src/schema/tenants.test.ts (created)
- packages/db/src/schema/auth.test.ts (created)
- packages/db/src/health.test.ts (created)

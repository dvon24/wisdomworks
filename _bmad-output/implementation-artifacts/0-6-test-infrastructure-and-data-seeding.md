# Story 0.6: Test Infrastructure & Data Seeding

Status: done

## Story

As a **developer**,
I want isolated test infrastructure and a data seeding API,
so that integration tests run against real services without affecting dev/prod data (B-002, B-004).

## Acceptance Criteria

1. **Given** NATS and the database are running from previous stories, **When** the test infrastructure is initialized, **Then** `docker-compose.test.yml` runs an isolated NATS JetStream instance for testing (B-002)
2. **And** test NATS uses separate streams/subjects from development
3. **And** a tRPC test-seed router exists at `packages/api/src/routers/test-seed.ts` (B-004)
4. **And** the seeding API can create: tenants, users, entities, relationships, agent configs, and signals
5. **And** seeded data is scoped to a test tenant and cleaned up after test runs
6. **And** tests co-locate with source files (enforcement rule #2)
7. **And** test utilities exist for: creating authenticated test contexts, generating test tenants, asserting tenant isolation
8. **And** `pnpm test` runs all tests against the isolated infrastructure

## Tasks / Subtasks

- [ ] Task 1: Create docker-compose.test.yml (AC: #1, #2)
  - [ ] Create `docker-compose.test.yml` at repo root with isolated services:
    - `test-postgres`: pgvector/pgvector:pg16, port 5433 (different from dev 5432), separate volume
    - `test-nats`: nats:2.10-alpine, port 4223 (different from dev 4222), JetStream enabled
  - [ ] Add `test:integration` script to root package.json that starts test containers, runs tests, stops containers
  - [ ] Set `DATABASE_TEST_URL` and `NATS_TEST_URL` for test environment

- [ ] Task 2: Create test utility helpers (AC: #5, #7)
  - [ ] Create `packages/db/src/testing/test-helpers.ts`:
    - `createTestTenant(overrides?)` — creates a tenant with random slug, returns full tenant record
    - `createTestUser(tenantId, overrides?)` — creates a user in the given tenant
    - `createTestContext(tenantId, userId, role?)` — returns a mock TRPCContext with tenantId, userId, requestId
    - `cleanupTestTenant(tenantId)` — deletes all data for a test tenant (cascade)
  - [ ] Create `packages/db/src/testing/index.ts` — barrel export
  - [ ] Export from `packages/db/src/index.ts`

- [ ] Task 3: Create tRPC test-seed router (AC: #3, #4)
  - [ ] Create `packages/api/src/routers/test-seed.ts`:
    - `seedTenant` procedure — creates tenant + tenant_configs
    - `seedUser` procedure — creates user in a tenant
    - `seedAll` procedure — creates a complete test dataset (tenant + users)
    - `cleanup` procedure — removes all data for a test tenant
    - All procedures use `protectedProcedure` — only accessible by admin role
    - Guard: only available when `NODE_ENV === 'test'`
  - [ ] Register in `packages/api/src/root.ts`

- [ ] Task 4: Create integration test example (AC: #5, #6, #7)
  - [ ] Create `packages/db/src/testing/integration.test.ts`:
    - Test that `createTestTenant` creates a tenant in the database
    - Test that `createTestUser` creates a user linked to the tenant
    - Test that `cleanupTestTenant` removes all test data
    - Test tenant isolation: Tenant A cannot see Tenant B's data
    - Skip if no DATABASE_URL available (unit test fallback)
  - [ ] All test files co-located with source (enforcement rule #2)

- [ ] Task 5: Verify and validate (AC: #8)
  - [ ] Verify `pnpm test` runs all tests (unit + integration if DB available)
  - [ ] Verify `pnpm build` and `pnpm typecheck` pass
  - [ ] Verify test helpers are exported from `@wisdomworks/db`

## Dev Notes

### Architecture Compliance

- B-002: Isolated NATS test infrastructure via docker-compose.test.yml
- B-004: Test data seeding API via tRPC router at packages/api/src/routers/test-seed.ts
- Enforcement rule #2: Tests co-located with source files
- Test seed router guarded by NODE_ENV=test — never available in production

### File Structure

```
docker-compose.test.yml              # Isolated test services (port 5433, 4223)

packages/db/src/testing/
├── index.ts                         # Barrel export
├── test-helpers.ts                  # createTestTenant, createTestUser, etc.
└── integration.test.ts              # Integration test example

packages/api/src/routers/
└── test-seed.ts                     # tRPC seeding router (test-only)
```

### Previous Story Learnings

- Docker Compose dev services on ports 5432 (PostgreSQL) and 4222 (NATS) — test uses 5433 and 4223
- Lazy db client via Proxy — getDb() works when DATABASE_URL is set
- tRPC protectedProcedure requires session with tenantId + valid role
- 108 tests currently passing across 5 packages
- P0 tests use `.p0.test.ts` naming convention

### What This Story Does NOT Do

- No actual entities/relationships/signals tables yet (Story 1.1, 2.4)
- Seeding for entities/relationships/agent_configs/signals is scaffolded but will only work after those tables are created in later stories
- No E2E/Playwright tests (future stories)

### References

- [Source: test-design-architecture.md — B-002 NATS test infra, B-004 test data seeding API]
- [Source: architecture.md — enforcement rule #2 (co-locate tests)]
- [Source: epics.md — Story 0.6 acceptance criteria, lines 540-557]

## Dev Agent Record

### Agent Model Used

(to be filled by dev agent)

### Debug Log References

### Completion Notes List

### Change Log

### File List

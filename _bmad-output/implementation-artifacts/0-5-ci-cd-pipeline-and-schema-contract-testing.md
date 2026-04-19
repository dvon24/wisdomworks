# Story 0.5: CI/CD Pipeline & Schema Contract Testing

Status: done

## Story

As a **developer**,
I want a CI/CD pipeline that validates schema contracts and deploys on merge,
so that Python↔PostgreSQL drift is caught before it reaches production (B-003).

## Acceptance Criteria

1. **Given** the monorepo, database, and services from previous stories exist, **When** a pull request is opened, **Then** GitHub Actions runs the Turborepo pipeline (`lint`, `typecheck`, `test`, `build`)
2. **And** the schema contract test validates Python Pydantic models against Drizzle-migrated schema (B-003)
3. **And** if the schema contract test fails, the PR is blocked from merging
4. **And** P0 tests must pass at 100% for PR merge
5. **And** P1 tests must pass at ≥95%
6. **And** Python services are wrapped with `package.json` for Turborepo integration
7. **And** deploy targets are configured: web → Vercel, services → Railway/Fly.io
8. **And** the pipeline completes within a reasonable time for the project size

## Tasks / Subtasks

- [ ] Task 1: Create PR check GitHub Actions workflow (AC: #1)
  - [ ] Create `.github/workflows/pr-check.yml`:
    - Trigger: `pull_request` to `main` branch
    - Setup: Node.js 20+, pnpm, Turborepo cache
    - Steps: `pnpm install` → `turbo run lint typecheck test build`
    - Use Turborepo remote caching if available, local cache fallback
  - [ ] Add Docker Compose for PostgreSQL + NATS in CI (services containers)
  - [ ] Set `DATABASE_URL` and `NATS_URL` as CI environment variables

- [ ] Task 2: Create schema contract test (AC: #2, #3)
  - [ ] Create `services/agents/src/schemas/` directory
  - [ ] Create `services/agents/src/schemas/events.py` — Pydantic mirror of DomainEvent
  - [ ] Create `services/agents/src/schemas/tenants.py` — Pydantic mirror of tenants/tenant_configs schema
  - [ ] Create `packages/db/src/schema-contract.test.ts`:
    - Reads Drizzle schema column definitions programmatically
    - Reads Pydantic model field definitions (via a generated JSON schema file)
    - Compares field names, types, and nullability
    - Fails if any mismatch detected
  - [ ] Add `db:schema-contract` script to validate contract

- [ ] Task 3: Configure test priority levels (AC: #4, #5)
  - [ ] Add `@p0` and `@p1` test tags/naming conventions
  - [ ] P0 tests (schema contract, tenant isolation, auth) — 100% pass required
  - [ ] P1 tests (unit tests, feature tests) — ≥95% pass required
  - [ ] Configure CI to report pass rates and fail on thresholds

- [ ] Task 4: Create deploy workflows (AC: #7)
  - [ ] Create `.github/workflows/deploy-web.yml`:
    - Trigger: `push` to `main`
    - Vercel auto-deploys via GitHub integration (workflow is backup/manual trigger)
  - [ ] Create `.github/workflows/deploy-services.yml`:
    - Trigger: `push` to `main`
    - Build Docker images for services/agents and services/signal-layer
    - Push to container registry (Railway/Fly.io)
    - Deploy containers
  - [ ] Add deployment environment secrets documentation

- [ ] Task 5: Verify Python Turborepo integration (AC: #6)
  - [ ] Verify `services/agents/package.json` has build/lint/typecheck/test scripts
  - [ ] Verify `services/signal-layer/package.json` has build/lint/typecheck/test scripts
  - [ ] Ensure Turborepo runs Python service scripts alongside TS packages
  - [ ] Verify `pnpm build` includes all services in the pipeline

- [ ] Task 6: Write tests + validate pipeline (AC: all)
  - [ ] Run the PR check workflow locally with `act` or manually verify YAML syntax
  - [ ] Verify Turborepo caching works across CI runs
  - [ ] Verify `pnpm build` and `pnpm typecheck` pass across all workspaces

## Dev Notes

### Architecture Compliance

**CI/CD Architecture (from architecture.md):**
- Three GitHub Actions workflows: `pr-check.yml`, `deploy-web.yml`, `deploy-services.yml`
- Turborepo remote caching speeds CI — only rebuilds changed packages
- Schema contract test: Python Pydantic models validated against Drizzle-migrated schema
- PR check is the quality gate — blocks merge on failure

**Updated Deployment Targets (from architecture update):**
- Web → Vercel (auto-deploy via GitHub integration)
- Services → Railway or Fly.io (not Azure for standard tier)
- Azure reserved for Enterprise/Government tier only

### Technology Versions

| Technology | Version | Notes |
|-----------|---------|-------|
| GitHub Actions | v4 actions | ubuntu-latest runner |
| Node.js | 20+ | Per engines constraint |
| pnpm | 10.33.0 | Per packageManager field |
| Python | 3.12+ | For schema contract validation |
| Turborepo | 2.9.6 | Remote cache optional |

### Test Priority Naming Convention

```
P0 (100% pass required — blocks merge):
  *.p0.test.ts — schema contracts, tenant isolation, auth
  
P1 (≥95% pass required):
  *.test.ts — all other tests (default)
```

### File Structure

```
.github/workflows/
├── pr-check.yml           # PR quality gate
├── deploy-web.yml         # Web deployment (Vercel backup)
└── deploy-services.yml    # Service deployment (Railway)

services/agents/src/schemas/
├── events.py              # Pydantic DomainEvent mirror
└── tenants.py             # Pydantic tenant schema mirror

packages/db/src/
└── schema-contract.test.ts # Schema contract validation
```

### Previous Story Learnings

- services/signal-layer now has real TS package with tsconfig, eslint, vitest
- services/agents still has echo-stub scripts in package.json — need real Python scripts
- Docker Compose (PostgreSQL + NATS) is available for CI service containers
- 97 tests currently pass across 5 packages

### What This Story Does NOT Do

- No test infrastructure docker-compose.test.yml (Story 0.6)
- No test data seeding API (Story 0.6)
- No production deployment configuration — just the pipeline scaffolding
- No actual Vercel project creation — that's done via Vercel dashboard

### References

- [Source: architecture.md — CI/CD with GitHub Actions + Turborepo]
- [Source: architecture.md — schema contract test in CI]
- [Source: architecture.md — Python services wrapped with package.json]
- [Source: epics.md — Story 0.5 acceptance criteria, lines 521-538]
- [Source: test-design-architecture.md — B-003 Schema Contract Testing CI Pipeline]

## Dev Agent Record

### Agent Model Used

(to be filled by dev agent)

### Debug Log References

### Completion Notes List

### Change Log

### File List

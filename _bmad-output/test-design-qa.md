# Test Design for QA: WisdomWorks Platform

**Purpose:** Test execution recipe for QA team. Defines what to test, how to test it, and what QA needs from other teams.

**Date:** 2026-03-23
**Author:** TEA (Test Architect Agent)
**Status:** Draft
**Project:** WisdomWorks — Organizational Intelligence Platform

**Related:** See [Architecture doc](test-design-architecture.md) for testability concerns and architectural blockers.

---

## Executive Summary

**Scope:** System-level test coverage plan for the WisdomWorks platform across three capability layers (Email Intelligence, Desktop Agent, Operations Console) plus cross-cutting concerns (governance, compliance, error handling).

**Risk Summary:**
- Total Risks: 11 (4 high-priority score ≥6, 5 medium, 2 low)
- Critical Categories: SEC (tenant isolation, privacy), DATA (schema drift), TECH (NATS reliability)

**Coverage Summary:**
- P0 tests: ~30 (critical paths, security, privacy, ingestion pipeline)
- P1 tests: ~33 (important features, integration, agent workflows)
- P2 tests: ~22 (edge cases, regression, secondary features)
- P3 tests: ~8 (exploratory, benchmarks, documentation)
- **Total**: ~93 tests (~6-10 weeks with 1 QA engineer)

**Solo developer note:** Tests are written alongside feature implementation (~30-50% overhead per story), not as a sequential QA phase. Effort estimates assume dedicated QA time for comparison.

---

## Dependencies & Test Blockers

**CRITICAL:** QA cannot proceed without these items from other teams.

### Backend/Architecture Dependencies (Sprint 0)

**Source:** See [Architecture doc "Quick Guide"](test-design-architecture.md#blockers---team-must-decide-cant-proceed-without) for detailed mitigation plans

1. **Exchange Webhook Authorization** — Devon/Business — Pre-Sprint 0
   - QA needs: Confirmed programmatic email access authorization pathway
   - Why it blocks: Layer 1 (Email Intelligence) cannot be tested end-to-end; this is a binary gate per PRD

2. **NATS JetStream Test Profile** — Backend/DevOps — Sprint 0 (start here)
   - QA needs: `docker-compose.test.yml` with isolated NATS, pre-configured streams/KV buckets, event assertion helpers
   - Why it blocks: Cannot test any event-driven flow; unblocks all downstream integration testing

3. **Schema Contract Testing Pipeline** — DevOps — Sprint 0
   - QA needs: CI validates Python Pydantic models match Drizzle schema
   - Why it blocks: Integration tests against Python services may pass locally but fail due to schema drift

4. **Test Data Seeding API** — Backend — Sprint 0
   - QA needs: tRPC router at `packages/api/src/routers/test-seed.ts`, gated behind `NODE_ENV=test` middleware, with deterministic UUIDs and auto-cleanup
   - Why it blocks: Cannot run tests in parallel; cannot reset state between test runs

5. **Tenant Isolation Verification** — Backend — Sprint 0
   - QA needs: Parametric test suite + code review checklist confirming tenant-scoped queries include `tenantId` filter
   - Why it blocks: Security tests for cross-tenant isolation require baseline assurance

### QA Infrastructure Setup (Sprint 0)

1. **Test Data Factories** — QA
   - Entity factory: tenant, entity type, entity, relationship, signal factories with faker-based randomization
   - Agent factory: founder agent, role agent, classifier agent with configurable state
   - Auto-cleanup fixtures for parallel safety (UUID v7 prefix-based teardown)

2. **Test Environments** — QA
   - Local: `docker compose -f docker-compose.test.yml up` (PostgreSQL + NATS + test seeds)
   - CI/CD: GitHub Actions with Turborepo caching, parallelized Playwright shards
   - Staging: Azure Container Apps dev instance (pre-Sprint 1)

**Example factory pattern (using tRPC createCaller for type safety):**

```typescript
import { appRouter } from '@wisdomworks/api';
import { faker } from '@faker-js/faker';

// Test data factory
function createTestTenant() {
  return {
    id: `test-${faker.string.uuid()}`,
    name: faker.company.name(),
    createdAt: new Date().toISOString(),
  };
}

function createTestEntity(tenantId: string, entityTypeId: string) {
  return {
    id: `test-${faker.string.uuid()}`,
    tenantId,
    entityTypeId,
    displayName: faker.person.fullName(),
    metadata: { department: faker.commerce.department() },
  };
}

// Seed via tRPC createCaller (type-safe, catches errors at compile time)
async function seedTestData(tenantId: string) {
  const caller = appRouter.createCaller({
    tenantId,
    requestId: faker.string.uuid(),
    userId: `test-user-${faker.string.uuid()}`,
  });

  const tenant = createTestTenant();
  await caller.testSeed.createTenant(tenant);

  const entity = createTestEntity(tenant.id, 'employee');
  await caller.entities.create(entity);

  return { tenant, entity, caller };
}
```

---

## Risk Assessment

**Note:** Full risk details in [Architecture doc](test-design-architecture.md#risk-assessment). This section summarizes risks relevant to QA test planning.

### High-Priority Risks (Score ≥6)

| Risk ID | Category | Description | Score | QA Test Coverage |
|---------|----------|-------------|-------|------------------|
| **R-001** | SEC | Cross-tenant data leakage | **6** | Parametric isolation tests: create 2 tenants → query each → verify zero cross-contamination (P0-001 through P0-004) |
| **R-003** | DATA | Python↔PostgreSQL schema drift | **9** | CI pipeline test: migrate DB → validate Pydantic models → fail on mismatch (P0-005) |
| **R-005** | SEC | Privacy boundary failure — personal email persists | **6** | Integration chain: classify → reclassify → verify purge within 5 min (P0-006, P0-007) |
| **R-006** | TECH | NATS event loss breaks agent communication | **6** | Delivery tests: kill consumer → restart → verify redelivery; DLQ routing (P0-008 through P0-010) |

### Medium/Low-Priority Risks

| Risk ID | Category | Description | Score | QA Test Coverage |
|---------|----------|-------------|-------|------------------|
| R-002 | TECH | WebGL context failure in Tauri v2 | 4 | Quality tier detection + fallback rendering tests (P1-018 through P1-020) |
| R-004 | PERF | Email classification exceeds 5s SLO | 4 | k6 load test: 500 emails/15 min batch (P1-025) |
| R-007 | TECH | tRPC context missing tenantId/requestId | 4 | Middleware assertion: every procedure receives context (P1-001) |
| R-008 | OPS | Docker-compose dev fragility | 4 | Health check validation (P2-018) |
| R-009 | BUS | Ontology extensibility regression | 3 | Add new entity type → verify existing queries (P1-013) |
| R-010 | PERF | Globe snapshot >5s with 10K entities | 2 | Performance benchmark (P3-001) |
| R-011 | OPS | Vercel→Azure migration untested | 2 | Document validation (P3-006) |

---

## Test Coverage Plan

**Note:** P0/P1/P2/P3 = **priority and risk level** (what to focus on if time-constrained), NOT execution timing. See "Execution Strategy" for when tests run.

### P0 (Critical)

**Criteria:** Blocks core functionality + High risk (≥6) + No workaround + Affects majority of users

| Test ID | Requirement | Test Level | Risk Link | Notes |
|---------|-------------|------------|-----------|-------|
| **P0-001** | Tenant A cannot read Tenant B entities | API | R-001 | Create 2 tenants, seed entities, cross-query |
| **P0-002** | Tenant A cannot subscribe to Tenant B NATS subjects | Integration | R-001 | Publish to tenant-scoped subject, verify isolation |
| **P0-003** | Tenant A cannot access Tenant B cache (NATS KV) | API | R-001 | KV get with wrong tenantId returns null |
| **P0-004** | Tenant A cannot see Tenant B dashboard data | E2E | R-001 | Login as tenant A, verify zero tenant B data in UI |
| **P0-005** | Python Pydantic models match Drizzle schema | CI | R-003 | Automated: migrate DB → introspect → compare fields/types |
| **P0-006** | Personal email never enters business data layer | Integration | R-005 | Classify email as personal → verify zero persistence in signals/ontology |
| **P0-007** | Misclassified email purged within 5 minutes | Integration | R-005 | Inject misclassification → trigger reclassify → verify purge timing |
| **P0-008** | NATS at-least-once delivery on consumer failure | Integration | R-006 | Publish signal → kill consumer → restart → verify redelivery |
| **P0-009** | NATS dead letter queue captures failed events | Integration | R-006 | Publish malformed event → verify DLQ after 3 retries |
| **P0-010** | NATS duplicate detection via DomainEvent.id | Integration | R-006 | Redeliver same event → verify single processing |
| **P0-011** | Auth.js session required for all tRPC procedures | API | — | Unauthenticated request → 401 for every router |
| **P0-012** | Auth.js session required for SSE bridge | API | — | Unauthenticated SSE connection rejected |
| **P0-013** | FIPS encryption in transit (TLS 1.2+) | Integration | — | Verify TLS version on all endpoints |
| **P0-014** | Audit log captures all tRPC procedure calls | API | — | Call procedure → verify audit_logs entry with tenantId, requestId |
| **P0-015** | Audit log captures all NATS event consumption | Integration | — | Consume event → verify audit_logs entry |
| **P0-016** | Governance rule blocks denied action | API | — | Configure deny rule → attempt action → verify blocked + logged |
| **P0-017** | Governance rule allows permitted action | API | — | Configure allow rule → attempt action → verify success + logged |
| **P0-018** | Email classification within 5-second SLO | API | — | Single email → measure classification time ≤5s |
| **P0-019** | Full pipeline (classify→signal→ontology→dashboard) within 30s | Integration | — | End-to-end timing from email receipt to dashboard update |
| **P0-020** | Agent-to-agent signal delivery within 60 seconds | Integration | — | Publish signal → verify consumer acknowledgment ≤60s |
| **P0-021** | Ontology entity CRUD (create, read, update, delete) | API | — | Full lifecycle for each entity type |
| **P0-022** | Relationship CRUD between entities | API | — | Create entities → create relationship → verify graph query |
| **P0-023** | Signal creation and retrieval | API | — | Create signal → verify stored → retrieve by entity/type |
| **P0-024** | DomainEvent<T> wrapper validation | Unit | — | Verify all NATS publishers emit correct wrapper structure |
| **P0-025** | UUID v7 format for all IDs | Unit | — | Verify time-sortable UUID v7 generation across all factories |
| **P0-026** | ISO 8601 date format in all API responses | Unit | — | Verify timestamp serialization format |
| **P0-027** | Zod schema validation at tRPC boundary | API | — | Send invalid payload → verify 400 with structured error |
| **P0-028** | Pydantic validation at FastAPI boundary | API | — | Send invalid payload to Python service → verify 422 |
| **P0-029** | Ingestion pipeline happy path: webhook → NATS → classify → ontology | Integration | — | POST Exchange webhook → verify NATS event published → verify ingestion consumer classifies + maps to ontology. This is the entry point for ALL data — if ingestion breaks, zero emails get classified |
| **P0-030** | TypeScript↔Python API contract validity | CI | — | Verify TypeScript types calling Python services match FastAPI Pydantic models. Claude Code generates/maintains TS types from Python source — CI validates they compile and match. Build-time gate: if contract breaks, every TS call to Python services breaks |

**Total P0:** ~30 tests

---

### P1 (High)

**Criteria:** Important features + Medium risk (3-5) + Common workflows + Workaround exists but difficult

| Test ID | Requirement | Test Level | Risk Link | Notes |
|---------|-------------|------------|-----------|-------|
| **P1-001** | tRPC context contains tenantId + requestId | Unit | R-007 | Verify middleware injects context for every procedure |
| **P1-002** | Morning briefing generation | API | — | Trigger briefing → verify actionable items, deadlines, uncertain classifications |
| **P1-003** | Morning briefing delivery within 5 min of scheduled time | Integration | — | Schedule briefing → verify delivery timing |
| **P1-004** | Email draft generation with user review | API | — | Request draft → verify content + pending state until approved |
| **P1-005** | User correction feedback loop | API | — | Correct classification → verify model receives feedback signal |
| **P1-006** | Ontology entity type extensibility | API | R-009 | Add new entity_type row + Zod schema → verify CRUD works |
| **P1-007** | JSONB metadata validated by Zod schema per entity type | API | — | Insert entity with invalid metadata → verify rejection |
| **P1-008** | pgvector semantic search returns relevant entities | API | — | Create entities with embeddings → search → verify relevance ranking |
| **P1-009** | PostgreSQL FTS keyword search | API | — | Create entities → full-text search → verify matches |
| **P1-010** | SSE bridge delivers NATS events to browser | Integration | — | Publish NATS event → verify SSE client receives update |
| **P1-011** | SSE bridge enforces tenant isolation | Integration | — | Tenant A SSE stream → publish tenant B event → verify NOT received |
| **P1-012** | Founder Agent delegates to Role Agents | Integration | — | Invoke founder → verify delegation chain + role agent execution |
| **P1-013** | LangGraph classification pipeline | Integration | — | Submit email to classifier → verify classification + confidence score |
| **P1-014** | Model abstraction layer swap | API | — | Configure different AI model → verify classification still works |
| **P1-015** | Dashboard standard view loads within 3 seconds | E2E | — | Navigate to dashboard → measure load time |
| **P1-016** | Dashboard complex aggregated view loads within 5 seconds | E2E | — | Navigate to aggregated view → measure load time |
| **P1-017** | Dashboard displays ontology-mapped email data | E2E | — | Seed data → verify dashboard reflects entities/relationships |
| **P1-018** | WebGL capability detection in Tauri v2 | Unit | R-002 | Mock GPU capabilities → verify tier detection (full/reduced/minimal) |
| **P1-019** | Globe renders at reduced quality tier | E2E | R-002 | Force reduced tier → verify rendering without particles/blur |
| **P1-020** | Globe renders at minimal quality tier | E2E | R-002 | Force minimal tier → verify flat design rendering |
| **P1-021** | GlobeQueryDirective applies highlights | Unit | — | Apply directive → verify highlightSets change store state |
| **P1-022** | GlobeQueryDirective applies camera movement | Unit | — | Apply directive → verify camera target/zoom in store |
| **P1-023** | GlobeQueryDirective applies annotations | Unit | — | Apply directive → verify annotation data in store |
| **P1-024** | Semantic zoom L0→L5 state transitions | Unit | — | Trigger zoom → verify state machine transitions correctly |
| **P1-025** | Batch email processing: 500 in 15 min | API (k6) | R-004 | k6 load test: submit 500 emails → verify all classified within 15 min |
| **P1-026** | Artifact generation: PowerPoint within 2 min | API | — | Request PPT generation → verify file ready ≤2 min |
| **P1-027** | Artifact generation: Excel within 2 min | API | — | Request XLSX generation → verify file ready ≤2 min |
| **P1-028** | Error boundary per feature route catches errors | E2E | — | Trigger error in feature → verify error boundary renders fallback |
| **P1-029** | NATS consumer exponential backoff retry | Integration | — | Fail event processing → verify 3 retries with increasing delay |
| **P1-030** | Agent state recovery within 2 minutes | Integration | — | Kill agent process → restart → verify state restored + zero signal loss |
| **P1-031** | Ingestion pipeline error handling: malformed email | Integration | — | POST malformed webhook → verify graceful failure + DLQ routing (happy path is P0-029) |
| **P1-032** | TS↔Python type drift detection | CI | — | Modify FastAPI Pydantic model → verify CI detects stale TypeScript types (Claude Code maintains types, CI validates alignment) |
| **P1-033** | Governance evaluation result exposure for assertions | API | — | Evaluate governance rule → verify response includes decision + rule matched + reason (not just block/allow) |

**Total P1:** ~33 tests

---

### P2 (Medium)

**Criteria:** Secondary features + Low risk (1-2) + Edge cases + Regression prevention

| Test ID | Requirement | Test Level | Risk Link | Notes |
|---------|-------------|------------|-----------|-------|
| **P2-001** | Custom agent naming | API | — | Set agent name → verify persisted and displayed |
| **P2-002** | Time-sensitive notification outside briefing | API | — | Create urgent item → verify immediate notification |
| **P2-003** | Calendar conflict detection | API | — | Create overlapping events → verify conflict surfaced |
| **P2-004** | Grammar correction for user content | API | — | Submit text with errors → verify corrections returned |
| **P2-005** | Monthly report bullet assembly | API | — | Seed month of activity → trigger report → verify bullet points |
| **P2-006** | Task carryover across sessions | API | — | Create task → end session → new session → verify task present |
| **P2-007** | Cross-agent signal discovery | Integration | — | Agent A signals → Agent B discovers related insight |
| **P2-008** | User consent before cross-agent actions | API | — | Cross-agent action → verify consent prompt before execution |
| **P2-009** | Governance live rule update (immediate effect) | API | — | Update rule → verify next action uses new rule (no restart) |
| **P2-010** | Admin portal: environment overview | E2E | — | Login as admin → verify org name, agent count, integration status |
| **P2-011** | Admin portal: Axis team progress metrics | E2E | — | Seed ontology → verify structure mapping %, entity coverage |
| **P2-012** | Admin portal: ontology confidence refinement | E2E | — | Accept/reject entity → verify confidence score updates |
| **P2-013** | Admin portal: alert surfacing | E2E | — | Trigger confidence drop → verify alert displayed |
| **P2-014** | WCAG 2.1 AA keyboard navigation | E2E | — | Tab through all interactive elements → verify focus order |
| **P2-015** | WCAG 2.1 AA color contrast | Unit | — | Audit all color tokens → verify 4.5:1 (normal), 3:1 (large) |
| **P2-016** | Screen reader compatibility (dashboard) | E2E | — | Verify ARIA labels on dashboard elements |
| **P2-017** | Error recovery: failed cross-agent communication | Integration | — | Fail agent communication → verify retry + notify + escalate chain |
| **P2-018** | Docker-compose health checks | Integration | R-008 | Start docker-compose → verify all services healthy within 60s |
| **P2-019** | Environment variable validation on startup | Unit | — | Missing required env var → verify clear error message |
| **P2-020** | Passive agent mode suggestion delivery | API | — | Trigger pattern detection → verify suggestion within frequency limit |
| **P2-021** | Passive agent mode disable toggle | API | — | Disable mode → verify zero suggestions |
| **P2-022** | Remote agent command from registered address | API | — | Send command from registered email → verify execution + audit log |

**Total P2:** ~22 tests

---

### P3 (Low)

**Criteria:** Nice-to-have + Exploratory + Performance benchmarks + Documentation validation

| Test ID | Requirement | Test Level | Notes |
|---------|-------------|------------|-------|
| **P3-001** | Globe snapshot load ≤5s with 10K entities | E2E (k6) | Performance benchmark — Growth target |
| **P3-002** | Explode animation completes within 2s | E2E | Measure animation duration |
| **P3-003** | Showcase/demo mode full capability loop | E2E | End-to-end: ontology → classify → signal → agent → dashboard → globe |
| **P3-004** | Website landing page loads | E2E | Marketing site basic smoke test |
| **P3-005** | Website onboarding entry point functional | E2E | Contact/demo form submission |
| **P3-006** | Vercel→Azure migration documentation review | Manual | Verify migration steps documented for government path |
| **P3-007** | 13 concurrent users with no degradation | E2E (k6) | Load test: 13 simultaneous sessions |
| **P3-008** | BMAD innovation engine proposal routing | API | Create solution brief → verify routing to reviewer |

**Total P3:** ~8 tests

---

## Execution Strategy

**Philosophy:** Run everything in PRs unless there's significant infrastructure overhead. Playwright with parallelization is extremely fast (100s of tests in ~10-15 min).

**Organized by TOOL TYPE:**

### Every PR: Vitest + Playwright Tests (~10-15 min)

**All functional tests** (from any priority level):
- All unit tests via Vitest (DomainEvent validation, Zod schemas, UUID format, store state, quality tier detection, GlobeQueryDirective, accessibility audits)
- All API + integration + E2E tests via Playwright (tenant isolation, auth, CRUD, SSE bridge, dashboard load, admin portal, governance)
- pytest for Python service unit tests (classification pipeline, Pydantic models, agent orchestration)
- Parallelized across 4 shards
- Total: ~80 Playwright/Vitest/pytest tests (includes P0, P1, P2, P3)

**Why run in PRs:** Fast feedback, no expensive infrastructure, catches regressions immediately

### Performance: k6 Tests (~30-60 min) — tagged `@perf`

**All performance tests** (from any priority level):
- P0-018: Email classification 5-second SLO (stress test variant)
- P0-019: Full pipeline 30-second SLO (under load)
- P1-025: 500 emails in 15 minutes (batch load test)
- P3-001: Globe snapshot with 10K entities
- P3-007: 13 concurrent users sustained load

**MVP execution:** Run manually before milestone demos (no nightly CI pipeline at 13 users). Tag `@perf` for selective execution: `npx playwright test --grep @perf`. Nightly CI pipeline added at Growth phase when infrastructure justifies the cost.

### Weekly: Manual & Long-Running

**Special tests requiring human intervention or extended runtime:**
- P3-003: Showcase mode full capability loop (manual walkthrough verification)
- P3-006: Migration documentation review (manual)
- Agent state recovery endurance (extended 2-hour run)

**Why defer to weekly:** Human-in-the-loop, very long-running, infrequent validation sufficient

---

## QA Effort Estimate

**QA test development effort only** (excludes DevOps, Backend, Data Eng work):

| Priority | Count | Effort Range | Notes |
|----------|-------|--------------|-------|
| P0 | ~30 | ~3-5 weeks | Complex setup (multi-tenant, NATS, privacy chain, audit, ingestion) |
| P1 | ~33 | ~2-4 weeks | Standard integration (agent workflows, search, dashboard, globe store) |
| P2 | ~22 | ~1-2 weeks | Edge cases, admin portal, accessibility, governance |
| P3 | ~8 | ~2-4 days | Exploratory, benchmarks, documentation |
| **Total** | **~93** | **~6-10 weeks** | **1 QA engineer, full-time** |

**Assumptions:**
- Includes test design, implementation, debugging, CI integration
- Excludes ongoing maintenance (~10% effort)
- Assumes test infrastructure (factories, fixtures, seeding API) ready from Sprint 0
- P0 effort is front-loaded due to tenant isolation and NATS infrastructure complexity

**Solo developer reality:** Devon writes both production code and tests. In practice, tests are written alongside feature implementation as ~30-50% overhead per story, not as a sequential QA phase. The 6-10 week estimate assumes dedicated QA time for comparison purposes.

**Dependencies from other teams:**
- See "Dependencies & Test Blockers" section for what QA needs from Backend and DevOps

---

## Appendix A: Code Examples & Tagging

**Playwright Tags for Selective Execution:**

```typescript
import { test, expect } from '@playwright/test';
import { faker } from '@faker-js/faker';
import { appRouter } from '@wisdomworks/api';

// P0 security: tenant isolation
// NOTE: Tenant ID comes from Auth.js session, NOT a custom header.
// Tests authenticate as tenant-scoped users to match production auth flow.
test('@P0 @SEC @API tenant A cannot read tenant B entities', async () => {
  // Seed via tRPC createCaller (server-side, bypasses HTTP)
  const tenantA = { id: `test-${faker.string.uuid()}`, name: 'Tenant A' };
  const tenantB = { id: `test-${faker.string.uuid()}`, name: 'Tenant B' };

  const callerA = appRouter.createCaller({
    tenantId: tenantA.id,
    requestId: faker.string.uuid(),
    userId: `user-a-${faker.string.uuid()}`,
  });

  const callerB = appRouter.createCaller({
    tenantId: tenantB.id,
    requestId: faker.string.uuid(),
    userId: `user-b-${faker.string.uuid()}`,
  });

  // Seed entity for tenant A
  await callerA.entities.create({
    id: `test-${faker.string.uuid()}`,
    entityTypeId: 'employee',
    displayName: faker.person.fullName(),
    metadata: {},
  });

  // Query as tenant B — should return empty (Auth.js session scopes to tenantB)
  const results = await callerB.entities.list({});
  expect(results).toHaveLength(0);
});

// P0 integration: NATS at-least-once delivery
test('@P0 @TECH @Integration NATS redelivers on consumer failure', async ({ request }) => {
  // Publish signal
  const signal = {
    id: `test-${faker.string.uuid()}`,
    type: 'signals.test-tenant.created',
    tenantId: 'test-tenant',
    timestamp: new Date().toISOString(),
    source: 'test',
    data: { entityId: faker.string.uuid() },
  };
  await request.post('/api/test/nats/publish', { data: { json: signal } });

  // Kill consumer (test harness endpoint)
  await request.post('/api/test/nats/kill-consumer', { data: { json: { stream: 'SIGNALS' } } });

  // Restart consumer
  await request.post('/api/test/nats/restart-consumer', { data: { json: { stream: 'SIGNALS' } } });

  // Verify redelivery
  const delivered = await request.get('/api/test/nats/delivered', {
    params: { signalId: signal.id },
  });
  const deliveryData = await delivered.json();

  expect(deliveryData.result.data.json.delivered).toBe(true);
  expect(deliveryData.result.data.json.deliveryCount).toBeGreaterThanOrEqual(2);
});

// P1 unit: GlobeQueryDirective state
test('@P1 @Unit GlobeQueryDirective applies highlights to store', () => {
  const { applyDirective, highlightSets } = useGlobeStore.getState().actions;

  const directive = {
    highlightSets: [
      { entityIds: ['entity-1', 'entity-2'], color: 'red' as const, pulse: true },
    ],
    dimMask: ['entity-3'],
    camera: null,
    annotations: [],
  };

  applyDirective(directive);

  const state = useGlobeStore.getState();
  expect(state.activeQuery).toEqual(directive);
});
```

**Run specific tags:**

```bash
# Run only P0 tests
npx playwright test --grep @P0

# Run P0 + P1 tests
npx playwright test --grep "@P0|@P1"

# Run only security tests
npx playwright test --grep @SEC

# Run only integration tests
npx playwright test --grep @Integration

# Run all tests in PR (default)
npx playwright test

# Run Python tests
pytest services/agents/tests/ -v
pytest services/ingestion/tests/ -v
```

---

## Appendix B: Test Level Distribution

| Test Level | Count | Percentage | Tools |
|------------|-------|------------|-------|
| API (Integration) | ~43 | 46% | Playwright API testing |
| Unit | ~20 | 22% | Vitest (TS), pytest (Python) |
| E2E | ~18 | 19% | Playwright browser |
| Integration (NATS/events) | ~9 | 10% | Playwright + NATS test harness |
| CI Gate | ~3 | 3% | Schema contract, TS↔Python type validation |
| Performance (k6) | ~5 | — | k6 (manual before milestones at MVP) |
| Manual | ~2 | — | Human review (weekly) |

---

## Appendix C: Knowledge Base References

- **Risk Governance**: `risk-governance.md` — Risk scoring methodology (Probability × Impact)
- **Test Priorities Matrix**: `test-priorities-matrix.md` — P0-P3 criteria and classification
- **Test Levels Framework**: `test-levels-framework.md` — E2E vs API vs Unit selection
- **Test Quality**: `test-quality.md` — Definition of Done (no hard waits, <300 lines, <1.5 min, parallel-safe)
- **ADR Quality Readiness**: `adr-quality-readiness-checklist.md` — 8-category 29-criteria NFR framework

---

**Generated by:** BMad TEA Agent
**Workflow:** `_bmad/bmm/testarch/test-design`
**Version:** 4.0 (BMad v6)

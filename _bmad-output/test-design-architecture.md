# Test Design for Architecture: WisdomWorks Platform

**Purpose:** Architectural concerns, testability gaps, and NFR requirements for review by Architecture/Dev teams. Serves as a contract between QA and Engineering on what must be addressed before test development begins.

**Date:** 2026-03-23
**Author:** TEA (Test Architect Agent)
**Status:** Architecture Review Pending
**Project:** WisdomWorks — Organizational Intelligence Platform
**PRD Reference:** `_bmad-output/planning-artifacts/prd.md`
**ADR Reference:** `_bmad-output/planning-artifacts/architecture.md`

---

## Executive Summary

**Scope:** System-level testability review of the WisdomWorks platform — a three-layer organizational intelligence system (Email Intelligence, Desktop Agent, Operations Console) with AI agent orchestration, 3D visualization, and government deployment path.

**Business Context** (from PRD):
- **Revenue/Impact:** Consulting firm operating on its own platform; MVP validates thesis before SaaS/government licensing
- **Problem:** Organizations lack unified AI mirroring of roles, knowledge flows, and decision patterns
- **GA Launch:** 90-day MVP with Devon as first customer (13 concurrent users)

**Architecture** (from ADR):
- **Stack:** TypeScript (80%) + Python (15%) + Rust (5%) polyglot monorepo
- **Data:** PostgreSQL 16 + Drizzle ORM, typed core tables + JSONB metadata, pgvector for semantic search
- **Events:** NATS JetStream (event backbone + KV cache), SSE bridge for browser real-time
- **API:** tRPC (TS↔TS) + REST/OpenAPI (TS↔Python)
- **Auth:** Auth.js v5 + Microsoft Entra ID, FIPS 140-2/140-3 encryption
- **Frontend:** Next.js App Router, React Three Fiber for 3D globe, Zustand + TanStack Query
- **Desktop:** Tauri v2 with WebGL quality tier fallback
- **Infra:** Vercel (web) + Azure Container Apps (services), GitHub Actions CI/CD

**Expected Scale** (from ADR):
- MVP: 13 concurrent users, single-instance
- Growth: 500+ users/instance, 10K+ entities, 1000+ emails/hour, 10K+ signals/day

**Risk Summary:**
- **Total risks**: 11
- **High-priority (score ≥6)**: 4 risks requiring immediate mitigation
- **Medium-priority (score 3-5)**: 5 risks requiring planning
- **Low-priority (score 1-2)**: 2 risks to monitor

---

## Quick Guide

### BLOCKERS - Team Must Decide (Can't Proceed Without)

**Sprint 0 Critical Path** — These MUST be completed before QA can write integration tests:

1. **B-001: Exchange Webhook Authorization** — Pre-MVP binary gate: confirm programmatic email access authorization pathway. If denied, Layer 1 (Email Intelligence) does not exist. This is not an assumption — it's a prerequisite for the entire email ingestion pipeline (recommended owner: Devon/Business)
2. **B-002: NATS JetStream Test Infrastructure** — Docker-compose test profile (`docker-compose.test.yml`) with isolated NATS instance, pre-configured streams/KV buckets, and event assertion helpers. Start here — this unblocks all downstream integration testing (recommended owner: Backend/DevOps)
3. **B-003: Schema Contract Testing Pipeline** — CI must validate Python Pydantic models against Drizzle-migrated PostgreSQL schema. Without this, Python↔TypeScript schema drift will cause silent data corruption in agent pipelines (recommended owner: DevOps/Backend)
4. **B-004: Test Data Seeding API** — tRPC router at `packages/api/src/routers/test-seed.ts`, gated behind `NODE_ENV=test` middleware. Accepts tenant configuration object, returns deterministic entity IDs, auto-cleans on teardown. Without this, tests cannot run in parallel or reset state (recommended owner: Backend)

**Recommended Sprint 0 priority order (solo dev):** B-001 (gate decision) → B-002 (NATS test profile) → B-003 (schema contract CI) → B-004 (seed API).

**What we need from team:** Complete these 4 items in Sprint 0 or test development is blocked.

---

### HIGH PRIORITY - Team Should Validate (We Provide Recommendation, You Approve)

1. **R-001: Tenant Isolation Enforcement** — Every database query and NATS subject must filter by `tenantId`. Recommend automated query analysis in CI to detect missing tenant filters (Sprint 0-1)
2. **R-002: WebGL Context in Tauri v2** — Early smoke test required: render 1000 entities in R3F inside Tauri v2 on Windows. If <30fps, quality tier fallback activates. Team should validate before globe epic begins (Sprint 1)
3. **R-004: Privacy Boundary Defense-in-Depth** — Classification + confidence scoring + monitoring/QA agent + 5-minute purge chain must be tested as an integrated system, not individual components. Recommend integration test harness for full privacy pipeline (Sprint 1-2)

**What we need from team:** Review recommendations and approve (or suggest changes).

---

### INFO ONLY - Solutions Provided (Review, No Decisions Needed)

1. **Test strategy**: 50/30/20 split (API integration / E2E / Unit) — API-heavy architecture benefits from integration-first testing
2. **Tooling**: Vitest (TS unit), pytest (Python unit), Playwright (E2E/API), k6 (performance)
3. **CI execution**: All Playwright tests in PRs (~10-15 min parallelized); k6 nightly; chaos/manual weekly
4. **Coverage**: ~85-110 test scenarios prioritized P0-P3 with risk-based classification
5. **Quality gates**: P0 100% pass, P1 ≥95% pass, all high-risk items mitigated

**What we need from team:** Just review and acknowledge.

---

## For Architects and Devs - Open Topics

### Risk Assessment

**Total risks identified**: 11 (4 high-priority score ≥6, 5 medium, 2 low)

#### High-Priority Risks (Score ≥6) - IMMEDIATE ATTENTION

| Risk ID | Category | Description | Prob | Impact | Score | Mitigation | Owner | Timeline |
|---------|----------|-------------|------|--------|-------|------------|-------|----------|
| **R-001** | **SEC** | Cross-tenant data leakage — missing `tenantId` filter in any query exposes client data | 2 | 3 | **6** | Automated query analysis + parametric tenant isolation tests | Backend | Sprint 0 |
| **R-003** | **DATA** | Python↔PostgreSQL schema drift — Pydantic models diverge from Drizzle schema silently | 3 | 3 | **9** | CI schema contract testing: Python models validated against migrated DB | DevOps | Sprint 0 |
| **R-005** | **SEC** | Privacy boundary failure — personal email content persists beyond classification cycle | 2 | 3 | **6** | Integration test: inject misclassified email → verify purge within 5 minutes | Backend/QA | Sprint 1 |
| **R-006** | **TECH** | NATS JetStream event loss — dropped signals break agent-to-agent communication chain | 2 | 3 | **6** | At-least-once delivery validation + dead letter queue monitoring + duplicate detection tests | Backend | Sprint 0-1 |

#### Medium-Priority Risks (Score 3-5)

| Risk ID | Category | Description | Prob | Impact | Score | Mitigation | Owner |
|---------|----------|-------------|------|--------|-------|------------|-------|
| R-002 | TECH | WebGL context failure in Tauri v2 WebView2 — 3D globe unusable on some Windows configs | 2 | 2 | 4 | Quality tier fallback (full→reduced→minimal); early smoke test | Frontend |
| R-004 | PERF | Email classification exceeds 5-second SLO under batch load | 2 | 2 | 4 | k6 load test: 500 emails in 15 minutes; pipeline instrumentation | Backend |
| R-007 | TECH | tRPC context missing `tenantId`/`requestId` — breaks audit trail and tenant isolation | 2 | 2 | 4 | Middleware test: verify every tRPC procedure receives context | Backend |
| R-008 | OPS | Docker-compose local dev — 5 concurrent processes fragile for solo developer | 2 | 2 | 4 | Health check scripts + process monitor; documented restart procedures | DevOps |
| R-009 | BUS | Ontology entity type extensibility — adding entity types without migration could break existing queries | 1 | 3 | 3 | Regression test: add new entity type → verify existing queries unaffected | Backend |

#### Low-Priority Risks (Score 1-2)

| Risk ID | Category | Description | Prob | Impact | Score | Action |
|---------|----------|-------------|------|--------|-------|--------|
| R-010 | PERF | 3D globe snapshot load exceeds 5-second target with 10K+ entities | 1 | 2 | 2 | Monitor; defer optimization to Growth |
| R-011 | OPS | Vercel→Azure migration path untested for government deployment | 1 | 2 | 2 | Document migration steps; validate in Growth phase |

#### Risk Category Legend

- **TECH**: Technical/Architecture (flaws, integration, scalability)
- **SEC**: Security (access controls, auth, data exposure)
- **PERF**: Performance (SLA violations, degradation, resource limits)
- **DATA**: Data Integrity (loss, corruption, inconsistency)
- **BUS**: Business Impact (UX harm, logic errors, revenue)
- **OPS**: Operations (deployment, config, monitoring)

---

### Testability Concerns and Architectural Gaps

**ACTIONABLE CONCERNS - Architecture Team Must Address**

#### 1. Blockers to Fast Feedback (WHAT WE NEED FROM ARCHITECTURE)

| Concern | Impact | What Architecture Must Provide | Owner | Timeline |
|---------|--------|-------------------------------|-------|----------|
| **No test data seeding API** | Cannot create test tenants, entities, agents in parallel-safe manner | tRPC router at `packages/api/src/routers/test-seed.ts`, gated behind `NODE_ENV=test` middleware. Accepts `{ tenantId, entities, agents }`, returns deterministic IDs, auto-cleans on teardown | Backend | Sprint 0 |
| **No schema contract validation** | Python services silently break when Drizzle schema changes | CI job: migrate fresh DB → run Python Pydantic model validation → fail build on mismatch | DevOps | Sprint 0 |
| **NATS not testable in isolation** | Event-driven flows (signal creation → agent notification → dashboard update) cannot be verified | Docker-compose test profile with isolated NATS, pre-configured streams/KV, event assertion helpers | Backend | Sprint 0 |
| **No tenant isolation verification** | Missing `tenantId` filter causes cross-client data leakage | Parametric test suite (primary enforcement) + code review checklist item. Tests are the enforcement mechanism — custom Drizzle ESLint rules are non-trivial and not worth the Sprint 0 investment | Backend | Sprint 0 |

#### 2. Architectural Improvements Needed (WHAT SHOULD BE CHANGED)

1. **Audit log completeness validation**
   - **Current problem**: Architecture specifies 100% audit coverage (NIST AU) but no mechanism to detect missing audit entries
   - **Required change**: Audit decorator/middleware that automatically logs every tRPC procedure call and NATS event consumption; CI test validates no unaudited code paths exist
   - **Impact if not fixed**: Government compliance failure; audit gaps discovered during FedRAMP assessment
   - **Owner**: Backend
   - **Timeline**: Sprint 1

2. **Governance rule enforcement testing**
   - **Current problem**: Runtime governance rules (allow/deny per action category) lack testability hooks
   - **Required change**: Governance engine must expose evaluation result (decision + rule matched + reason) for assertion, not just block/allow behavior
   - **Impact if not fixed**: Cannot verify governance rules are correctly evaluated; false allows go undetected
   - **Owner**: Backend
   - **Timeline**: Sprint 1-2

3. **Agent state recovery verification**
   - **Current problem**: Agent state persistence requires recovery within 2 minutes with zero signal loss, but no crash injection mechanism exists
   - **Required change**: Test harness to simulate agent process crash → verify state recovery + signal replay from NATS JetStream
   - **Impact if not fixed**: Cannot validate 2-minute recovery SLA; state corruption undetected until production
   - **Owner**: Backend
   - **Timeline**: Sprint 2

---

### Testability Assessment Summary

**CURRENT STATE - FYI**

#### What Works Well

- API-first design (tRPC + REST/OpenAPI) supports parallel test execution and contract validation
- Drizzle ORM with typed schemas enables compile-time query validation and migration-based state management
- NATS JetStream provides replay-capable event streams — deterministic event ordering for test assertions
- Zustand stores are pure functions — unit testable without React rendering
- Feature-based project structure enables test isolation per domain
- Auth.js v5 with configurable providers supports test auth bypass without compromising production security
- DomainEvent<T> wrapper standardizes all event payloads — single assertion pattern for all NATS events
- CacheProvider interface enables mock caching in tests without NATS KV dependency
- Co-located test pattern (`Component.test.tsx` next to `Component.tsx`) maintains test proximity to source

#### Accepted Trade-offs (No Action Required)

For WisdomWorks MVP, the following trade-offs are acceptable:
- **Pre-computed 3D snapshots instead of real-time streaming** — Simplifies globe testing to static data validation; real-time deferred to Growth
- **NATS KV instead of Redis for caching** — Lower test infrastructure complexity; CacheProvider interface allows swap without test changes
- **Single PostgreSQL instance** — No replication lag testing needed at MVP; Growth adds read replicas
- **Offline sync detailed design deferred** — PowerSync/ElectricSQL conflict resolution strategy tested at Layer 2 desktop epic

---

### Risk Mitigation Plans (High-Priority Risks ≥6)

#### R-001: Cross-Tenant Data Leakage (Score: 6) - SECURITY CRITICAL

**Mitigation Strategy:**
1. Create parametric test suite: for each tenant-scoped table, verify query returns ONLY matching tenant data when two tenants exist
2. Code review checklist item for tenant-scoped queries (parametric tests are primary enforcement; custom Drizzle ESLint rules are non-trivial)
3. NATS subject authorization: verify tenant A cannot subscribe to tenant B's subjects

**Owner:** Backend
**Timeline:** Sprint 0
**Status:** Planned
**Verification:** Parametric tests pass for all tenant-scoped tables; CI rule blocks PRs missing tenant filters

#### R-003: Python↔PostgreSQL Schema Drift (Score: 9) - CRITICAL

**Mitigation Strategy:**
1. CI pipeline step: run Drizzle migrations on fresh PostgreSQL → introspect schema
2. Validate every Python Pydantic model field exists in corresponding table with matching types
3. Fail build immediately on any mismatch (zero tolerance)
4. Generate compatibility report showing field-by-field comparison

**Owner:** DevOps
**Timeline:** Sprint 0 (must be in place before any Python service development)
**Status:** Planned
**Verification:** CI pipeline blocks any PR where Python models diverge from Drizzle schema

#### R-005: Privacy Boundary Failure (Score: 6) - SECURITY CRITICAL

**Mitigation Strategy:**
1. Integration test: inject email classified as "personal" → verify it never enters business data layer
2. Integration test: inject misclassified email → trigger reclassification → verify purge within 5 minutes
3. Monthly audit script: scan all data stores for personal email content persistence
4. Defense-in-depth validation: test each layer independently (classifier, confidence scorer, monitoring/QA agent, purge mechanism) AND as integrated chain

**Owner:** Backend/QA
**Timeline:** Sprint 1-2
**Status:** Planned
**Verification:** Zero personal email content found in business data stores after classification cycle; purge completes within 5-minute SLA

#### R-006: NATS JetStream Event Loss (Score: 6) - RELIABILITY CRITICAL

**Mitigation Strategy:**
1. At-least-once delivery test: publish signal → kill consumer mid-processing → restart → verify signal redelivered
2. Duplicate detection test: verify `DomainEvent.id` (UUID v7) prevents duplicate processing
3. Dead letter queue test: publish malformed event → verify it routes to DLQ after 3 retry attempts
4. Ordering test: publish 100 sequential signals → verify consumer receives in order

**Owner:** Backend
**Timeline:** Sprint 0-1
**Status:** Planned
**Verification:** Zero signal loss under consumer failure; duplicates detected and deduplicated; DLQ captures all unprocessable events

---

### Assumptions and Dependencies

#### Assumptions

1. Azure Database for PostgreSQL Flexible Server provides FIPS-validated encryption at rest (Azure documentation confirms)
3. Tauri v2 WebView2 on Windows supports WebGL 2.0 sufficient for R3F rendering at 30fps+ with 1000 entities
4. NATS JetStream on Azure Container Apps consumption plan handles MVP signal volume (13 users, ~1000 signals/day)
5. Auth.js v5 Entra ID integration supports test mode with mock tokens for CI environments

#### Dependencies

1. **Azure Container Apps setup** — Required by Sprint 1 for NATS JetStream and Python service deployment
2. **Docker-compose test profile** — Required by Sprint 0 for local integration testing

#### Risks to Plan

- **Risk**: Exchange webhook access denied or delayed
  - **Impact**: Layer 1 (Email Intelligence) cannot be tested end-to-end
  - **Contingency**: Mock email ingestion via test harness; defer Exchange integration testing to post-authorization

- **Risk**: WebGL fails in Tauri v2 on target hardware
  - **Impact**: Globe visualization tests require fallback to reduced/minimal quality tiers
  - **Contingency**: Quality tier system designed for this; test at each tier level independently

---

**End of Architecture Document**

**Next Steps for Architecture Team:**
1. Review Quick Guide (BLOCKERS / HIGH PRIORITY / INFO ONLY) and prioritize blockers
2. Assign owners and timelines for high-priority risks (≥6)
3. Validate assumptions and dependencies
4. Provide feedback to QA on testability gaps

**Next Steps for QA Team:**
1. Wait for Sprint 0 blockers to be resolved
2. Refer to companion QA doc (test-design-qa.md) for test scenarios
3. Begin test infrastructure setup (factories, fixtures, environments)

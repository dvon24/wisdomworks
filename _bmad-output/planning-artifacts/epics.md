---
stepsCompleted: [1, 2, 3, 4]
workflowStatus: complete
inputDocuments:
  - _bmad-output/planning-artifacts/prd.md
  - _bmad-output/planning-artifacts/architecture.md
  - _bmad-output/planning-artifacts/ux-design-specification.md
  - _bmad-output/test-design-architecture.md
  - _bmad-output/test-design-qa.md
  - _bmad-output/planning-artifacts/cost-projection.md
---

# WisdomWorks - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for WisdomWorks, decomposing the requirements from the PRD, UX Design, Architecture, and Test Design documents into implementable stories.

## Requirements Inventory

### Functional Requirements

**Layer 1: Email Intelligence & Organizational Knowledge (37 FRs)**

- FR1: Employee agents can classify incoming emails as business, personal, or uncertain
- FR2: Employee agents can filter personal correspondence from entering the business signal layer
- FR3: Employee agents can assign confidence scores to each email classification
- FR4: Employee agents can hold uncertain classifications and surface them in the user's morning briefing for clarification
- FR5: Employee agents can learn from user corrections to improve classification accuracy over time
- FR6: A monitoring/QA agent team can detect systemic classification patterns (misclassification trends, edge cases)
- FR7: The platform can purge extracted data when an email is reclassified (e.g., business to personal)
- FR21: Agents can communicate with other agents via structured metadata signals (never raw email content)
- FR22: Agents can coordinate cross-agent tasks (report collection, information requests, task handoffs, deadline management)
- FR23: Agents can fall back to drafting email for user review when a counterpart agent doesn't exist
- FR24: Agents can discover cross-agent connections (people, capabilities, solutions) that users didn't know existed
- FR25: Agents can require user consent before executing any cross-agent action
- FR26: Agents in authorized deployment environments at the same security classification level can communicate via signals
- FR27: The platform can enforce signal routing governance rules defining which signal types can cross between environments
- FR28: The Axis team can construct an enterprise ontology from organizational data sources (AD/GAL, Workday, policies)
- FR29: Axis agents can cross-validate each other's ontology work (peer-review)
- FR30: A data engineer can review and approve the completed ontology before agent deployment
- FR31: The ontology can be extended and refined post-deployment without disrupting active agents
- FR32: The ontology can represent employees, roles, contracts, projects, clients, capabilities, risks, decisions, tasks, and innovations with referential integrity
- FR33: Employee agents can parse and extract structured data from emails (dates, deadlines, budget figures, project references, personnel, milestones, action items)
- FR34: A data relationship workflow can map extracted email data to existing ontology entities
- FR35: Dashboards can display ontology-mapped data extracted from the email stream
- FR36: The data relationship workflow can identify new entities or relationships not yet in the ontology and flag them for Axis team review
- FR51: The platform can integrate with directory services (Active Directory, LDAP, cloud identity providers)
- FR52: The platform can integrate with HR management systems for organizational hierarchy, roles, and program tracking
- FR53: The platform can integrate with project management and financial systems for timecard tracking and budget data
- FR54: The platform can integrate with email platforms (Exchange, M365, Gmail) for email processing
- FR55: The platform can integrate with organizational policy and knowledge repositories
- FR56: The platform can integrate with document management and collaboration platforms
- FR57: The Axis team can discover which integrations exist per deployment and configure accordingly
- FR58: Every agent can activate structured ideation capabilities (BMAD methodology)
- FR59: Solution briefs can be routed to designated reviewers for feasibility review
- FR60: The platform can track innovation proposals across the organization
- FR61: Agents can surface cross-agent solution discovery
- FR91: The Axis team can produce an organizational deployment specification
- FR92: The Axis team can evaluate and recommend interaction channels per role category
- FR93: The Axis team can document the organization's mission, purpose, tool inventory, and operational patterns

**Layer 2: Desktop Agent & Productivity Assistant (54 FRs)**

- FR8: Each employee can receive a personal AI agent that mirrors their organizational role
- FR9: Employee agents can generate a morning briefing summarizing actionable items
- FR10: Employee agents can draft email responses for user review and approval
- FR11: Employee agents can correct grammar in user-composed content
- FR12: Employee agents can propose monthly report bullets based on email activity and completed tasks
- FR13: Employee agents can carry forward incomplete tasks across sessions
- FR14: Employee agents can provide calendar awareness (conflict detection, scheduling suggestions)
- FR15: Employee agents can answer company policy questions from an ingested knowledge base
- FR16: Employee agents can prevent mistakes by flagging potential errors
- FR17: Employee agents can support career development by surfacing relevant opportunities
- FR18: Users can name their personal agent
- FR19: Employee agents can deliver time-sensitive notifications for urgent items
- FR20: Users can interact with their personal agent
- FR45: Agents can generate PowerPoint presentations matching organizational formats
- FR46: Agents can generate Excel spreadsheets with budget data, burn rates, and projections
- FR47: Agents can generate Word documents for reports
- FR48: Agents can generate PDF documents for distribution
- FR49: Agents can collect and assemble monthly reports from team member agents
- FR50: Budget-responsible agents can aggregate budget data from multiple project agents
- FR62: Agents can execute defined workflows (email processing, report generation, deadline management)
- FR63: Agents can build and execute custom workflows for organizational processes
- FR64: Agents can leverage other users' agents for routing and cross-functional collaboration
- FR65: Agents can send timecard reminders and track submission status
- FR66: Agents can track travel authorizations and surface travel-related information
- FR67: Agents can adapt to software upgrades without rebuilding agent architecture
- FR87: Employee agents can learn and track their user's daily schedule patterns
- FR88: Employee agents can report on accountability metrics
- FR94-FR101: Interaction channel framework (email, desktop chat, terminal) with unified logging
- FR102: Employee agents can ingest the user's resume or professional profile
- FR103: Employee agents can learn user passively through email patterns and work habits
- FR104-FR113: Desktop agent runtime (local install, terminal control, Outlook embed, app control, permissions, persistent connection)
- FR114-FR121: Remote agent command (external email auth, command parsing, execution, scope limits)
- FR122-FR128: Passive agent mode (observation, suggestions, frequency control, feedback loop)
- FR129-FR135: Agent state persistence (cross-session, recovery, versioning, sync to cloud)
- FR164-FR166: Agent derivation from ontology (role mapping, founder orchestration, any-org bootstrapping)

**Layer 3: Operations Console & Admin (33 FRs)**

- FR37-FR44: Dashboards & Visualization (all-access views, 3D globe, explode animations, historical trends)
- FR68-FR75: Platform administration (BMAD-driven updates, model swaps, ontology extension, agent lifecycle)
- FR76-FR80: Compliance & security (privacy filtering, audit logging, government cloud, Section 508, FIPS encryption)
- FR81-FR84: Multi-instance deployment (isolation, cross-instance email, canonical identity, per-environment ontology)
- FR85: Showcase/demonstration mode
- FR89-FR90: Error handling & recovery (extraction failures, cross-agent communication failures)
- FR136-FR146: Admin portal (environment overview, Axis progress, ontology inspection, agent health, data flow viz, alerts, export)
- FR147-FR149: Public website (product info, onboarding entry points, pricing display)
- FR150-FR153: Agent deployment model (authorization, provisioning workflow, approval chain, deployment tracking)
- FR154-FR163: Agent governance framework (allow/deny rules, runtime enforcement, per-instance config, violation handling, audit trail, hot-update)
- FR167-FR170: Consulting engagement management (client isolation, lifecycle tracking, autonomy boundaries, escalation)

### Non-Functional Requirements

**Performance (NFR1-NFR11)**

- NFR1: Email classification within 5 seconds; full pipeline within 30 seconds
- NFR2: Batch 500 emails within 15 minutes
- NFR3: Morning briefing within 5 minutes of configured time
- NFR4: Dashboard load within 3 seconds (standard) / 5 seconds (complex)
- NFR5: 95%+ dashboard data accuracy within 30 days
- NFR6: 3D globe load within 5 seconds; explode animations within 2 seconds
- NFR7: Artifact generation within 2 minutes
- NFR8: Agent-to-agent signal delivery within 60 seconds
- NFR9: 90% classification accuracy at 30 days, 95%+ at 90 days
- NFR10: Showcase mode performs at or better than standard targets
- NFR11: 13 concurrent users with no performance degradation

**Security (NFR12-NFR19)**

- NFR12: FIPS 140-2/140-3 encryption at rest and in transit
- NFR13: Privacy boundary defense-in-depth SLA — no personal content persists beyond one classification cycle; misclassifications purged within 5 minutes
- NFR14: 100% audit coverage of all agent actions and signal processing
- NFR15: RBAC with least-privilege enforcement
- NFR16: NIST SP 800-53 IA control family alignment (session security)
- NFR17: Data minimization — only business-relevant signal metadata stored
- NFR18: No plaintext credentials; secure vault with rotation
- NFR19: Zero cross-client data visibility

**Scalability (NFR20-NFR26)**

- NFR20: PoC validates full capability loop (1 user)
- NFR21: MVP instance — 13 users, all targets met
- NFR22: Growth architecture — 500+ users without re-architecture
- NFR23: Multi-instance independence — no cross-instance performance impact
- NFR24: Ontology capacity — 10,000+ entities with referential integrity
- NFR25: Email throughput — 1,000+ emails/hour per instance (Growth)
- NFR26: Signal throughput — 10,000+ signals/day per instance (Growth)

**Accessibility (NFR27-NFR32)**

- NFR27: WCAG 2.1 AA and Section 508 compliance
- NFR28: 3D visualization accessible alternatives (tabular data, text descriptions)
- NFR29: Full keyboard navigation for all interfaces
- NFR30: Screen reader compatibility (NVDA, VoiceOver)
- NFR31: Sufficient color contrast ratios (4.5:1 normal, 3:1 large text)
- NFR32: Responsive design — 1280px+ width; mobile deferred to Growth

**Reliability (NFR33-NFR39)**

- NFR33: 99.5% monthly uptime (MVP); 99.9% at Growth
- NFR34: Agent self-monitoring; unhealthy agents restart within 2 minutes
- NFR35: At-least-once signal delivery; duplicate detection
- NFR36: Atomic ontology writes; eventual consistency for signal propagation
- NFR37: 3-tier graceful degradation (Core → Reduced → Minimal)
- NFR38: Zero data loss for ontology, signals, agent state
- NFR39: Daily backup; point-in-time recovery within 24 hours

**Integration (NFR40-NFR44)**

- NFR40: Near-real-time email event processing (<1 min intervals)
- NFR41: Directory/HR sync daily minimum; delta sync within 4 hours
- NFR42: Financial/project management daily sync; manual refresh capability
- NFR43: Webhook/API resilience with exponential backoff
- NFR44: MVP showcase requires only email platform + website hosting

### Additional Requirements

**Architecture — Starter Template (CRITICAL: Epic 1, Story 1)**

- Turborepo Monorepo with Polyglot Services — initialization command: `pnpm dlx create-turbo@latest wisdomworks`
- 7-step initialization sequence: Turborepo → Next.js → shadcn/ui → Tauri → Drizzle/PostgreSQL → Python/LangGraph → Docker Compose
- Architecture explicitly states: "Project initialization using these commands should be the first implementation story"
- First story must also establish ESLint, Prettier, TypeScript strict mode configurations

**Architecture — Monorepo Structure**

- `apps/web` — Next.js App Router (Operations Console, dashboards, globe)
- `apps/desktop` — Tauri v2 (Desktop Agent Runtime)
- `apps/website` — Next.js (public marketing site)
- `packages/api` — tRPC router
- `packages/db` — Drizzle ORM schema + migrations
- `packages/auth` — Auth.js v5 + Entra ID
- `packages/shared` — Shared types, constants, utilities
- `packages/ui` — Shared React component library (shadcn/ui)
- `packages/globe` — Globe renderer library (R3F/Three.js)
- `services/agents` — Python LangGraph agent orchestration
- `services/signal-layer` — NATS JetStream config + consumers
- `services/ingestion` — Generalized ingestion pipeline
- Boundary rules: packages never import apps/services; apps import packages only; services communicate via REST/NATS only
- Incremental creation: directories created as stories demand

**Architecture — Database (18 tables)**

- Typed core tables + JSONB metadata approach
- Tables: entities, entity_types, relationships, relationship_types, signals, signal_types, agent_instances, agent_configs, governance_rules, governance_evaluations, audit_logs, users, sessions, accounts, usage_events, billing_records, tenants, tenant_configs
- UUID v7 for all IDs; ISO 8601 for all dates
- GIN index on JSONB metadata; HNSW index on pgvector embeddings
- Zod schema validation per entity type at write time

**Architecture — Event System (NATS JetStream)**

- Event naming: `{domain}.{tenant_id}.{action}` (dot-separated, lowercase)
- DomainEvent<T> wrapper with id, type, tenantId, timestamp, source, data, metadata
- Dead letter queue with exponential backoff (max 3 attempts)
- At-least-once delivery; duplicate detection via DomainEvent.id
- SSE bridge endpoint for browser real-time updates
- CacheProvider interface for NATS KV (swappable to Redis at Growth)

**Architecture — API Patterns**

- tRPC v11+ for TypeScript-to-TypeScript (frontend ↔ API)
- REST/OpenAPI for TypeScript-to-Python (API ↔ agent services)
- Python Pydantic models as source of truth; Claude Code maintains TypeScript types in `packages/shared/src/generated/agent-api.ts`
- JSON conventions: camelCase in TypeScript, snake_case in Python (FastAPI alias_generator handles conversion)
- tRPC context must extract tenantId from Auth.js session + generate requestId (UUID v7)

**Architecture — CI/CD**

- GitHub Actions + Turborepo: PR check, deploy web (Vercel), deploy services (Azure Container Apps)
- Schema contract test in CI: Python Pydantic models validated against Drizzle-migrated schema
- Python services wrapped with package.json for Turborepo integration

**Architecture — 10 Mandatory Enforcement Rules**

1. Follow naming conventions exactly (snake_case DB, camelCase TS, PascalCase components, dot.separated NATS)
2. Co-locate tests with source files
3. Use Zod schemas for all API boundary validation
4. Return TRPCError for tRPC errors, never raw throw
5. Use UUID v7 for all IDs
6. Use ISO 8601 for all date serialization
7. Wrap NATS events in DomainEvent<T> structure
8. Use TanStack Query for server state
9. Use feature-based organization in apps, type-based in packages
10. Propagate tenantId and requestId through all service boundaries

**UX Design — Key Implementation Requirements**

- Globe-centric Command Deck layout (globe center-left, 380px collapsible sidebar, satellite controls)
- Unified conversational stream (briefing + chat + queries + governance in one flow)
- Neumorphic + glassmorphic design system with WisdomWorks design tokens
- Connected/Fractured toggle with timed animations (2-3s connected→fractured, 1.5s reverse)
- Exploded semantic zoom (6 depth levels L0-L5)
- 7 connection type visualizations with particle flow
- Quality tier system (full/reduced/minimal) with GPU detection
- Desktop-first responsive design (5 breakpoints from 1440px+ to <768px)
- WCAG 2.1 AA: keyboard navigation, screen reader support, prefers-reduced-motion, high contrast
- No spinning loaders — skeleton/shimmer only
- Maximum ONE primary action per surface; destructive actions require confirmation
- Phase 1 (MVP) components: GlobeCanvas, ConversationalStream, BriefingCard, satellite controls, connected/fractured toggle, admin components, query visualization

**Test Design — Sprint 0 Blockers (Must Become Stories)**

- B-001: Exchange Webhook Authorization — binary gate for Layer 1
- B-002: NATS JetStream Test Infrastructure — docker-compose.test.yml with isolated NATS
- B-003: Schema Contract Testing CI Pipeline — Python Pydantic vs Drizzle validation
- B-004: Test Data Seeding API — tRPC router at packages/api/src/routers/test-seed.ts

**Test Design — High-Priority Risks Informing AC**

- R-001 (Score 6): Cross-tenant data leakage — parametric isolation tests required
- R-003 (Score 9): Python↔PostgreSQL schema drift — CI build gate
- R-005 (Score 6): Privacy boundary failure — defense-in-depth integration test
- R-006 (Score 6): NATS event loss — at-least-once delivery + DLQ + duplicate detection tests

**Test Design — Quality Gates**

- P0 tests: 100% pass required for PR merge
- P1 tests: ≥95% pass required
- High-risk stories must have linked mitigation tests
- Tenant isolation: every query verified for tenantId filter
- Schema contract: CI must pass on every PR
- Audit coverage: all actions/events logged

### FR Coverage Map

#### Epic 0: Repository, Dev Pipeline & Platform Foundation
- **Architecture:** Turborepo monorepo, 18+ DB tables (Drizzle ORM, pgvector), Auth.js v5 + Entra ID, NATS JetStream, Docker Compose, CI/CD (GitHub Actions), Model Abstraction Layer, AxisDeploymentSpec schema
- **FRs:** FR51 (directory services integration), FR76-FR80 (compliance/security foundations), FR81-FR84 (multi-instance isolation)
- **NFRs:** NFR12-NFR19 (security), NFR20 (PoC validation), NFR27-NFR32 (accessibility foundations), NFR40-NFR44 (integration foundations)
- **Test Design:** B-002 (NATS test infra), B-003 (schema contract CI), B-004 (test data seeding API)

#### Epic 1: AI Onboarding & Axis Intelligence Engine
- **FRs:** FR28-FR32 (ontology construction, cross-validation, approval, extension, entity model), FR57 (Axis integration discovery), FR91-FR93 (deployment spec, channel evaluation, org documentation), FR164-FR166 (agent derivation from ontology)
- **NFRs:** NFR24 (ontology capacity 10K+ entities), NFR36 (atomic ontology writes)
- **New:** AI conversational onboarding, AxisDeploymentSpec generation, industry templates (Professional Services + Small Business), automated agent provisioning, per-agent model routing + benchmark harness

#### Epic 2a: Agent Runtime & Core Intelligence
- **FRs:** FR1-FR7 (email classification, filtering, confidence, uncertain hold, learning, QA, purge), FR8-FR20 (personal agent, briefing, drafting, grammar, reports, tasks, calendar, knowledge, errors, career, naming, notifications, interaction), FR21-FR27 (agent communication, coordination, fallback, discovery, consent, authorized signals, governance), FR33-FR36 (data extraction, relationship mapping, dashboards, new entity flagging), FR48 (PDF generation), FR54 (email platform integration), FR58-FR61 (BMAD innovation engine), FR62-FR63 (workflow execution), FR87-FR88 (schedule learning, accountability), FR102-FR103 (resume ingestion, passive learning), FR129-FR135 (agent state persistence)
- **NFRs:** NFR1-NFR11 (performance), NFR33-NFR35 (reliability), NFR37-NFR39 (degradation, data integrity, backup)
- **Test Design:** B-001 (Exchange webhook), R-001 (cross-tenant isolation), R-005 (privacy boundary), R-006 (NATS event delivery)

#### Epic 2b: Client Intelligence & Communication Channels
- **New capabilities beyond original PRD FRs:** client profiles, visual intelligence, business insights, WhatsApp/SMS/calendar integration, voice AI

#### Epic 3: Operations Console & Intelligence Dashboard
- **FRs:** FR37-FR44 (dashboards, visualization, trends), FR68-FR75 (platform admin, model swaps, ontology extension, agent lifecycle), FR85 (showcase = product working), FR89-FR90 (error handling/recovery), FR136-FR146 (admin portal), FR147-FR149 (public website + onboarding entry), FR150-FR153 (agent deployment model), FR154-FR163 (governance framework), FR167-FR170 (consulting engagement management)
- **NFRs:** NFR4-NFR6 (dashboard performance), NFR14 (audit coverage), NFR15-NFR16 (RBAC, session security)

#### Epic 4: 3D Intelligence Globe
- **FRs:** FR37-FR38 (3D globe visualization), FR39-FR41 (explode animations — basic only at MVP)
- **NFRs:** NFR6 (globe load within 5 seconds), NFR28 (accessible alternatives)
- **UX:** Globe-centric Command Deck, connected/fractured toggle, quality tier system, basic query visualization

#### Epic 5: Desktop Agent & Tauri Shell
- **FRs:** FR94-FR101 (interaction channels — desktop chat + terminal only at MVP), FR104-FR113 (desktop agent runtime — Tauri shell + basic features only at MVP)
- **NFRs:** NFR29-NFR30 (keyboard navigation, screen reader)

#### Deferred to Growth
- FR45-FR47 (PPT, Excel, Word generation)
- FR49-FR50 (report collection, budget aggregation)
- FR52-FR53 (HR system integration, financial/PM system integration — MVP discovers integrations via Story 1.13, adapters built at Growth)
- FR55-FR56 (policy repos, document management)
- FR64-FR67 (cross-user routing, timecards, travel)
- FR114-FR121 (remote agent command)
- FR122-FR128 (passive agent mode)
- Website generation (agent builds client websites)
- Mobile app (native)
- Social media posting
- 3D print job integration
- Dynamic pricing engine (auto-calculated)
- Automated model fitness evaluation pipeline
- Full semantic zoom (L4-L5), particle-flow connections
- Outlook integration, app control, remote commands
- Multilingual voice AI

## Epic List

### Epic 0: Repository, Dev Pipeline & Platform Foundation (Sprint 0)
Developers can build, test, and deploy the platform. Auth, tenant isolation, and multi-model AI abstraction are operational. AxisDeploymentSpec schema ready for AI onboarding.
- Monorepo initialization (Turborepo + pnpm)
- Database schema (18+ tables, Drizzle ORM, pgvector)
- Auth.js v5 + Entra ID + tenant isolation
- NATS JetStream + Docker Compose
- CI/CD (GitHub Actions + Turborepo)
- Sprint 0 test infrastructure (B-002, B-003, B-004)
- Model Abstraction Layer (Vercel AI SDK + LangGraph, 2 providers: Anthropic + OpenAI)
- Basic governance foundations (audit logging, allow/deny rules)
- AxisDeploymentSpec schema in `tenant_configs`
**FRs covered:** FR51, FR76-FR84

### Epic 1: AI Onboarding & Axis Intelligence Engine (Sprint 1)
A business owner describes their needs in natural language → AI builds their AxisDeploymentSpec → ontology constructed → agents derived and deployed automatically. Two industry templates and organizational blueprints guide the Axis team. Customer sees a demo preview, pays security deposit, then agents deploy.
- Conversational AI onboarding flow (natural language → structured data)
- AxisDeploymentSpec generation from conversation
- Organizational blueprint library (Solo, Small Team, Mid-Size, Enterprise, Air-Gapped)
- Industry template scaffolding (Professional Services + Small Business)
- Blueprint × Template → AxisDeploymentSpec derivation
- Axis team workflow: Understand → Derive → Determine → Evaluate → Connect → Deploy → Monitor
- Demo preview generation (agent roster + signal topology + cost estimate shown to customer)
- Security deposit collection + minimum trial agreement (30-60 days)
- Ontology construction from onboarding data (entities, relationships, Zod validation)
- Per-agent model routing config + basic benchmark harness (50 test cases per role category)
- Automated agent provisioning from AxisDeploymentSpec
**FRs covered:** FR28-FR32, FR57, FR91-FR93, FR164-FR166

### Epic 2a: Agent Runtime & Core Intelligence (Sprint 2)
Deployed agents actually run, communicate, process email, and improve the business — autonomously. Progressive autonomy with governance rules per agent per action.
- Agent execution engine (LangGraph orchestration)
- Agent-to-agent communication via structured signals (NATS)
- Privacy boundary (email classification + purge within 5 minutes)
- Email ingestion pipeline (Exchange webhook — B-001 gate)
- Personal agent creation (role-derived from ontology)
- Morning briefing generation
- Email drafting + grammar correction
- Task management + basic calendar awareness
- Knowledge base queries
- Agent state persistence + cloud sync
- BMAD innovation engine (signal monitoring → solution briefs)
- Progressive autonomy framework (governance rules per agent per action)
- PDF artifact generation
**FRs covered:** FR1-FR7, FR8-FR20, FR21-FR27, FR33-FR36, FR48, FR54, FR58-FR63, FR87-FR88, FR102-FR103, FR129-FR135

### Epic 2b: Client Intelligence & Communication Channels (Sprint 2-3)
Agents interact with business owners via mobile (WhatsApp, SMS, calendar, voice), build client profiles with visual intelligence, and generate actionable business insights.
- Client profiles & visual intelligence
- Business intelligence & actionable insights
- Mobile device integration & messaging channels (WhatsApp, SMS, calendar)
- Telephony integration & inbound call routing
- Voice appointment scheduling
- Voice personality & client recognition
**New capabilities beyond original PRD FRs:** client profiles, visual intelligence, business insights, WhatsApp/SMS/calendar integration, voice AI.

### Epic 3: Operations Console & Intelligence Dashboard (Sprint 3)
Devon (and future customers) can monitor, manage, and demonstrate the entire platform. New customers onboard through the public website. Showcase = the product onboarding itself.
- Admin portal (environment overview, agent health, data flow visualization)
- Dashboard views (individual, team, enterprise)
- Agent lifecycle management (deploy, pause, restart, update)
- Tenant management + deployment tracking
- Real-time agent activity feed
- BMAD solution brief review interface
- Governance framework UI (allow/deny rules, violation handling, audit trail)
- Public website (product info, AI onboarding entry point)
- Consulting engagement management
**FRs covered:** FR37-FR44, FR68-FR75, FR85, FR89-FR90, FR136-FR149, FR150-FR163, FR167-FR170

### Epic 4: 3D Intelligence Globe (Sprint 3-4)
Organizational intelligence explored through interactive 3D visualization. Minimal viable globe with connected/fractured toggle.
- Globe-centric Command Deck layout (R3F/Three.js)
- Entity nodes + connection lines + basic zoom (L0-L3)
- Connected/fractured toggle with simplified animation
- Quality tier system (full/reduced/minimal based on GPU detection)
- Basic query visualization (AI-driven globe state)
- Accessible alternatives (tabular data, text descriptions)
**FRs covered:** FR37-FR41 (visualization subset)
**Deferred:** Full semantic zoom (L4-L5), 7 particle-flow connection types, saved lenses

### Epic 5: Desktop Agent & Tauri Shell (Sprint 4)
The AI agent lives on the desktop. Basic Tauri shell with chat and terminal channels.
- Tauri v2 app shell rendering web app
- Desktop chat window
- Basic terminal channel
- Agent interaction across channels (unified logging)
**FRs covered:** FR94-FR101 (subset), FR104-FR113 (subset)
**Deferred:** Outlook integration, app control, remote commands (FR114-FR121), passive observation mode (FR122-FR128)

---

## Epic 0: Repository, Dev Pipeline & Platform Foundation

**Sprint:** 0
**Goal:** Developers can build, test, and deploy the platform. Auth, tenant isolation, and multi-model AI abstraction are operational. AxisDeploymentSpec schema ready for AI onboarding.
**FRs covered:** FR51, FR76-FR84

### Story 0.1: Monorepo Initialization & Dev Toolchain

As a **developer**,
I want a properly configured monorepo with all workspace directories and dev tooling,
So that I can build, lint, and type-check across all packages from day one.

**Acceptance Criteria:**

**Given** no project exists
**When** the initialization script runs (`pnpm dlx create-turbo@latest wisdomworks`)
**Then** the monorepo is created with Turborepo + pnpm workspaces
**And** the following directories exist: `apps/web`, `apps/desktop`, `apps/website`, `packages/api`, `packages/db`, `packages/auth`, `packages/shared`, `packages/ui`, `packages/globe`, `services/agents`, `services/signal-layer`, `services/ingestion`
**And** ESLint is configured with consistent rules across all workspaces
**And** Prettier is configured with a shared config
**And** TypeScript strict mode is enabled in all TypeScript workspaces
**And** `pnpm build` succeeds across all workspaces (empty scaffolds)
**And** `pnpm lint` passes with zero errors
**And** boundary rules are documented: packages never import apps/services; apps import packages only; services communicate via REST/NATS only

### Story 0.2: Database Foundation & Core Schema

As a **developer**,
I want a PostgreSQL database with Drizzle ORM and core tenant/auth tables,
So that all subsequent stories can persist data with tenant isolation from the start.

**Acceptance Criteria:**

**Given** the monorepo from Story 0.1 exists
**When** the database package (`packages/db`) is initialized
**Then** Drizzle ORM is configured with PostgreSQL and pgvector extension
**And** the following tables are created: `tenants`, `tenant_configs`, `users`, `sessions`, `accounts`
**And** all tables use UUID v7 for primary keys
**And** all date columns use ISO 8601 serialization
**And** `tenants` table includes: `id`, `name`, `slug`, `status`, `created_at`, `updated_at`
**And** `tenant_configs` table includes: `id`, `tenant_id`, `config_type`, `config_data (JSONB)`, `created_at`, `updated_at`
**And** `users` table includes `tenant_id` as a required foreign key
**And** every table that stores tenant-scoped data has a `tenant_id` column with a foreign key to `tenants`
**And** GIN indexes are created on all JSONB columns
**And** migrations run successfully via `pnpm db:migrate`
**And** a database connection health check endpoint exists

### Story 0.3: Authentication & Tenant Isolation

As a **platform operator**,
I want secure authentication with Entra ID and enforced tenant isolation on every query,
So that no user can ever access another tenant's data.

**Acceptance Criteria:**

**Given** the database schema from Story 0.2 exists
**When** Auth.js v5 is configured in `packages/auth`
**Then** Entra ID (Azure AD) is the identity provider
**And** the Auth.js session includes `tenantId` and `userId`
**And** a tRPC context middleware extracts `tenantId` from the session and generates a `requestId` (UUID v7)
**And** all tRPC procedures receive `tenantId` and `requestId` via context
**And** a tenant isolation middleware ensures every database query includes a `WHERE tenant_id = ?` filter
**And** RBAC roles are defined: `owner`, `admin`, `member`, `viewer`
**And** least-privilege enforcement: each role has explicitly defined permissions
**And** sessions comply with NIST SP 800-53 IA controls (timeout, rotation)
**And** no plaintext credentials are stored; secrets use environment variables
**And** **parametric isolation test:** a query from Tenant A returns zero rows from Tenant B's data (R-001)
**And** **negative test:** attempting to access a resource with a mismatched `tenantId` returns 403

### Story 0.4: NATS Event System & Docker Compose

As a **developer**,
I want a NATS JetStream event system and a Docker Compose development environment,
So that services can communicate asynchronously with guaranteed delivery.

**Acceptance Criteria:**

**Given** the monorepo and database from previous stories exist
**When** the signal-layer service (`services/signal-layer`) is configured
**Then** NATS JetStream is running via Docker Compose
**And** event naming follows `{domain}.{tenant_id}.{action}` pattern (dot-separated, lowercase)
**And** a `DomainEvent<T>` TypeScript type wraps all events with: `id`, `type`, `tenantId`, `timestamp`, `source`, `data`, `metadata`
**And** dead letter queue is configured with exponential backoff (max 3 attempts)
**And** at-least-once delivery is guaranteed with duplicate detection via `DomainEvent.id`
**And** an SSE bridge endpoint exists for browser real-time updates
**And** a `CacheProvider` interface using NATS KV is implemented (swappable to Redis at Growth)
**And** Docker Compose includes: PostgreSQL (with pgvector), NATS JetStream, and all service containers
**And** `docker compose up` starts the full development environment
**And** signal delivery completes within 60 seconds (NFR8)

### Story 0.5: CI/CD Pipeline & Schema Contract Testing

As a **developer**,
I want a CI/CD pipeline that validates schema contracts and deploys on merge,
So that Python↔PostgreSQL drift is caught before it reaches production (B-003).

**Acceptance Criteria:**

**Given** the monorepo, database, and services from previous stories exist
**When** a pull request is opened
**Then** GitHub Actions runs the Turborepo pipeline (`lint`, `typecheck`, `test`, `build`)
**And** the schema contract test validates Python Pydantic models against Drizzle-migrated schema (B-003)
**And** if the schema contract test fails, the PR is blocked from merging
**And** P0 tests must pass at 100% for PR merge
**And** P1 tests must pass at ≥95%
**And** Python services are wrapped with `package.json` for Turborepo integration
**And** deploy targets are configured: web → Vercel, services → Azure Container Apps
**And** the pipeline completes within a reasonable time for the project size

### Story 0.6: Test Infrastructure & Data Seeding

As a **developer**,
I want isolated test infrastructure and a data seeding API,
So that integration tests run against real services without affecting dev/prod data (B-002, B-004).

**Acceptance Criteria:**

**Given** NATS and the database are running from previous stories
**When** the test infrastructure is initialized
**Then** `docker-compose.test.yml` runs an isolated NATS JetStream instance for testing (B-002)
**And** test NATS uses separate streams/subjects from development
**And** a tRPC test-seed router exists at `packages/api/src/routers/test-seed.ts` (B-004)
**And** the seeding API can create: tenants, users, entities, relationships, agent configs, and signals
**And** seeded data is scoped to a test tenant and cleaned up after test runs
**And** tests co-locate with source files (enforcement rule #2)
**And** test utilities exist for: creating authenticated test contexts, generating test tenants, asserting tenant isolation
**And** `pnpm test` runs all tests against the isolated infrastructure

### Story 0.7: Model Abstraction Layer

As a **developer**,
I want a multi-provider AI abstraction layer supporting Anthropic and OpenAI,
So that any agent can be routed to the optimal model per task without provider lock-in.

**Acceptance Criteria:**

**Given** the monorepo and service infrastructure from previous stories exist
**When** the Model Abstraction Layer is implemented
**Then** Vercel AI SDK is integrated in TypeScript services (`packages/shared` or `packages/api`)
**And** LangGraph is integrated in Python agent services (`services/agents`)
**And** two providers are configured: Anthropic (Claude) and OpenAI (GPT)
**And** a `ModelProvider` interface abstracts provider-specific calls
**And** an adapter pattern allows direct SDK access for provider-specific features
**And** model routing configuration supports per-task model selection (e.g., `{ task: "code_generation", provider: "anthropic", model: "claude-sonnet-4-20250514" }`)
**And** basic try-catch failover: if primary provider fails, fallback to secondary
**And** a simple benchmark test harness exists: given a prompt + expected output, score accuracy across providers
**And** model calls include `tenantId` for usage tracking
**And** usage events are logged to the `usage_events` table

### Story 0.8: Governance & Audit Foundations

As a **platform operator**,
I want audit logging and governance rule enforcement from day one,
So that every agent action is traceable and governance rules are enforceable.

**Acceptance Criteria:**

**Given** the database and event system from previous stories exist
**When** governance tables are created and enforcement logic is implemented
**Then** `governance_rules` table stores allow/deny rules with: `id`, `tenant_id`, `rule_type`, `scope`, `action`, `effect` (allow/deny), `priority`, `config (JSONB)`, `active`
**And** `governance_evaluations` table logs every rule evaluation with: `id`, `tenant_id`, `rule_id`, `agent_id`, `action`, `result`, `reasoning`, `timestamp`
**And** `audit_logs` table captures all platform actions with: `id`, `tenant_id`, `user_id`, `agent_id`, `action`, `resource_type`, `resource_id`, `details (JSONB)`, `timestamp`, `request_id`
**And** a governance evaluation function checks rules before agent actions execute
**And** allow/deny rules support per-agent, per-action-type granularity
**And** governance violations are logged and surface an error to the caller
**And** audit logging captures 100% of agent actions and signal processing (NFR14)
**And** all governance data is tenant-scoped
**And** FIPS 140-2 encryption is enforced at rest and in transit (NFR12)

### Story 0.9: AxisDeploymentSpec Schema & Validation

As a **platform operator**,
I want the AxisDeploymentSpec schema stored and validated in tenant_configs,
So that the AI onboarding engine (Epic 1) has a well-defined structure to generate.

**Acceptance Criteria:**

**Given** `tenant_configs` table and Zod validation exist from previous stories
**When** the AxisDeploymentSpec type is defined
**Then** the TypeScript type captures: `organization` (name, industry, size, compliance), `surfaces` (website?, mobileApp?, desktopApp?, webDashboard), `agents` (array with role, name, modelRouting, outputChannels, governanceRules), `integrations` (array with type + config), `pricing` (tier, monthlyBase, modelCostEstimate, total)
**And** a Zod schema validates AxisDeploymentSpec at write time
**And** organizational blueprint types are defined: Solo (3-4 agents), Small Team (8-12), Mid-Size (30-60), Enterprise (100-300+), Air-Gapped
**And** blueprint type definitions include: default agent count range, signal complexity level, governance depth, and example config
**And** `tenant_configs` stores AxisDeploymentSpec with `config_type = 'deployment_spec'`
**And** CRUD operations for AxisDeploymentSpec are available via tRPC
**And** reading/writing AxisDeploymentSpec enforces tenant isolation
**And** a seed example exists for at least two blueprints (Solo + Mid-Size)

### Story 0.10: Payment Infrastructure & Billing Foundation

As a **platform operator**,
I want payment processing infrastructure ready,
So that the onboarding flow can collect security deposits and manage subscriptions.

**Acceptance Criteria:**

**Given** the database and tenant system from previous stories exist
**When** payment infrastructure is configured
**Then** Stripe is integrated as the payment processor with webhook endpoints for payment events
**And** `billing_records` table is created with: id, tenant_id, type (deposit/subscription/invoice), amount, currency, status, stripe_payment_id, created_at, updated_at
**And** `usage_events` table is created with: id, tenant_id, event_type (model_call/voice_minute/sms/storage), quantity, unit_cost, metadata (JSONB), timestamp
**And** deposit collection API exists: create payment intent, confirm, record in billing_records
**And** subscription management API exists: create subscription, update, cancel, webhook handler for payment events
**And** failed payment handling: retry logic, grace period, tenant suspension workflow
**And** all billing data is tenant-scoped
**And** PCI compliance: no card data stored locally — all handled by Stripe

### Story 0.11: Communication Channel Abstraction Layer

As a **developer**,
I want a unified communication channel interface,
So that email, WhatsApp, SMS, and voice all implement the same contract.

**Acceptance Criteria:**

**Given** the monorepo and service infrastructure exist
**When** the communication channel abstraction is implemented
**Then** a `CommunicationChannel` interface is defined with: send(message), receive(handler), getHistory(filters), getStatus()
**And** channel implementations are planned for: Email (MVP), WhatsApp (MVP), SMS (MVP), Voice (MVP), Web Dashboard (MVP)
**And** each channel adapter registers with a channel registry
**And** message routing logic can select channels based on: urgency, user preferences, business type defaults
**And** channel configuration is stored per tenant in tenant_configs
**And** all channel messages are logged uniformly for audit compliance
**And** the interface is extensible — new channels can be added without modifying existing code

---

## Epic 1: AI Onboarding & Axis Intelligence Engine

**Sprint:** 1
**Goal:** A business owner describes their needs in natural language → AI builds their AxisDeploymentSpec → ontology constructed → agents derived and deployed automatically. Customer sees a demo preview, pays security deposit, then agents deploy.
**FRs covered:** FR28-FR32, FR57, FR91-FR93, FR164-FR166

### Story 1.1: Ontology Schema & Entity Model

As a **platform operator**,
I want a flexible entity model with typed core tables and JSONB metadata,
So that the Axis team can represent any organization's structure with referential integrity.

**Acceptance Criteria:**

**Given** the database foundation from Epic 0 exists
**When** the ontology schema is created in `packages/db`
**Then** `entity_types` table defines categories: employee, role, department, project, client, capability, risk, decision, task, innovation, contract
**And** `entities` table includes: `id`, `tenant_id`, `entity_type_id`, `name`, `status`, `metadata (JSONB)`, `embedding (vector)`, `created_at`, `updated_at`
**And** `relationship_types` table defines: reports_to, works_on, manages, collaborates_with, owns, depends_on
**And** `relationships` table includes: `id`, `tenant_id`, `source_entity_id`, `target_entity_id`, `relationship_type_id`, `metadata (JSONB)`, `confidence`, `created_at`
**And** Zod schemas validate metadata per entity type at write time (FR32)
**And** HNSW index exists on embedding columns for vector similarity search
**And** GIN indexes exist on all JSONB metadata columns
**And** ontology writes are atomic — partial writes roll back (NFR36)
**And** ontology supports 10,000+ entities with referential integrity (NFR24)
**And** all tables enforce tenant isolation via `tenant_id`

### Story 1.2: Business Type Framework Dictionary

As a **platform operator**,
I want a dictionary of business types with structured profiles,
So that the onboarding AI can quickly identify what a business needs.

**Acceptance Criteria:**

**Given** the AxisDeploymentSpec schema exists
**When** business type frameworks are loaded
**Then** a dictionary contains profiles for 20+ business types (electrician, plumber, cosmetician, barber, dentist, restaurant, law firm, consulting firm, etc.)
**And** each profile includes: typical workflows, client interaction patterns, seasonal rhythms, common tools/integrations, required agent roster, recommended output channels, client profile structure, key business metrics
**And** frameworks are organized into categories: Skilled Trades, Personal Services, Food & Hospitality, Professional Services, Healthcare, Retail, Creative Services, Construction & Maintenance
**And** the dictionary grows from successful deployments — new business types become reusable frameworks
**And** the Axis team can discover new business types by crawling the web (SIC/NAICS codes, business directories)
**And** frameworks are stored as structured seed data, extensible without code changes

### Story 1.3: Industry Templates & Blueprint Library

As a **platform operator**,
I want prebuilt industry templates and organizational blueprints,
So that Blueprint × Template = rapid AxisDeploymentSpec generation.

**Acceptance Criteria:**

**Given** the business type dictionary from Story 1.2 exists
**When** templates and blueprints are loaded
**Then** two industry templates are fully built out: **Professional Services** (consulting, legal, accounting — agents: Founder/CEO, Project Manager, Business Analyst, Communications, HR, Finance) and **Small Business** (salon, restaurant, retail — agents: Scheduler, Marketing, Website Manager, Customer Service)
**And** **Business blueprints** are defined: Solo (1-2 people, 3-4 agents), Small Team (3-20, 8-12 agents), Mid-Size (20-200, 30-60 agents), Enterprise (200+, 100-300+ agents), Air-Gapped
**And** each blueprint defines: agent count range, signal complexity (linear/hub-spoke/mesh/hierarchical), governance depth (minimal/light/standard/strict/maximum)
**And** Blueprint × Template × Business Type Framework = valid partial AxisDeploymentSpec
**And** templates are extensible — new templates can be added without code changes

### Story 1.4: Personal Templates & Privacy Governance

As a **platform operator**,
I want personal (non-business) templates with appropriate privacy defaults,
So that individuals can use WisdomWorks for personal development, not just business.

**Acceptance Criteria:**

**Given** templates and blueprints from Story 1.3 exist
**When** personal templates are loaded
**Then** **Personal templates** are defined: Personal Assistant (calendar, reminders, task management, life organization), Creative Professional (personal brand, trend curation, portfolio management, inspiration), Health & Wellness (therapist/client session notes, health tracking, journaling prompts, wellness routines), Student (assignment management, study schedules, career prep, research assistance), Leadership Development (emerging leader coaching, scenario practice, reading list curation, 360-feedback analysis, executive presence coaching)
**And** Personal templates include stricter privacy governance defaults — especially Health & Wellness (HIPAA-aligned: encrypted at rest, no data sharing, audit trail on all access, data retention policies)
**And** **Personal blueprints** are defined: Individual (1 user, 2-3 agents, $5-15/mo), Family (2-6 users, 4-8 agents, $15-30/mo), Creator (1 user, 4-6 agents with content/brand focus, $20-40/mo)
**And** personal blueprints use the same AxisDeploymentSpec schema as business blueprints

### Story 1.5: Leadership Coach Agent Behavior

As a **platform operator**,
I want a Leadership Coach agent that coaches both humans and other agents,
So that every deployment continuously develops leadership skills and agent performance.

**Acceptance Criteria:**

**Given** agent configs and governance from previous stories exist
**When** the Axis team detects a management role in the ontology
**Then** a Leadership Coach agent is provisioned alongside their role agent
**And** the Leadership Coach helps humans with: difficult conversations, performance review preparation, delegation strategies, conflict resolution, team dynamics analysis from signal patterns, situational leadership guidance
**And** the Leadership Coach **coaches other agents** — subscribes to peer agents' performance signals and audit data, analyzes patterns, sends coaching signals with specific improvement recommendations
**And** agent-to-agent coaching is measurable: pre/post performance metrics tracked, producing evidence of improvement
**And** the Leadership Coach mediates inter-agent friction — intervenes with coordination protocol when agents send conflicting signals
**And** the Leadership Coach provides **owner performance feedback** across: business performance (revenue trends, client gaps, missed opportunities), operational performance (autonomy recommendations, bottleneck identification), leadership performance (management pattern analysis with constructive recommendations)
**And** performance feedback is delivered at the owner's preferred cadence and calibrated to business type
**And** coaching interactions are logged as signals and visible in the activity feed

### Story 1.6: Conversational AI Onboarding Flow

As a **business owner**,
I want to describe my business needs in a natural conversation,
So that the platform understands my organization without me filling out forms.

**Acceptance Criteria:**

**Given** industry templates and blueprints from Stories 1.2-1.3 exist
**When** a new customer starts the onboarding conversation
**Then** the AI interviews the customer about: business type, industry, organization size, team structure, key workflows, pain points, desired capabilities, existing tools/integrations, compliance requirements
**And** the conversation adapts its questions based on prior answers (e.g., salon gets different questions than consulting firm)
**And** the AI uses Vercel AI SDK streaming for real-time conversational response
**And** conversation state is persisted across sessions (customer can leave and resume)
**And** the AI suggests the most appropriate blueprint + template based on answers
**And** the conversation extracts structured data: org name, industry, employee count, role list, integration needs, compliance flags
**And** a new tenant is created at the start of the conversation (status: `onboarding`)
**And** all conversation data is stored scoped to the new tenant

### Story 1.7: AxisDeploymentSpec Generation from Conversation

As a **business owner**,
I want the AI to generate my full deployment specification from our conversation,
So that I can see exactly what agents and services will be built for me.

**Acceptance Criteria:**

**Given** the onboarding conversation from Story 1.6 has collected sufficient data
**When** the AI generates the AxisDeploymentSpec
**Then** the spec includes: organization profile, selected blueprint, selected template, customizations from conversation
**And** the agent roster is derived from Blueprint × Template × conversation data
**And** each agent in the roster has: role, name, suggested modelRouting, outputChannels, governanceRules
**And** surfaces are determined based on business needs (webDashboard always, website/mobileApp/desktopApp based on conversation)
**And** integrations are listed based on customer's existing tools
**And** pricing is calculated: tier selection + monthly base + estimated model costs = total
**And** the spec passes Zod validation against the AxisDeploymentSpec schema
**And** the spec is saved to `tenant_configs` with `config_type = 'deployment_spec'`
**And** the customer can request changes before finalizing ("Actually, I also need a scheduling agent")

### Story 1.8: Demo Preview Generation

As a **business owner**,
I want to see a preview of my deployment before committing,
So that I understand exactly what I'm getting and what it costs.

**Acceptance Criteria:**

**Given** an AxisDeploymentSpec has been generated from Story 1.7
**When** the demo preview is rendered
**Then** the customer sees their agent roster with names, roles, and capabilities described
**And** a visual signal topology shows how agents connect (who talks to whom)
**And** a cost breakdown shows: tier, monthly base, estimated LLM costs per agent, total monthly estimate
**And** the selected blueprint and template are displayed with explanation
**And** the customer can ask the AI questions about the preview ("What does the Marketing agent do?")
**And** the customer can request modifications which regenerate the spec (loops back to Story 1.7)
**And** a "Ready to deploy" action is available when the customer is satisfied
**And** the preview is tenant-scoped — no data from other customers is visible

### Story 1.9: Security Deposit & Trial Agreement

As a **business owner**,
I want to pay a security deposit and agree to a trial period,
So that my deployment is provisioned and I'm committed to evaluating the platform.

**Acceptance Criteria:**

**Given** the customer has approved their demo preview from Story 1.8
**When** the customer proceeds to commit
**Then** a deposit amount is displayed based on their tier: Solo $50, Small $200, Mid $500, Enterprise $2,000+
**And** a minimum trial period is shown: 30 days (Solo/Small), 60 days (Mid/Enterprise)
**And** the customer is informed the deposit applies to their first invoice (prepayment, not a fee)
**And** payment collection is integrated (Stripe or equivalent payment processor)
**And** upon successful payment, the tenant status changes from `onboarding` to `provisioning`
**And** a `billing_records` entry is created with deposit amount, trial start date, trial end date
**And** the customer receives confirmation with trial terms
**And** if payment fails, the customer can retry without losing their AxisDeploymentSpec
**And** no free tier — payment is required to proceed

### Story 1.10: Ontology Construction from Onboarding Data

As a **platform operator**,
I want the Axis team to build the customer's organizational ontology from onboarding data,
So that agents are grounded in the real structure of the business.

**Acceptance Criteria:**

**Given** a paid customer with a finalized AxisDeploymentSpec from previous stories
**When** the Axis team ontology construction runs
**Then** entities are created from the conversation data: employees/roles → entity type "employee" or "role", departments, projects, clients, capabilities
**And** relationships are created: reports_to, works_on, manages, collaborates_with
**And** entity metadata is populated from conversation context (e.g., role responsibilities, department function)
**And** Axis agents can cross-validate each other's ontology work (FR29)
**And** the completed ontology is reviewable before agent deployment (FR30)
**And** the ontology can be extended post-deployment without disrupting active agents (FR31)
**And** all entities and relationships are scoped to the customer's tenant
**And** ontology writes are atomic — failures roll back cleanly (NFR36)
**And** the Axis team flags any ambiguities or missing data for customer clarification

### Story 1.11: Agent Derivation & Model Routing Assignment

As a **platform operator**,
I want agents derived from the ontology with optimal model assignments per task,
So that each agent runs on the best AI model for its specific responsibilities.

**Acceptance Criteria:**

**Given** the ontology from Story 1.10 exists and the AxisDeploymentSpec lists the agent roster
**When** agent derivation and model assignment runs
**Then** `agent_configs` records are created for each agent in the roster
**And** each agent config includes: `tenant_id`, `agent_role`, `agent_name`, `model_routing (JSONB)`, `output_channels`, `governance_rules`, `status`
**And** `modelRouting` maps each task type to a provider + model + fallback (e.g., `{ "code_generation": { "provider": "anthropic", "model": "claude-sonnet-4-20250514", "fallback": { "provider": "openai", "model": "gpt-4o" } } }`)
**And** model assignment uses benchmark data from the test harness (Story 0.7) when available
**And** if no benchmark data exists, the template's default model routing is used
**And** agents are mapped to ontology entities (e.g., "Marketing Agent" linked to Marketing department entity) (FR164-FR166)
**And** the founder/owner gets an orchestrator agent that coordinates all others
**And** all agent configs are tenant-scoped

### Story 1.12: Automated Agent Provisioning

As a **platform operator**,
I want agents automatically provisioned and wired from the AxisDeploymentSpec,
So that the customer's deployment goes live without manual intervention.

**Acceptance Criteria:**

**Given** agent configs from Story 1.11 and ontology from Story 1.10 exist
**When** automated provisioning runs
**Then** `agent_instances` records are created for each agent config with status `provisioning`
**And** signal connections are wired between agents based on the blueprint's signal topology (linear/hub-spoke/mesh)
**And** governance rules from the AxisDeploymentSpec are applied to each agent instance
**And** NATS subjects are created for inter-agent communication scoped to the tenant
**And** agent instances transition to status `ready` when all wiring is complete
**And** the tenant status transitions from `provisioning` to `active`
**And** the customer is notified that their deployment is live
**And** a deployment audit log entry is created capturing the full provisioning event
**And** if any provisioning step fails, the system rolls back and reports the failure
**And** agents are ready to receive work (actual execution is Epic 2)

### Story 1.13: Axis Integration Discovery & Org Documentation

As a **platform operator**,
I want the Axis team to discover available integrations and document the organization,
So that agents know what tools exist and how the organization operates.

**Acceptance Criteria:**

**Given** the customer's ontology and agent configs from previous stories exist
**When** the Axis team runs integration discovery and documentation
**Then** the Axis team discovers which integrations exist per deployment (FR57): email platform, calendar, directory services, HR systems, project management tools
**And** discovered integrations are stored in the AxisDeploymentSpec's `integrations` array with connection status
**And** the Axis team evaluates and recommends interaction channels per role category (FR92): which agents should use email, chat, terminal, etc.
**And** the Axis team documents the organization's mission, purpose, tool inventory, and operational patterns (FR93)
**And** organizational documentation is stored as ontology entities with type "documentation"
**And** integration discovery results inform agent output channel configuration
**And** all discovery data is tenant-scoped
**And** the Axis team produces a deployment summary report accessible via the dashboard

### Story 1.14: Agent Operating Protocol & Behavioral Framework

As a **platform operator**,
I want a defined set of behavioral guidelines that every AI agent must follow,
So that all agents operate safely, predictably, and within established boundaries regardless of role or task.

**Acceptance Criteria:**

**Given** governance enforcement from Story 0.8 and agent configs from Story 1.11 exist
**When** an agent is instantiated
**Then** the agent inherits a base operating protocol that includes:
**And** **Data Rules:** agent only operates on tenant-scoped data; never accesses cross-tenant data; never persists raw email content beyond classification; purges reclassified data within 5 minutes (NFR13)
**And** **Signal Rules:** inter-agent communication uses structured metadata signals only — never raw content (FR21); cross-agent actions require user consent (FR25); signal routing respects governance rules (FR27)
**And** **Autonomy Levels:** four progressive levels are defined — L1 (approval-required: all actions need human approval), L2 (notify-and-act: agent acts then notifies), L3 (autonomous-with-reporting: agent acts, reports weekly), L4 (fully-autonomous: exception-only reporting)
**And** each agent starts at the autonomy level defined in its `governanceRules` config
**And** autonomy level can be upgraded per agent per action type as trust/accuracy increases
**And** **Escalation Protocol:** agent escalates to owner when: confidence < threshold, action has financial impact above limit, action crosses compliance boundary, novel situation with no matching governance rule
**And** **Failure Protocol:** on model call failure → retry once → fallback provider → log and notify; on peer agent unreachable → queue signal → retry with backoff → escalate after 3 failures
**And** **Audit Mandate:** every agent action, decision, and signal is logged to `audit_logs` — no silent operations
**And** **BMAD Mandate:** every agent monitors its domain for patterns, anomalies, and improvement opportunities
**And** the operating protocol is stored as a versioned configuration and applied at agent instantiation
**And** the protocol is tenant-configurable — operators can tighten but not loosen the base rules

---

## Epic 2a: Agent Runtime & Core Intelligence

**Sprint:** 2
**Goal:** Deployed agents actually run, communicate, process email, and improve the business — autonomously. Progressive autonomy with governance rules per agent per action.
**FRs covered:** FR1-FR7, FR8-FR20, FR21-FR27, FR33-FR36, FR48, FR54, FR58-FR63, FR87-FR88, FR102-FR103, FR129-FR135

### Story 2.1: Agent Execution Engine

As a **platform operator**,
I want agents to run as LangGraph-orchestrated processes with lifecycle management,
So that provisioned agents can execute tasks, route to optimal models, and be controlled.

**Acceptance Criteria:**

**Given** agent instances provisioned from Epic 1 exist with status `ready`
**When** the agent execution engine starts
**Then** each agent runs as a LangGraph state machine in `services/agents`
**And** the engine reads `agent_configs.modelRouting` to dispatch each task to the correct provider/model
**And** agent lifecycle states are managed: `ready` → `running` → `paused` → `stopped` → `error`
**And** agents can be started, paused, resumed, and stopped via API calls
**And** each agent execution respects the operating protocol from Story 1.14
**And** agent actions pass through governance evaluation before execution (Story 0.8)
**And** all agent actions are logged to `audit_logs` with `tenant_id` and `request_id`
**And** model call failures trigger the failure protocol (retry → fallback → notify)
**And** agent health is self-monitored; unhealthy agents restart within 2 minutes (NFR34)
**And** the engine supports NFR11 (13 concurrent users with no performance degradation)

### Story 2.2: Email Ingestion Pipeline

As a **platform operator**,
I want emails ingested from Exchange via webhook into the agent pipeline,
So that agents can process organizational email as their primary data source (B-001).

**Acceptance Criteria:**

**Given** the agent execution engine from Story 2.1 is running
**When** an Exchange webhook delivers email events
**Then** the webhook endpoint authenticates and validates incoming events
**And** email events are queued in NATS scoped to the correct tenant
**And** each email event includes: sender, recipients, subject, body, attachments metadata, timestamp
**And** near-real-time processing: emails are queued within 1 minute of receipt (NFR40)
**And** webhook resilience: exponential backoff on failures (NFR43)
**And** duplicate email detection prevents reprocessing
**And** the pipeline handles batch volumes: 500 emails within 15 minutes (NFR2)
**And** email data is tenant-isolated — emails from Tenant A never route to Tenant B's agents
**And** the webhook endpoint is the B-001 gate — without it, email-dependent features are blocked

### Story 2.3: Email Classification & Privacy Boundary

As an **employee**,
I want my agent to classify emails as business, personal, or uncertain and protect my privacy,
So that only business-relevant content enters the organizational intelligence layer.

**Acceptance Criteria:**

**Given** emails are ingested from Story 2.2
**When** an agent processes an email
**Then** the email is classified as `business`, `personal`, or `uncertain` (FR1)
**And** personal emails are filtered from the business signal layer — no metadata extracted (FR2)
**And** each classification includes a confidence score (FR3)
**And** uncertain classifications are held and surfaced in the user's morning briefing for clarification (FR4)
**And** classification completes within 5 seconds per email (NFR1)
**And** when an email is reclassified (e.g., business → personal), all extracted data is purged within 5 minutes (FR7, NFR13)
**And** privacy boundary uses defense-in-depth: classification + purge + no raw content in signals (R-005)
**And** no personal email content is ever persisted beyond the classification cycle
**And** classification decisions are logged to `audit_logs`
**And** 90% classification accuracy at 30 days, 95%+ at 90 days (NFR9)

### Story 2.4: Signal Layer — Agent-to-Agent Communication

As an **agent**,
I want to communicate with other agents via structured metadata signals,
So that cross-agent intelligence emerges without exposing raw content.

**Acceptance Criteria:**

**Given** the agent execution engine and NATS event system are running
**When** an agent sends a signal to another agent
**Then** signals use structured metadata only — never raw email content (FR21)
**And** `signals` and `signal_types` tables store all signal data with `tenant_id`
**And** signal types include: task_handoff, information_request, deadline_alert, discovery, innovation, status_update
**And** agents can coordinate cross-agent tasks: report collection, information requests, task handoffs, deadline management (FR22)
**And** agents fall back to drafting email for user review when a counterpart agent doesn't exist (FR23)
**And** cross-agent actions require user consent before execution (FR25)
**And** agents in authorized deployment environments at the same security classification can communicate (FR26)
**And** signal routing governance rules are enforced — defining which signal types can cross between environments (FR27)
**And** signal delivery completes within 60 seconds (NFR8)
**And** at-least-once delivery with duplicate detection (NFR35, R-006)

### Story 2.5: Data Extraction & Ontology Mapping

As a **platform operator**,
I want agents to extract structured data from emails and map it to the ontology,
So that organizational intelligence is continuously enriched from daily communication.

**Acceptance Criteria:**

**Given** emails classified as `business` from Story 2.3 exist
**When** an agent processes a business email
**Then** structured data is extracted: dates, deadlines, budget figures, project references, personnel, milestones, action items (FR33)
**And** a data relationship workflow maps extracted data to existing ontology entities (FR34)
**And** extracted and mapped data is available for dashboard display (FR35)
**And** new entities or relationships not in the ontology are flagged for Axis team review (FR36)
**And** extraction uses the agent's configured model via the Model Abstraction Layer
**And** only business-relevant signal metadata is stored — no raw email content (NFR17)
**And** full email pipeline (ingestion → classification → extraction → mapping) completes within 30 seconds (NFR1)
**And** all extraction and mapping operations are tenant-scoped and audit-logged

### Story 2.6: Personal Agent & Morning Briefing

As an **employee**,
I want a personal AI agent that generates my morning briefing,
So that I start each day knowing exactly what needs my attention.

**Acceptance Criteria:**

**Given** a user has a provisioned personal agent derived from the ontology
**When** the configured briefing time arrives
**Then** the agent generates a morning briefing summarizing: actionable items, pending tasks, uncertain email classifications to review, calendar conflicts, cross-agent discoveries, deadline alerts (FR9)
**And** the personal agent mirrors the user's organizational role (FR8)
**And** uncertain email classifications from Story 2.3 are surfaced for user clarification (FR4)
**And** the briefing is delivered within 5 minutes of the configured time (NFR3)
**And** time-sensitive notifications for urgent items are delivered immediately, not held for briefing (FR19)
**And** the user can interact with their personal agent conversationally (FR20)
**And** the user can name their personal agent (FR18)
**And** the briefing content is tenant-scoped

### Story 2.7: Email Drafting & Grammar Correction

As an **employee**,
I want my agent to draft email responses and correct my grammar,
So that I communicate professionally and efficiently.

**Acceptance Criteria:**

**Given** a personal agent from Story 2.6 exists and business emails have been classified
**When** the user requests an email draft or grammar check
**Then** the agent drafts email responses for user review and approval before sending (FR10)
**And** the agent corrects grammar in user-composed content (FR11)
**And** drafts are contextually informed by the ontology (org structure, project context, relationships)
**And** the user must explicitly approve before any email is sent
**And** draft generation uses the agent's configured writing model from `modelRouting`
**And** drafts and corrections are logged to `audit_logs`
**And** the agent can propose monthly report bullets based on email activity and completed tasks (FR12)

### Story 2.8: Task Management & Calendar Awareness

As an **employee**,
I want my agent to track my tasks and be aware of my calendar,
So that nothing falls through the cracks and I avoid scheduling conflicts.

**Acceptance Criteria:**

**Given** a personal agent from Story 2.6 exists
**When** tasks are extracted from emails or created manually
**Then** the agent carries forward incomplete tasks across sessions (FR13)
**And** the agent provides calendar awareness: conflict detection and scheduling suggestions (FR14)
**And** the agent learns and tracks the user's daily schedule patterns over time (FR87)
**And** task status is persisted across agent restarts
**And** overdue tasks are surfaced in morning briefings with escalating urgency
**And** task data is tenant-scoped and audit-logged

### Story 2.9: Knowledge Base & Error Prevention

As an **employee**,
I want my agent to answer policy questions and flag potential mistakes,
So that I stay compliant and avoid errors.

**Acceptance Criteria:**

**Given** a personal agent and the organization's ontology exist
**When** the user asks a company policy question
**Then** the agent answers from the ingested knowledge base (FR15)
**And** the agent flags potential errors when it detects them in user actions (FR16)
**And** the agent surfaces relevant career development opportunities (FR17)
**And** knowledge base queries use vector similarity search via pgvector embeddings
**And** answers cite their source entity in the ontology
**And** all queries and responses are tenant-scoped and audit-logged

### Story 2.10: Agent State Persistence & Recovery

As a **platform operator**,
I want agent state to persist across sessions and recover from crashes,
So that agents never lose context and resume seamlessly after failures.

**Acceptance Criteria:**

**Given** agents are running from Story 2.1
**When** an agent session ends or the agent crashes
**Then** agent state is persisted across sessions (FR129)
**And** agents recover from crashes and resume from last known state (FR130)
**And** state versioning allows rollback to previous states (FR131)
**And** agent state syncs to cloud storage for backup (FR132-FR135)
**And** zero data loss for agent state (NFR38)
**And** daily backups with point-in-time recovery within 24 hours (NFR39)
**And** graceful degradation: if cloud sync fails, agent continues locally and retries sync (NFR37)
**And** state recovery completes within 2 minutes (NFR34)
**And** all state operations are tenant-scoped

### Story 2.11: BMAD Innovation Engine

As a **business owner**,
I want agents to detect patterns, anomalies, and opportunities and recommend improvements,
So that the platform continuously improves my business operations.

**Acceptance Criteria:**

**Given** agents are running and processing signals
**When** an agent detects a pattern, anomaly, or opportunity in its domain
**Then** the agent activates structured ideation capabilities using BMAD methodology (FR58)
**And** a solution brief is generated with: problem description, proposed solution, confidence score, expected impact, risk assessment
**And** solution briefs are routed to designated reviewers for feasibility review (FR59)
**And** the platform tracks innovation proposals across the organization (FR60)
**And** agents surface cross-agent solution discovery — connecting insights from different agents (FR61)
**And** at autonomy L1-L2: solution briefs require owner approval before action
**And** at autonomy L3-L4: low-risk improvements can be auto-implemented with reporting
**And** all innovation activity is tenant-scoped and audit-logged

### Story 2.12: Workflow Execution & PDF Generation

As an **employee**,
I want agents to execute workflows and generate PDF documents,
So that repetitive processes are automated and professional documents are produced.

**Acceptance Criteria:**

**Given** agents are running with task and signal processing
**When** a workflow is triggered (email processing, report generation, deadline management)
**Then** the agent executes defined workflows end-to-end (FR62)
**And** the agent can build and execute custom workflows for organizational processes (FR63)
**And** the agent can generate PDF documents for distribution (FR48)
**And** PDF generation completes within 2 minutes (NFR7)
**And** workflows respect the agent's governance rules and autonomy level
**And** workflow execution is audit-logged with start, steps, and completion status

### Story 2.13: Classification Learning & QA Monitoring

As a **platform operator**,
I want agents to learn from user corrections and a QA team to monitor classification quality,
So that accuracy continuously improves and systemic issues are caught early.

**Acceptance Criteria:**

**Given** email classification from Story 2.3 and user feedback from morning briefings
**When** a user corrects a classification decision
**Then** the agent learns from the correction to improve future accuracy (FR5)
**And** a monitoring/QA agent team detects systemic classification patterns: misclassification trends, edge cases, drift (FR6)
**And** the QA agent can ingest the user's resume or professional profile for context (FR102)
**And** agents can learn user behavior passively through email patterns and work habits (FR103)
**And** accountability metrics are tracked and reportable (FR88)
**And** classification accuracy trends toward 90% at 30 days, 95%+ at 90 days (NFR9)
**And** QA findings are surfaced as BMAD innovation opportunities
**And** all learning and QA data is tenant-scoped

### Story 2.14: Process Capture & Experience Logging

As a **platform operator**,
I want every agent and human action captured as a structured process record,
So that agents can learn from experience and build skills over time.

**Acceptance Criteria:**

**Given** agents are running and executing tasks
**When** an agent completes a process (email handled, appointment booked, insight generated, conflict resolved)
**Then** a `process_records` entry is created with: intent, process_steps (ordered), decisions with reasoning, end_state, evaluation (success/partial/failure + confidence), reflection, tags (business_type, agent_role, task_category), duration
**And** human process capture is supported: when a business owner resolves something manually (e.g., handles a tricky scheduling conflict), they can flag "learn from this" via WhatsApp or chat
**And** the agent observes the human's actions and outcome and creates a process record from the observation
**And** process records include enough context for pattern detection but no raw personal data (tenant-scoped, privacy-compliant)
**And** a `lessons_learned` registry captures what went wrong and the corrective action, cross-referenced to process records
**And** agents query lessons learned before executing similar tasks to avoid known pitfalls
**And** all process capture is tenant-scoped and audit-logged

### Story 2.15: Skill Formation & Cross-Agent Learning

As a **platform operator**,
I want agents to form skills from captured processes and share learnings with each other,
So that the entire agent team gets smarter from every experience.

**Acceptance Criteria:**

**Given** process records from Story 2.14 are accumulating
**When** the BMAD engine detects a pattern across similar process records
**Then** a skill candidate is generated with: skill name, trigger conditions, action steps, evidence (source process record IDs, success rate), confidence score
**And** skill candidates are reviewed: at L1-L2 autonomy the owner approves, at L3-L4 the Leadership Coach approves low-risk skills automatically
**And** approved skills are stored in `agent_skills` table and loaded into the agent's runtime config
**And** skill performance is monitored post-activation: success rate tracked, skills deprecated if performance drops
**And** **cross-agent learning:** when one agent develops a skill, related agents in the same tenant receive it as a skill candidate (e.g., Marketing learns "Tuesday promos work" → Scheduler gets candidate "block fewer Tuesday slots")
**And** **cross-tenant learning (anonymized):** skills with high confidence across 3+ tenants of the same business type are anonymized (no customer data) and promoted to the Business Type Framework Dictionary as default capabilities
**And** the dictionary entry grows richer with every deployment: Salon A discovers "text reminders reduce no-shows 40%" → all new Salon deployments get this on day one
**And** agents can build skills from other agents' process records — not just their own
**And** all skill formation is tenant-scoped (cross-tenant learning anonymizes before sharing)
**And** **cross-environment boundaries enforced:** commercial tenants share anonymized skills via dictionary; government environments receive a frozen dictionary snapshot at deployment and never send data back; air-gapped environments learn internally only — dictionary updates via manual software release; no process records, skills, or lessons ever cross a government or air-gapped boundary

---

## Epic 2b: Client Intelligence & Communication Channels

**Sprint:** 2-3
**Goal:** Agents interact with business owners via mobile (WhatsApp, SMS, calendar, voice), build client profiles with visual intelligence, and generate actionable business insights. These capabilities make the platform valuable for solo operators who never open a dashboard.
**New capabilities beyond original PRD FRs:** client profiles, visual intelligence, business insights, WhatsApp/SMS/calendar integration, voice AI.

### Story 2b.1: Client Profiles & Visual Intelligence

As a **business owner**,
I want my agents to build profiles on my clients — including photos and visual patterns,
So that service quality improves over time and my business accumulates institutional knowledge.

**Acceptance Criteria:**

**Given** agents are running for a deployed business
**When** the business owner interacts with clients over time
**Then** agents build structured client profiles including: name, contact info, visit history, preferences, service history, notes, satisfaction signals
**And** agents can ingest photos attached to client interactions (e.g., electrician uploads photo of a wiring issue, cosmetician uploads before/after photos)
**And** visual intelligence processes photos over time to build a knowledge base: problem → diagnosis → solution → tools used (e.g., electrician: "burned outlet → replace 20A GFCI → 12/2 Romex, GFCI outlet, wire nuts")
**And** for recurring clients, agents track preferences and history (e.g., barber: "Mike — #2 fade, medium on top, every 3 weeks"; cosmetician: "Sarah — balayage, toner 9V, allergic to PPD")
**And** client profiles inform future service recommendations ("Last time we used X approach for this issue — here's what worked")
**And** profiles improve via a feedback loop: agent suggests → owner confirms/corrects → agent learns
**And** photo-based pattern recognition improves with volume (more photos of similar problems = higher confidence diagnosis)
**And** client profiles are tenant-scoped — one business owner's client data is never visible to another
**And** the Axis team knows to build client profile capabilities based on the business type from onboarding (e.g., visual trades get photo intelligence, service businesses get preference tracking)
**And** all client profile data respects privacy governance rules

### Story 2b.2: Business Intelligence & Actionable Insights

As a **business owner**,
I want my agents to proactively surface business insights with specific, actionable recommendations,
So that I grow my business based on data patterns I wouldn't have noticed myself.

**Acceptance Criteria:**

**Given** agents have been running and accumulating data (client profiles, scheduling patterns, revenue signals)
**When** an agent detects a meaningful business pattern
**Then** the agent generates a specific, actionable insight — not a generic alert
**And** insights include seasonal analysis: "Your December bookings are 3x your average — consider running targeted ads in November to fill January"
**And** insights include gap analysis: "Tuesday afternoons have 60% vacancy — here's a 20% returning-client promo draft for Tuesdays"
**And** insights include client behavior: "12 clients haven't booked in 60+ days — here's a re-engagement email draft"
**And** insights include revenue optimization: "Your average service price is $45 — consider a premium tier at $65 for specialized services based on your booking patterns"
**And** insights correlate data across agents: scheduling agent spots empty slots → marketing agent drafts targeted promo → website agent publishes the offer → customer service agent follows up
**And** each insight includes: what was detected, why it matters, recommended action, estimated impact, confidence level
**And** insights are calibrated to the business type (electrician gets job-type trends, cosmetician gets client preference patterns, restaurant gets reservation/review trends)
**And** the owner can approve, dismiss, or modify recommended actions
**And** approved actions execute through the appropriate agent's output channels (email, SMS at Growth, social at Growth)
**And** all insight generation is tenant-scoped and audit-logged

### Story 2b.3: Mobile Device Integration & Messaging Channels

As a **business owner**,
I want my agents to reach me through my phone — WhatsApp, text messages, and calendar,
So that I can interact with my AI agents seamlessly from wherever I am.

**Acceptance Criteria:**

**Given** agents are running and producing briefings, insights, alerts, and action requests
**When** the business owner is on their mobile device
**Then** agents can send and receive messages via **WhatsApp Business API** (text, images, quick-reply buttons)
**And** agents can send **SMS text messages** for critical alerts, appointment reminders, and time-sensitive notifications (via Twilio or equivalent)
**And** agents can create, update, and read **calendar events** on iOS (Apple Calendar) and Android (Google Calendar) via CalDAV/Google Calendar API
**And** the business owner can respond to agent messages via WhatsApp (approve actions, answer questions, provide feedback)
**And** WhatsApp serves as a conversational interface — the owner can ask their agents questions and receive answers in the chat
**And** calendar integration syncs bidirectionally: agent creates appointment → appears on phone; owner creates appointment on phone → agent is aware
**And** message routing respects the owner's preferences: urgent = SMS, routine = WhatsApp, scheduling = calendar
**And** notification preferences are configurable: quiet hours, message frequency limits, channel preferences per notification type
**And** the Axis team determines which mobile channels to enable based on the business type from onboarding (e.g., appointment-based businesses get calendar + SMS reminders by default)
**And** all mobile messaging is tenant-scoped — messages for one business never route to another
**And** message history is logged and accessible via the web dashboard
**And** integration works on both iOS and Android without a native app (leverages WhatsApp + native calendar + SMS)
**And** all mobile interactions are audit-logged

### Story 2b.4: Telephony Integration & Inbound Call Routing

As a **business owner**,
I want a phone number for my business that AI can answer,
So that clients can reach my business by phone even when I'm busy.

**Acceptance Criteria:**

**Given** agents are running and the communication channel abstraction exists
**When** a business phone number is provisioned
**Then** telephony integration uses Twilio Voice (or Vapi) with a dedicated phone number per tenant
**And** inbound calls are routed to the tenant's voice agent
**And** the voice agent answers with a customizable greeting per business
**And** the agent can answer common business questions: hours, services, pricing, location, availability
**And** the agent can take messages for requests requiring the owner's attention
**And** the agent escalates to the owner for: complex requests, complaints, VIP clients, emergencies — per governance rules
**And** call transcriptions are generated and logged
**And** the owner can review call summaries in their briefing or WhatsApp
**And** voice minutes are tracked in usage_events for billing
**And** all voice interactions are tenant-scoped and audit-logged
**And** supports English at MVP; multilingual at Growth

### Story 2b.5: Voice Appointment Scheduling

As a **business owner**,
I want my AI to book appointments by phone,
So that clients can schedule without me having to answer.

**Acceptance Criteria:**

**Given** telephony integration from Story 2b.4 and calendar sync from Story 2b.3 exist
**When** a client calls to schedule an appointment
**Then** the voice agent checks calendar availability in real-time
**And** the agent can schedule, reschedule, and cancel appointments by voice
**And** appointment confirmations are sent to the client via SMS or WhatsApp after booking
**And** the agent recognizes returning clients by phone number and pulls their profile (if Story 2b.1 client profiles exist)
**And** the agent handles voicemail: missed call → AI calls back or sends WhatsApp follow-up
**And** new appointments sync to the owner's mobile calendar

### Story 2b.6: Voice Personality & Client Recognition

As a **business owner**,
I want my phone AI to sound like MY business and recognize my clients,
So that callers get a personalized, on-brand experience.

**Acceptance Criteria:**

**Given** telephony and appointment scheduling from previous stories exist
**When** a returning client calls
**Then** the agent recognizes them by phone number and greets them personally ("Hi Sarah, welcome back! Same balayage as last time?")
**And** the voice agent personality is customizable: name, greeting, tone, industry-appropriate language
**And** the agent speaks naturally — conversational AI, not robotic IVR menus
**And** the Axis team configures voice capabilities based on business type from onboarding

### Story 2b.7: Client Website Generation & Deployment

As a **business owner**,
I want WisdomWorks to build and manage a website for my business,
So that I have a professional web presence without hiring a developer.

**Acceptance Criteria:**

**Given** the business owner's AxisDeploymentSpec indicates they need a website and a Website Manager agent is provisioned
**When** the Website Manager agent builds the site
**Then** a Next.js site is generated from an industry-specific template (salon booking page, electrician service page, restaurant menu/reservations, etc.)
**And** the site is deployed to Vercel via API as a tenant-scoped project
**And** the client gets a subdomain (businessname.wisdomworks.com) immediately
**And** the client can connect a custom domain (salonbella.com) via Vercel domain configuration
**And** the site includes: business info, services/pricing, contact form (routes to agent pipeline), booking widget (powered by Scheduler agent), hours, location
**And** the Website Manager agent manages content: updates hours, publishes promos from Marketing agent, adds seasonal content
**And** the site is mobile-responsive and SEO-optimized from the template
**And** site changes are auditable — all edits logged with agent ID and timestamp
**And** the website connects to all other agents via signals: Marketing pushes promos, Scheduler powers bookings, Customer Service handles contact form submissions
**And** the site is tenant-scoped — each business gets their own isolated Vercel project
**And** site hosting costs are included in the client's monthly subscription

### Story 2b.8: Embeddable Widgets for Existing Websites

As a **business owner with an existing website**,
I want to add WisdomWorks capabilities to my current site without rebuilding it,
So that my AI agents work with my existing web presence.

**Acceptance Criteria:**

**Given** the business owner already has a website (Wix, WordPress, Squarespace, custom) and their AxisDeploymentSpec indicates "connect" mode
**When** embeddable widgets are configured for their tenant
**Then** a **booking widget** is available as an iframe or JS snippet — powered by the Scheduler agent, shows real-time availability, handles appointment booking
**And** a **chat widget** is available as a JS snippet (similar to Intercom/Drift) — powered by the Customer Service agent, handles client inquiries in real-time
**And** a **contact form webhook** allows existing contact forms to route submissions to the agent pipeline instead of email
**And** each widget authenticates via a tenant-scoped API key (no client-side secrets)
**And** widgets are styled to match the client's existing site (configurable colors, fonts, positioning)
**And** widget interactions are logged and visible in the owner's dashboard and WhatsApp activity feed
**And** a **REST API** is available for clients with custom apps: tenant-scoped endpoints for bookings, client profiles, agent queries, authenticated via API key + tenant ID
**And** API documentation is auto-generated and accessible from the owner's dashboard
**And** all widget and API interactions are tenant-isolated and audit-logged

---

## Epic 3: Operations Console & Intelligence Dashboard

**Sprint:** 3
**Goal:** Devon (and future customers) can monitor, manage, and demonstrate the entire platform. New customers onboard through the public website. Showcase = the product onboarding itself.
**FRs covered:** FR37-FR44, FR68-FR75, FR85, FR89-FR90, FR136-FR149, FR150-FR163, FR167-FR170

### Story 3.1: Admin Portal Shell & Navigation

As a **platform operator**,
I want a responsive admin portal with role-based navigation,
So that I can access all management functions from a single interface.

**Acceptance Criteria:**

**Given** the `apps/web` Next.js application exists from Epic 0
**When** the admin portal is built
**Then** a sidebar navigation provides access to: Overview, Dashboards, Agents, Governance, Innovation, Tenants, Engagements, Settings
**And** navigation is RBAC-gated — users only see sections matching their role permissions (NFR15)
**And** the design system uses shadcn/ui components from `packages/ui`
**And** neumorphic + glassmorphic design tokens are applied per UX design spec
**And** the portal is desktop-first responsive (5 breakpoints from 1440px+ to <768px) (NFR32)
**And** no spinning loaders — skeleton/shimmer loading states only
**And** maximum ONE primary action per surface; destructive actions require confirmation
**And** full keyboard navigation for all interfaces (NFR29)
**And** screen reader compatibility (NVDA, VoiceOver) (NFR30)
**And** sufficient color contrast ratios (4.5:1 normal, 3:1 large text) (NFR31)
**And** dashboard pages load within 3 seconds (NFR4)

### Story 3.2: Environment Overview & Agent Health

As a **platform operator**,
I want a real-time overview of system health and agent status,
So that I can quickly identify issues across the platform.

**Acceptance Criteria:**

**Given** the admin portal shell from Story 3.1 exists and agents are running
**When** the operator views the Environment Overview
**Then** a system health summary shows: total agents running, healthy/unhealthy/paused counts, signal throughput, active tenants
**And** agent status cards display: agent name, role, current state, last activity, model provider, health indicators
**And** Axis team progress is visible: onboarding status, ontology completion, deployment pipeline stages (FR137)
**And** data flow visualization shows signals moving between agents (FR141)
**And** alerts surface for: unhealthy agents, governance violations, error spikes, approaching capacity (FR142)
**And** the overview auto-refreshes via SSE (real-time, not polling)
**And** complex dashboard views load within 5 seconds (NFR4)
**And** all data is tenant-scoped — operators see only their tenant's data

### Story 3.3: Dashboard Views — Individual, Team, Enterprise

As an **employee or manager**,
I want role-appropriate dashboard views showing my relevant intelligence,
So that I see the insights that matter to my scope of responsibility.

**Acceptance Criteria:**

**Given** agents are running and producing ontology-mapped data
**When** a user accesses their dashboard
**Then** **Individual view** shows: personal agent briefing, tasks, calendar, recent signals, email activity summary
**And** **Team view** shows: team agent roster, cross-agent discoveries, shared tasks, team performance metrics
**And** **Enterprise view** shows: organization-wide intelligence, department connections, innovation pipeline, aggregate trends
**And** dashboards display ontology-mapped data extracted from the email stream (FR35)
**And** historical trends are visualizable over time (FR44)
**And** dashboard data accuracy reaches 95%+ within 30 days (NFR5)
**And** views are RBAC-gated — employees see individual, managers see team, admins see enterprise
**And** all dashboard data is tenant-scoped

### Story 3.4: Real-Time Agent Activity Feed

As a **platform operator**,
I want a live feed of agent actions, signals, and decisions,
So that I can observe the platform operating in real time.

**Acceptance Criteria:**

**Given** agents are running and the SSE bridge from Story 0.4 exists
**When** the operator views the activity feed
**Then** events stream in real-time: agent actions, signal sends/receives, governance evaluations, BMAD detections, errors
**And** each event shows: timestamp, agent name, action type, target, result, governance decision
**And** events are filterable by: agent, action type, severity, time range
**And** the feed supports pause/resume for analysis
**And** clicking an event expands full details including audit log entry
**And** the feed respects tenant isolation — only shows current tenant's events
**And** showcase mode = the platform operating on live data (FR85)
**And** performance at or better than standard targets in showcase mode (NFR10)

### Story 3.5: Agent Lifecycle Management

As a **platform operator**,
I want to deploy, pause, restart, update, and decommission agents through the UI,
So that I have full control over the agent fleet.

**Acceptance Criteria:**

**Given** agents exist in `agent_instances` and `agent_configs`
**When** the operator uses the Agent Management interface
**Then** agents can be deployed from approved AxisDeploymentSpec (FR150)
**And** a provisioning workflow with approval chain exists for new agents (FR151-FR152)
**And** deployment tracking shows pipeline status for each agent (FR153)
**And** agents can be paused (stops processing, retains state), resumed, and restarted
**And** agent configuration can be updated: model routing, governance rules, output channels (FR69-FR71)
**And** the ontology can be extended via admin UI without disrupting active agents (FR70)
**And** model swaps can be performed per agent per task via the UI (FR69)
**And** BMAD-driven platform updates are surfaceable and actionable (FR68)
**And** all lifecycle actions are audit-logged
**And** all operations are tenant-scoped

### Story 3.6: Governance Framework UI

As a **platform operator**,
I want to manage governance rules, view violations, and browse audit trails through the UI,
So that I can enforce and monitor compliance across all agents.

**Acceptance Criteria:**

**Given** governance tables from Story 0.8 and the admin portal exist
**When** the operator uses the Governance interface
**Then** allow/deny rules can be created, edited, activated, and deactivated per agent or globally (FR154-FR155)
**And** rules support per-instance configuration — different tenants can have different rule sets (FR158)
**And** runtime enforcement is visible: the UI shows which rules are currently active and their evaluation counts (FR156)
**And** a violation viewer shows all governance violations with: timestamp, agent, action, rule violated, outcome (FR159)
**And** audit trail browser allows searching and filtering all logged events by agent, action, time range, resource (FR160)
**And** governance rules can be hot-updated without restarting agents (FR161)
**And** an export function allows downloading audit data for compliance reporting (FR143)
**And** 100% audit coverage is verifiable through the UI (NFR14)
**And** all governance data is tenant-scoped

### Story 3.7: BMAD Solution Brief Review Interface

As a **business owner**,
I want to review, approve, and act on innovation proposals from my agents,
So that AI-discovered improvements are implemented with my oversight.

**Acceptance Criteria:**

**Given** BMAD innovation engine from Story 2.11 is generating solution briefs
**When** the owner views the Innovation interface
**Then** pending solution briefs are listed with: title, agent source, confidence score, expected impact, recommended action
**And** the owner can approve (agent implements), dismiss (with reason), or modify the proposal
**And** approved briefs are tracked through implementation to measured results
**And** cross-agent discoveries are highlighted — insights connecting multiple agents' findings (FR61)
**And** innovation proposals are tracked organization-wide (FR60)
**And** historical briefs show outcome data: was the prediction accurate? did the action produce results?
**And** at autonomy L3-L4, low-risk auto-implemented actions are shown retroactively with results
**And** all innovation data is tenant-scoped

### Story 3.8: Tenant Management & Deployment Tracking

As a **platform operator (Devon)**,
I want to see all tenant deployments, their status, billing, and trial timelines,
So that I can manage the platform's customer base.

**Acceptance Criteria:**

**Given** tenants exist from the onboarding pipeline (Epic 1)
**When** Devon views the Tenant Management interface
**Then** all tenants are listed with: name, industry, blueprint, status (onboarding/provisioning/active/suspended), deployment date, trial end date
**And** each tenant's AxisDeploymentSpec is viewable: agent roster, surfaces, integrations, pricing
**And** billing status shows: deposit paid, current monthly cost, trial remaining, payment status
**And** deployment tracking shows the provisioning pipeline stages for each tenant
**And** Devon can suspend, reactivate, or decommission tenants
**And** aggregate metrics show: total tenants, total agents, total revenue, average deployment time
**And** this view is restricted to platform-level admin role (Devon) — not visible to individual tenant operators

### Story 3.9: Consulting Engagement Management

As a **platform operator (Devon)**,
I want to manage consulting engagements with client isolation and lifecycle tracking,
So that each client engagement is properly scoped, tracked, and governed.

**Acceptance Criteria:**

**Given** tenants and their deployments exist
**When** Devon manages consulting engagements
**Then** client data isolation is enforced — each engagement is a separate tenant with zero cross-visibility (FR167, NFR19)
**And** engagement lifecycle tracking shows: discovery → proposal → active → review → complete (FR168)
**And** autonomy boundaries can be configured per engagement — consulting clients may want more human oversight (FR169)
**And** escalation paths are defined: agent escalates to Devon when confidence is low or action is high-impact (FR170)
**And** error handling surfaces extraction and cross-agent communication failures with recovery options (FR89-FR90)
**And** all engagement data is tenant-scoped

### Story 3.10: Public Website & Onboarding Entry Point

As a **potential customer**,
I want to visit the WisdomWorks website and start the AI onboarding process,
So that I can evaluate and deploy the platform for my business.

**Acceptance Criteria:**

**Given** the `apps/website` Next.js application exists from Epic 0
**When** a visitor arrives at the WisdomWorks public website
**Then** the website displays: product information, capabilities, customer spectrum (solo to enterprise), deployment tiers (FR147)
**And** pricing is displayed transparently: tier descriptions, starting prices, "exact price determined during onboarding" (FR149)
**And** a prominent "Get Started" action enters the AI onboarding conversation from Epic 1 (FR148)
**And** the onboarding entry point creates a new tenant and begins Story 1.6's conversational flow
**And** the website is SEO-optimized and fast-loading
**And** the website requires only hosting — no additional integrations (NFR44)
**And** the website is accessible (WCAG 2.1 AA) (NFR27)

---

## Epic 4: 3D Intelligence Globe

**Sprint:** 3-4
**Goal:** Organizational intelligence explored through interactive 3D visualization — deployed only when the Axis team determines it adds value based on org size, complexity, and business type. Not every customer gets a globe. When the globe is not deployed, tabular views and data cards serve as the primary intelligence interface.
**FRs covered:** FR37-FR41 (visualization subset)
**Deferred:** Full semantic zoom (L4-L5), 7 particle-flow connection types, saved lenses

### Story 4.1: Globe Renderer & Entity Visualization

As a **platform operator**,
I want a 3D globe rendering organizational entities in interactive 3D space,
So that I can visually explore the organization's structure and intelligence.

**Acceptance Criteria:**

**Given** ontology entities exist from Epic 1/2 and the `packages/globe` workspace exists
**When** the globe component renders
**Then** R3F (React Three Fiber) / Three.js renders a globe visualization in the Command Deck layout (center-left of screen, 380px collapsible sidebar)
**And** ontology entities are rendered as nodes positioned in 3D space based on organizational relationships
**And** node size, color, and shape encode entity type (employees, departments, projects, clients, etc.)
**And** camera controls support: orbit, zoom (L0 organization → L3 individual level), pan
**And** nodes are interactive: hover shows entity name/type, click opens detail panel in sidebar
**And** the globe loads within 5 seconds (NFR6)
**And** entity data is fetched from the tenant-scoped ontology via tRPC
**And** the globe renders correctly at all 5 breakpoints (1440px+ down to <768px where globe collapses to 2D)
**And** the globe is conditionally rendered — only deployed when `AxisDeploymentSpec.surfaces.globe = true`
**And** the Axis team enables the globe based on business type and org complexity during onboarding (e.g., enabled for consulting firms, fleet operations, manufacturing; disabled for solo service providers)
**And** when the globe is not deployed, the dashboard provides the same intelligence through tabular views and data cards (Story 4.5's alternatives become the primary view)

### Story 4.2: Connection Lines & Relationship Display

As a **platform operator**,
I want relationships between entities displayed as visual connections on the globe,
So that I can see how people, projects, and capabilities relate.

**Acceptance Criteria:**

**Given** the globe renderer from Story 4.1 is displaying entity nodes
**When** relationships exist in the ontology
**Then** relationships are rendered as lines connecting entity nodes
**And** line color indicates relationship type: reports_to, works_on, manages, collaborates_with, owns, depends_on
**And** line opacity or thickness indicates relationship confidence/strength
**And** hovering a connection line shows the relationship type and metadata
**And** clicking a node highlights all its connections (dims unrelated nodes/lines)
**And** the sidebar shows a list of connections for the selected entity
**And** connection rendering scales to the ontology size without performance degradation

### Story 4.3: Connected/Fractured Toggle & Animation

As a **platform operator**,
I want to toggle between a connected organization view and an exploded fractured view,
So that I can see the organization as a whole or explore individual clusters.

**Acceptance Criteria:**

**Given** the globe with entities and connections from previous stories
**When** the user toggles connected/fractured mode
**Then** **Connected mode** shows all entities tightly grouped with visible relationship lines — the organization as a cohesive whole
**And** **Fractured mode** explodes entities into clusters (by department, project, or function) with space between groups
**And** connected → fractured animation takes 2-3 seconds with smooth easing
**And** fractured → connected animation takes 1.5 seconds
**And** animations respect `prefers-reduced-motion` OS setting — instant switch with no animation (WCAG)
**And** the toggle is a prominent UI control in the Command Deck
**And** explode animations complete within 2 seconds (NFR6)

### Story 4.4: Quality Tier System & GPU Detection

As a **platform operator**,
I want the globe to automatically adjust rendering quality based on my device's GPU,
So that the visualization performs well on any hardware.

**Acceptance Criteria:**

**Given** the globe renderer exists
**When** the component initializes
**Then** GPU capability is detected (WebGL capabilities, VRAM estimate, renderer string)
**And** three quality tiers are available: **Full** (all effects, shadows, anti-aliasing), **Reduced** (simplified lighting, fewer particles, lower resolution), **Minimal** (basic geometry, no effects, wire-frame connections)
**And** the tier is auto-selected based on GPU detection
**And** the user can manually override the auto-detected tier
**And** tier transitions are seamless — no page reload required
**And** all three tiers maintain usability — entities and connections are always readable
**And** the globe remains functional on integrated GPUs (Intel HD/UHD) at Minimal tier

### Story 4.5: Intelligence Views — Tabular, Cards & Accessible Alternatives

As a **business owner or platform operator**,
I want to explore organizational intelligence through tables, cards, and natural language queries — with or without the 3D globe,
So that intelligence is accessible to every customer regardless of deployment type or ability.

**Acceptance Criteria:**

**Given** ontology entities and relationships exist
**When** the user accesses the intelligence view
**Then** **Tabular view:** all entity and relationship data is available as searchable, sortable, filterable tables (NFR28)
**And** **Card view:** entities displayed as cards with key metadata, grouped by type/department/project — the default for non-globe deployments
**And** **Query integration:** natural language queries highlight relevant entities in whichever view is active (globe, table, or cards)
**And** when the globe is deployed, query results animate into focus on the globe and show structured results in sidebar
**And** when the globe is NOT deployed, query results highlight in the card/table view — full intelligence exploration without 3D
**And** screen readers receive meaningful descriptions of the intelligence state ("45 entities, 12 departments, 3 matching your query") (NFR30)
**And** keyboard navigation allows traversing all entities and connections without mouse (NFR29)
**And** high contrast mode is supported for all views (NFR31)
**And** the card/table views are first-class interfaces — not accessibility afterthoughts
**And** all intelligence views are tenant-scoped

---

## Epic 5: Desktop Agent & Tauri Shell

**Sprint:** 4
**Goal:** The AI agent lives on the desktop. Basic Tauri shell with chat and terminal channels.
**FRs covered:** FR94-FR101 (subset), FR104-FR113 (subset)
**Deferred:** Outlook integration, app control, remote commands (FR114-FR121), passive observation mode (FR122-FR128)

### Story 5.1: Tauri App Shell & Web View

As an **employee**,
I want a desktop application that hosts my AI agent interface,
So that I can access my agent without opening a browser.

**Acceptance Criteria:**

**Given** the `apps/desktop` Tauri v2 workspace exists from Epic 0
**When** the Tauri app is built and launched
**Then** the app renders the `apps/web` dashboard in a native window via WebView
**And** the app supports Windows and macOS (Linux at Growth)
**And** the app authenticates using the same Auth.js session as the web app
**And** the app window is resizable with a minimum size that maintains usability
**And** the app has a system tray icon for quick access
**And** the app starts on OS login (configurable)
**And** the app auto-updates when new versions are available
**And** the app connects to the same backend services as the web dashboard
**And** all data displayed is tenant-scoped

### Story 5.2: Desktop Chat Window

As an **employee**,
I want a dedicated chat window to converse with my personal agent on the desktop,
So that I can interact with my AI agent quickly without navigating the full dashboard.

**Acceptance Criteria:**

**Given** the Tauri shell from Story 5.1 is running and the user has a personal agent
**When** the user opens the chat window (hotkey or tray icon)
**Then** a lightweight chat interface opens — separate from the full dashboard
**And** the chat connects to the user's personal agent from Epic 2
**And** the user can ask questions, request tasks, approve actions, and review briefings via chat
**And** the agent responds with context from the ontology, signals, and ongoing tasks
**And** chat history persists across sessions (stored via agent state persistence, Story 2.10)
**And** the chat supports markdown rendering for formatted responses
**And** the chat window can be pinned (always-on-top) or minimized to tray
**And** unified logging: chat interactions appear in the agent activity feed (Story 3.4)
**And** all chat data is tenant-scoped

### Story 5.3: Terminal Channel

As a **technical user**,
I want a terminal interface for direct agent commands,
So that I can interact with my agent programmatically and efficiently.

**Acceptance Criteria:**

**Given** the Tauri shell from Story 5.1 is running
**When** the user opens the terminal channel
**Then** a terminal-style interface allows text-based agent commands
**And** commands support: agent status queries, task creation, signal inspection, governance rule checks
**And** output is formatted for terminal readability (structured text, tables, color coding)
**And** the terminal supports command history (up/down arrows)
**And** the terminal can be used alongside the chat window and dashboard
**And** terminal interactions are logged to the unified activity feed
**And** the terminal is optional — accessible via settings or hotkey, not shown by default
**And** all terminal data is tenant-scoped

### Story 5.4: Cross-Channel Agent Interaction & Unified Logging

As an **employee**,
I want my agent interactions across all active channels to be unified,
So that my agent has full context regardless of which channel I use.

**Acceptance Criteria:**

**Given** the user interacts with their agent across multiple channels
**When** the user switches between channels
**Then** the agent maintains context across all ACTIVE channels for that tenant — web, desktop, and any mobile/voice channels enabled in their AxisDeploymentSpec
**And** a task started in one channel can be continued in any other active channel
**And** all interactions across all channels are logged to a unified activity stream
**And** the unified log is viewable in the admin portal (Story 3.4) and in the desktop chat history
**And** channel metadata is captured: which channel, timestamp, device info
**And** the agent references previous interactions regardless of channel ("You asked about this on WhatsApp earlier — here's the update")
**And** if the user has multiple active channels, notification deduplication prevents the same message from being pushed to all channels simultaneously
**And** all cross-channel data is tenant-scoped and audit-logged

---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
lastStep: 8
status: 'complete'
completedAt: '2026-03-23'
inputDocuments:
  - "prd.md"
  - "product-brief-devon-2026-02-12.md"
  - "ux-design-specification.md"
workflowType: 'architecture'
project_name: 'WisdomWorks'
user_name: 'Devon'
date: '2026-02-27'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**

170+ functional requirements span three capability layers:

- **Layer 1 — Email Intelligence & Organizational Knowledge (50+ FRs):** Ontology construction by Axis team with peer-review validation, email classification with confidence scoring, signal-based agent-to-agent communication (never raw content), cross-environment signal routing governance, BMAD innovation engine, integration layer (email, directory, HR, project management, document management), role agent derivation from ontology, Founder Agent orchestration of role agents
- **Layer 2 — Desktop Agent & Productivity Assistant (60+ FRs):** Three interaction channels (email-as-correspondent, desktop chat, terminal), personal agent capabilities (briefing, response drafting, report assembly, calendar awareness, career development, mistake prevention), Desktop Agent Runtime (application control, VS Code integration, Outlook embedding, persistent cloud connection), Remote Agent Command (external email authentication, multi-instruction parsing), Passive Agent Mode (observation, suggestion, configurable frequency), agent state persistence with cloud sync and rollback, artifact generation (PowerPoint, Excel, Word, PDF), **document text extraction** (agents ingest and extract text from PDFs, Word, Excel, images via OCR, and scanned documents — feeding ontology, knowledge base, and artifact generation pipelines)
- **Layer 3 — Operations Console (30+ FRs):** Admin portal (instance overview, Axis team metrics, ontology browsing, agent deployment status, data flow visualization), public website (product info, pricing, onboarding entry points), dashboards with 5 perspective views (individual through enterprise), 3D interactive visualization with explode animations, agent deployment workflow with approval chains, engagement lifecycle tracking
- **Cross-Cutting (40+ FRs):** Agent governance framework (configurable allow/deny policies per action, runtime enforcement, governance rule hot-updates), compliance (privacy-first filtering, FIPS encryption, audit logging, Section 508), error handling with graceful recovery, showcase/demonstration mode, multi-instance deployment with canonical identity model

**Non-Functional Requirements:**

- **Performance:** Email classification <5s, batch 500 emails <15min, morning briefing within 5min of schedule, dashboard <3s, 3D load <5s, artifact gen <2min, agent-to-agent signals <60s, classification accuracy 90%→95%
- **Security:** FIPS 140-2/140-3 encryption, defense-in-depth privacy SLA, 100% audit coverage, RBAC with least-privilege, NIST SP 800-53 aligned session security, zero cross-client data visibility
- **Scalability:** 1 user (PoC) → 13 users (MVP) → 500+ per instance (Growth), 10,000+ ontology entities, 1,000+ emails/hour, 10,000+ signals/day
- **Reliability:** 99.5% uptime (MVP), agent restart <2min with zero signal loss, at-least-once signal delivery, atomic ontology writes, 3-tier graceful degradation
- **Accessibility:** WCAG 2.1 AA on all interfaces, 3D visualization text alternatives, keyboard navigation, screen reader support
- **Integration:** Near-real-time email event processing, directory sync daily with 4hr delta, financial sync daily, webhook resilience with exponential backoff

**Scale & Complexity:**

- Primary domain: Full-stack (desktop + web + WebGL + cloud + AI orchestration)
- Complexity level: **Enterprise-grade** — multi-instance isolation, government compliance path, real-time agent orchestration, 3D rendering with layer compositor
- Estimated architectural components: 8-12 major subsystems (ontology engine, signal layer, agent runtime, classification pipeline, desktop runtime, globe renderer, admin console, integration adapters, governance engine, model abstraction, identity management, audit system)

### AIaaS Architectural Implications

WisdomWorks operates as an **AI as a Service (AIaaS)** platform — organizational intelligence delivered through cloud-hosted AI agents on a managed service model. This shapes the architecture beyond standard SaaS:

- **Tenant provisioning automation:** Programmatic instance creation with Axis team bootstrapping workflow — ontology construction, agent deployment, integration discovery as an automated pipeline, not a manual setup
- **Usage metering & billing hooks:** Agent interaction counts, signal processing volumes, connections discovered, and value-delivered metrics per engagement — metering infrastructure must be architectural, not bolted on
- **SLA enforcement per instance:** Performance targets, uptime guarantees, and data isolation verified per tenant — monitoring and alerting scoped to each instance independently
- **White-label theming capability:** CSS custom property architecture (`:root` token overrides) already supports per-instance branding — client organizations get their own color palette without code changes
- **Self-service onboarding pipeline:** Growth-phase capability where organizations can initiate their own Axis team deployment — requires a structured onboarding workflow exposed as a service, not an internal tool
- **Service delivery metrics:** Per-engagement health views, not just per-agent — connections discovered, silos bridged, value recovered tracked at the engagement level for client reporting

### UX Architectural Implications

The UX specification drives several critical architectural decisions:

- **Globe layer compositor:** Each visualization concern (org intelligence, entity rendering, planning, query highlights) is a discrete render layer with its own draw call budget — requires a render pipeline architecture, not a monolithic canvas
- **Ontology-driven polymorphic rendering:** The globe renders whatever entity types the ontology discovers — requires a federated type registry with runtime extension and a single polymorphic renderer component
- **Three visual depth layers:** Cinematic background → gradient wash → frosted glass UI → requires GPU-aware quality tier system with runtime detection (`useQualityTier()` hook)
- **DOM overlay on WebGL:** Neumorphic satellite controls rendered as DOM elements positioned over WebGL canvas via `GlobeControlsLayout` bridge — requires canvas-relative position computation via ResizeObserver
- **Exploded semantic zoom (L0-L5):** Recursive explosion animations with spatial memory per level — requires a zoom state machine with level-specific rendering and layout persistence
- **AI query → globe visualization pipeline:** Agent produces a `GlobeQueryDirective` that applies highlight sets, dim masks, zoom/rotate commands — requires a directive protocol between conversation engine and globe renderer
- **Desktop app + web app sharing one component library:** Electron/Tauri desktop and web browser share identical React components with quality tier branching
- **Attention-aware motion system:** Ambient motion pauses during interaction, resumes on idle — requires user engagement state detection feeding into motion token resolution

### Technical Constraints & Dependencies

- **Email access is a gating dependency** — programmatic access to Outlook/Exchange must be confirmed before engineering starts (pre-MVP discovery milestone)
- **FIPS 140-2/140-3 encryption from day one** — cannot be retrofitted; must use validated cryptographic modules in all data paths
- **NIST SP 800-53 control families** (AC, AU, IA, SC, SI) as security design framework — not optional, they shape authentication, audit, and access control architecture
- **Model abstraction layer** — must support multi-model (different models per task type), config-based swapping, zero vendor lock-in
- **Radix UI + Tailwind CSS + shadcn/ui** committed as the design system foundation (per UX spec)
- **Geist Sans/Mono** as typeface (per UX spec)
- **Azure Government** (IL5) and Azure Government Secret (IL6) as government deployment targets
- **Pre-computed 3D snapshots at MVP** — real-time streaming deferred to Growth
- **13 concurrent users per instance** at MVP; architecture must support 500+ without rearchitecture

### Cross-Cutting Concerns Identified

1. **Privacy enforcement** — defense-in-depth: classification + confidence scoring + monitoring/QA agent team + purge capability. Privacy boundary is structural, not policy-based
2. **Agent governance** — configurable allow/deny per action category, runtime enforcement (not post-hoc), hot-updatable rules, complete audit trail
3. **Multi-instance isolation** — separate ontology, signal layer, agent population per instance. Same pattern for client isolation and government classification boundaries
4. **Canonical identity model** — one person, multiple environment-scoped profiles, each with own email identity and agent instance
5. **Audit logging** — 100% coverage of agent actions, signal processing, admin operations, governance evaluations. NIST AU control family compliant
6. **Quality tier system** — full/reduced/minimal rendering affecting glassmorphism blur, particle counts, globe FPS, background rotation. Runtime GPU detection
7. **Graceful degradation** — 3-tier degradation for partial outages (core → reduced → minimal). Desktop agent handles intermittent connectivity (local caching, reconnection)
8. **Ontology-driven everything** — entity types, visualization rendering, agent capabilities, knowledge boundaries, and exploded zoom depth are all derived from the ontology. The ontology IS the system's source of truth
9. **Document text extraction** — agents must ingest and extract text from documents (PDFs, Word, Excel, images via OCR, scanned documents). This feeds the ontology, knowledge base, and artifact generation pipelines. Extraction must handle organizational document formats and integrate with the privacy classification boundary (personal documents filtered before extraction)
10. **AIaaS delivery model** — tenant provisioning, usage metering, SLA enforcement, white-label theming, and service delivery metrics are architectural concerns, not features to bolt on later

### Architectural Pattern Recommendations

Based on the requirements analysis, four architectural patterns should be considered early:

1. **Event-driven backbone** — the signal layer, agent-to-agent communication, governance enforcement, and real-time globe updates all point toward an event-driven architecture (message bus/event streaming). The signal layer IS an event bus. Agent actions, governance evaluations, classification decisions, and ontology changes are all events that multiple consumers need to react to. Designing this as the backbone avoids retrofitting pub/sub patterns into a request-response architecture.

2. **API gateway / service boundary** — with multi-instance isolation, AIaaS delivery, desktop runtime ↔ cloud, and web dashboard all hitting backend services, a clear API surface with per-instance routing is essential. The gateway enforces tenant isolation, metering, rate limiting, and authentication at the edge before requests reach service logic.

3. **Offline-first desktop strategy** — the PRD specifies "intermittent connectivity" and "local caching" for the Desktop Agent Runtime. Architecturally this requires a defined sync protocol: local-first operation with conflict resolution, command queue management (Remote Agent Commands queued locally when offline), state reconciliation on reconnection, and a clear split between what requires cloud connectivity and what operates locally. This is significantly harder to retrofit than to design from the start.

4. **Generalized ingestion pipeline** — document text extraction + email classification + directory data + integration feeds all follow the same pattern: ingest → classify (privacy boundary) → extract structured data → map to ontology → emit signals. A single pipeline architecture with pluggable input adapters (email adapter, document adapter, directory adapter, API feed adapter) avoids building parallel ingestion systems. Each adapter handles format-specific extraction; the pipeline handles classification, ontology mapping, and signal emission uniformly.

## Starter Template Evaluation

### Technical Preferences

Devon has no hard technology commitments — preference is "the best tools that get to the goal." Familiar with Next.js from another project. No database, package manager, auth, or deployment preferences. Open to polyglot approach.

### Primary Technology Domain

**Full-stack polyglot** — TypeScript (frontend + API layer) + Python (AI agent orchestration) + Rust (desktop shell via Tauri). This is driven by:
- React + shadcn/ui + Tailwind commitment (UX spec) → TypeScript frontend
- Multi-agent orchestration with strongest AI/ML ecosystem → Python
- Desktop runtime with FIPS compliance requirement → Tauri v2 (Rust)

### Starter Options Considered

**Desktop Runtime — Tauri v2 vs Electron:**
- **Tauri v2 (v2.10.3)** — FIPS compliance flag built-in (`TAURI_FIPS_COMPLIANT`), 5-15MB bundle, ~80MB RAM at startup, secure-by-default capabilities model, Rust backend for local agent runtime / terminal / app control. Known concern: WebGL "context lost" errors in 3D-heavy scenes require testing.
- **Electron (v41.0.2)** — No FIPS support (dealbreaker for government deployment path), 80-120MB bundle, 200-500MB RAM, more stable WebGL. 11 years mature.
- **Decision: Tauri v2** — FIPS compliance is a non-negotiable constraint. Electron cannot meet it. WebGL concern mitigated by thorough GPU testing and quality tier fallback system already designed in UX spec.

**Web Framework — Next.js (App Router):**
- App Router is the standard in 2026 (Server Components, Server Functions, built-in layouts/loading/error boundaries)
- Devon already has Next.js experience
- No compelling alternative emerged — Next.js is the right choice

**ORM — Drizzle vs Prisma:**
- **Drizzle (v0.30+)** — 7.4KB vs Prisma's 1.6MB, 2-3x faster complex relational queries, no generation step, direct SQL control. Better for ontology with 10,000+ entities.
- **Prisma v7** — More user-friendly DX, completed Rust-to-TypeScript migration, 85-90% bundle reduction. Still larger and slower than Drizzle for complex queries.
- **Decision: Drizzle** — Superior performance for complex ontology queries with referential integrity. SQL control matters when the ontology is the system's source of truth.

**Event Streaming — NATS JetStream vs Redis Streams vs Kafka:**
- **NATS JetStream** — ~80MB RAM, <5ms latency, 400K+ msgs/sec, zero operational complexity. Scales from 13 to 500+ users without infrastructure overhaul.
- **Kafka** — Millions of msgs/sec but requires 8+ cores, 64-128GB RAM, JVM. Enterprise-grade overkill at MVP scale.
- **Redis Streams** — Suitable for <1M msg/sec but clustering is complex and in-memory limits apply.
- **Decision: NATS JetStream** — Right-sized for MVP → Growth trajectory. Migrate to Kafka only if exceeding 10M msgs/day.

**Agent Orchestration — LangGraph (Python) + Vercel AI SDK (TypeScript):**
- **LangGraph** — Dominant multi-agent framework (47M+ downloads), graph-based state control fits Founder Agent → role agent delegation pattern, production-grade.
- **Vercel AI SDK v6** — TypeScript streaming UX for conversational stream, model-agnostic (supports model abstraction layer requirement), bridges Python agent layer to React frontend.
- **Decision: Hybrid** — Python (LangGraph) for agent orchestration logic, TypeScript (Vercel AI SDK) for frontend delivery and streaming. ~60-70% of 2026 agent startups use this hybrid pattern.

**Auth — Auth.js v5 + Microsoft Entra ID:**
- Self-hosted (data sovereignty for government path), free, native Entra ID provider
- Enterprise SSO ready, NIST SP 800-53 IA control family alignment
- Growth path to multi-tenant with per-instance identity providers

**Offline Sync — PowerSync / ElectricSQL:**
- SQLite ↔ PostgreSQL active-active sync for Desktop Agent Runtime
- Handles offline command queuing, conflict resolution, and reconnection
- PowerSync (commercial, more reliable) or ElectricSQL (open-source, self-hosted) — decision deferred to implementation

**Styling — Tailwind CSS v4:**
- v4.2.0 current (released February 2026), 5x faster full builds, 100x+ faster incremental
- CSS-first `@theme` configuration integrates WisdomWorks design tokens as single source of truth
- Noted as preferred in UX spec if architecture permits — it permits

**Monorepo — Turborepo 2.x + pnpm:**
- Turborepo: Rust-powered, ~2M weekly downloads, simpler than Nx, excellent caching
- pnpm: Best monorepo workspace support, faster and more disk-efficient than npm/yarn
- Python services wrapped with package.json for CI task integration

### Selected Starter: Turborepo Monorepo with Polyglot Services

**Rationale:** WisdomWorks spans three runtime environments (desktop, web, cloud services) with three languages (TypeScript, Python, Rust). A Turborepo monorepo keeps the TypeScript ecosystem (Next.js, React components, Drizzle schema, Auth.js) unified with shared types and builds, while Python agent services and Rust desktop shell are orchestrated as workspace members with package.json wrappers.

**Repository Structure:**

```
wisdomworks/
├── apps/
│   ├── web/              → Next.js (App Router) — Operations Console, dashboards, globe
│   ├── desktop/          → Tauri v2 — Desktop Agent Runtime (chat, terminal, Outlook, app control)
│   └── website/          → Next.js — Public wisdomworks.ai marketing site
├── packages/
│   ├── ui/               → Shared React component library (shadcn/ui + WisdomWorks tokens)
│   ├── db/               → Drizzle ORM schema + migrations (PostgreSQL)
│   ├── auth/             → Auth.js v5 + Microsoft Entra ID configuration
│   ├── shared/           → Shared TypeScript types, constants, utilities
│   └── globe/            → Globe renderer library (Three.js/R3F, layer compositor)
├── services/
│   ├── agents/           → Python — LangGraph agent orchestration (Founder, role agents)
│   ├── signal-layer/     → NATS JetStream event bus configuration + consumers
│   └── ingestion/        → Generalized ingestion pipeline (email, document, directory adapters)
├── turbo.json            → Turborepo pipeline configuration
├── pnpm-workspace.yaml   → Workspace member definitions
└── docker-compose.yml    → Local dev services (PostgreSQL, NATS, PowerSync)
```

**Initialization Commands:**

```bash
# 1. Create Turborepo monorepo
pnpm dlx create-turbo@latest wisdomworks

# 2. Add Next.js app with App Router + Tailwind v4
cd apps/web && pnpm dlx create-next-app@latest . --typescript --tailwind --app --src-dir

# 3. Initialize shadcn/ui in the shared UI package
cd packages/ui && pnpm dlx shadcn@latest init

# 4. Initialize Tauri v2 desktop app
cd apps/desktop && pnpm dlx create-tauri-app@latest . --template react-ts

# 5. Initialize Drizzle + PostgreSQL
cd packages/db && pnpm add drizzle-orm postgres && pnpm add -D drizzle-kit

# 6. Python agent services (separate virtualenv)
cd services/agents && python -m venv .venv && pip install langgraph anthropic

# 7. Local dev services
docker compose up -d  # PostgreSQL + NATS JetStream + PowerSync
```

**Architectural Decisions Provided by Starter:**

- **Language & Runtime:** TypeScript 5.x (strict mode), Python 3.12+, Rust (via Tauri v2)
- **Styling:** Tailwind CSS v4 with `@theme` CSS-first configuration — WisdomWorks design tokens as CSS custom properties
- **Build Tooling:** Turborepo task pipeline, Next.js bundling (Turbopack), Tauri build system, Python packaging
- **Testing:** Vitest (TypeScript unit/integration), pytest (Python agent tests), Playwright (E2E cross-browser)
- **Code Organization:** Monorepo with clear boundaries — `apps/` (deployable), `packages/` (shared libraries), `services/` (backend)
- **Development Experience:** pnpm workspaces, hot reload across apps, Turbo remote caching, Docker Compose for local services
- **Database:** PostgreSQL with Drizzle ORM, managed migrations, type-safe queries
- **Event Backbone:** NATS JetStream for signal layer, agent-to-agent events, governance events
- **API Layer:** Next.js Server Functions + Vercel AI SDK for frontend API, Python FastAPI for agent service endpoints
- **Desktop Shell:** Tauri v2 with Rust commands for local agent runtime, FIPS-compliant builds

**Note:** Project initialization using these commands should be the first implementation story.

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**

- Data modeling approach (typed core tables + JSONB metadata)
- API patterns (tRPC for TS↔TS, REST/OpenAPI for TS↔Python)
- Real-time communication strategy (SSE bridge from NATS)
- 3D rendering library (React Three Fiber)

**Important Decisions (Shape Architecture):**

- Caching strategy (NATS KV for MVP)
- Search approach (PostgreSQL FTS + pgvector)
- State management (Zustand + TanStack Query)
- Globe directive protocol (unidirectional Agent → Directive → Store → R3F)

**Deferred Decisions (Post-MVP):**

- Redis/Valkey for dedicated caching layer (evaluate at 500+ users)
- NATS WebSocket gateway for direct browser↔NATS (evaluate when SSE bridge becomes a bottleneck)
- Elasticsearch/Meilisearch for faceted search (only if PostgreSQL FTS proves insufficient at scale)
- Standalone API server extraction (separate tRPC server from Next.js if independent scaling needed)

### Data Architecture

**Data Modeling — Typed Core Tables + JSONB Metadata:**

- **Decision:** Typed core tables (`entities`, `entity_types`, `relationships`, `relationship_types`, `signals`) with proper indexes and foreign keys, plus `metadata JSONB` column per entity for type-specific attributes
- **Version:** PostgreSQL 16+ with Drizzle ORM v0.30+
- **Rationale:** Relationships between entities are the hot path (globe rendering, agent reasoning) — these must be typed, indexed, and queryable. Entity attributes vary by type and must be extensible without migrations. New entity types are added by inserting a row into `entity_types` registry and defining a Zod schema in application code. Zero migrations for ontology evolution.
- **Affects:** Ontology engine, globe renderer, agent runtime, signal layer, ingestion pipeline
- **Implementation Notes:**
  - GIN index on `metadata` column: `CREATE INDEX idx_entity_metadata ON entities USING GIN (metadata jsonb_path_ops)`
  - Benchmark at 10K entities — if queries exceed 50ms, add materialized views for globe hot path
  - JSONB validation via Zod schemas per entity type at application boundary
  - Drizzle schema location: `packages/db/schema/ontology.ts`

**Caching — NATS KV (MVP):**

- **Decision:** Use NATS JetStream's built-in Key-Value store for MVP caching
- **Version:** NATS Server 2.10+ (KV is a JetStream feature)
- **Rationale:** Zero additional infrastructure — NATS is already running for the signal layer. At 13 users, a dedicated cache server (Redis/Valkey) adds operational overhead for a solo developer with no performance benefit. NATS KV handles session cache, ontology entity cache (hot entities for globe rendering), and agent state cache.
- **Affects:** Session management, globe performance, agent state persistence
- **Growth Path:** Design cache access through an interface (`CacheProvider`) so Redis/Valkey can be swapped in at 500+ users without application changes
- **Provided by Starter:** No — architectural decision

**Search — PostgreSQL FTS + pgvector:**

- **Decision:** PostgreSQL full-text search for keyword queries + pgvector extension with HNSW indexes for AI semantic search
- **Version:** pgvector v0.7+ with HNSW index support
- **Rationale:** One database, one source of truth. No data sync to external search engines. PostgreSQL `tsvector` handles keyword search on 10K entities efficiently. pgvector with HNSW indexes handles semantic similarity queries in sub-10ms at 10K rows. Adding Elasticsearch or Meilisearch introduces another service, another data sync problem, and another failure mode for a solo developer.
- **Affects:** Agent knowledge queries, globe query visualization, admin ontology browsing, document search
- **Implementation Notes:**
  - `CREATE EXTENSION vector`
  - Embedding column: `embedding vector(1536)` (OpenAI) or `vector(768)` (Anthropic)
  - Index: `CREATE INDEX ON entities USING hnsw (embedding vector_cosine_ops)`
  - Query: `ORDER BY embedding <=> $1 LIMIT 10`
  - Drizzle custom type for vector via community packages

### Authentication & Security

Authentication and security decisions were made in the Starter Template Evaluation:

- **Authentication:** Auth.js v5 + Microsoft Entra ID (self-hosted, data sovereignty, NIST IA alignment)
- **Authorization:** RBAC with least-privilege, per-instance identity providers at Growth
- **Encryption:** FIPS 140-2/140-3 via Tauri v2's `TAURI_FIPS_COMPLIANT` flag and Azure's FIPS-validated services
- **Security Framework:** NIST SP 800-53 control families (AC, AU, IA, SC, SI)
- **API Security:** Per-instance tenant isolation at API boundary, JWT-scoped access

No additional security decisions required at this step — these are comprehensive for MVP.

### API & Communication Patterns

**API Pattern — tRPC (TS↔TS) + REST/OpenAPI (TS↔Python):**

- **Decision:** tRPC for all TypeScript-to-TypeScript communication (frontend ↔ API), REST with OpenAPI for TypeScript-to-Python communication (API ↔ agent services)
- **Version:** tRPC v11+, FastAPI 0.115+
- **Rationale:** tRPC provides end-to-end type safety within the TypeScript monorepo — change a return type on the server and the IDE flags every client that breaks. For cross-language boundaries, REST with FastAPI defines Pydantic models as the source of truth. Claude Code reads Python Pydantic models and generates/maintains corresponding TypeScript types in `packages/shared/src/generated/agent-api.ts`. This eliminates `openapi-typescript` codegen toolchain complexity while maintaining type safety — CI validates the types compile and align with the Python models.
- **Affects:** All API endpoints, agent service integration, desktop app communication
- **Implementation Notes:**
  - tRPC router: `packages/api/` shared across `apps/web` and `apps/desktop`
  - tRPC server: Next.js API route handler (`apps/web/app/api/trpc/[trpc]/route.ts`) for MVP — factor out to standalone server only if independent scaling needed
  - Python services: FastAPI endpoints at `services/agents/`
  - TypeScript types for Python API: `packages/shared/src/generated/agent-api.ts` — maintained by Claude Code from Pydantic source, validated by CI compilation
  - CI validates TypeScript types match Python Pydantic models (schema contract test)

**Real-Time Communication — SSE (dual-purpose):**

- **Decision:** SSE via Vercel AI SDK for conversational AI streaming + SSE bridge endpoint from NATS for dashboard/globe real-time updates
- **Version:** Vercel AI SDK v6+
- **Rationale:** AI streaming is already solved by Vercel AI SDK's `useChat()` hook via SSE. For dashboard/globe updates, an SSE bridge endpoint (`/api/events/[stream]`) subscribes to NATS subjects server-side and relays to the browser. This avoids exposing NATS directly to the browser (security concern for government path) while maintaining real-time capability.
- **Affects:** Desktop chat, agent responses, dashboard updates, globe real-time signals
- **Growth Path:** Evaluate NATS WebSocket gateway for lower-latency globe updates when SSE bridge becomes insufficient
- **Security:** SSE bridge enforces tenant isolation server-side — browser never accesses NATS directly, simpler audit surface for government compliance

### Frontend Architecture

**State Management — Zustand + TanStack Query:**

- **Decision:** Zustand for client-side state, TanStack Query for server state cache, dedicated Zustand store for globe state machine
- **Version:** Zustand v5+, TanStack Query v5+
- **Rationale:** Zustand is 1.2KB with zero boilerplate and no providers. TanStack Query handles cache invalidation, refetching, and optimistic updates for server data. Clean separation of concerns. Redux would be overkill.
- **Affects:** All frontend state, globe zoom state machine, agent conversation state
- **Implementation Notes:**
  - Globe store: `packages/globe/stores/globe-store.ts` — `zoomLevel: 0-5`, `explodedEntities: Map<string, Vector3>`, `activeQuery: GlobeQueryDirective | null`, `qualityTier: 'full' | 'reduced' | 'minimal'`
  - Actions: `explode(entityId)`, `collapse(entityId)`, `applyDirective(directive)`, `setZoomLevel(level)`
  - Middleware: `devtools` for debugging, `persist` for spatial memory across sessions

**3D Rendering — React Three Fiber:**

- **Decision:** React Three Fiber (R3F) with @react-three/drei for 3D globe rendering and layer compositor
- **Version:** @react-three/fiber v9+, @react-three/drei v9+, Three.js r170+
- **Rationale:** R3F's declarative component model maps directly to the layer compositor architecture from the UX spec. Each visualization layer becomes a React component (`<OrgIntelligenceLayer />`, `<EntityRenderLayer />`, `<PlanningLayer />`, `<QueryHighlightLayer />`). Polymorphic entity rendering uses a single `<OntologyEntityRenderer />` with a federated type registry. For a solo developer already proficient in React, R3F eliminates the cognitive overhead of switching between declarative UI and imperative graphics code.
- **Affects:** Globe renderer, exploded semantic zoom, AI query visualization, entity rendering
- **Implementation Notes:**
  - Package: `packages/globe/` — shared globe renderer library
  - Layer compositor: Each layer manages own draw call budget via `useFrame()` with priority ordering
  - Globe.gl rejected: Too opinionated for custom exploded zoom and polymorphic rendering
  - Raw Three.js rejected: Imperative/declarative cognitive switching too costly for solo dev

**Globe Directive Protocol — Unidirectional Agent → Store → R3F:**

- **Decision:** `GlobeQueryDirective` as a typed data contract flowing unidirectionally from AI agent through store to globe renderer
- **Rationale:** Clean separation — the agent produces structured directives, the globe renders them. No bidirectional coupling.
- **Affects:** AI conversation ↔ globe integration, query visualization
- **Data Contract:**

```typescript
interface GlobeQueryDirective {
  highlightSets: { entityIds: string[]; color: QueryColor; pulse?: boolean }[];
  dimMask: string[];
  camera: { target: Vector3; zoom: number; rotate?: Euler } | null;
  annotations: { entityId: string; label: string; position: 'above' | 'below' }[];
  zoomLevel?: 0 | 1 | 2 | 3 | 4 | 5;
}
```

- **Flow:** User question → AI agent processes → returns `GlobeQueryDirective` in response → Vercel AI SDK parses directive from stream → `useGlobeStore.applyDirective(directive)` → R3F layers react to state changes

**WebGL in Tauri v2 — Quality Tier Mitigation:**

- **Assessment:** Tauri uses OS webview (WebView2/Chromium on Windows — WebGL 2.0 solid; WebKit on macOS — WebGL 2.0 supported since Safari 15; WebKitGTK on Linux — varies by GPU driver)
- **Mitigation:** Quality tier system (`full/reduced/minimal`) already designed in UX spec. `useWebGLCapabilities()` hook detects support on mount and sets quality tier. Early smoke test: render 1000 entities in R3F inside Tauri v2 on Windows — if 30fps holds, clear for MVP.
- **Risk Level:** Medium — Windows (primary target) is solid, macOS is reliable, Linux is the risk area

### Infrastructure & Deployment

**Hosting — Tiered Infrastructure Strategy (Supabase + Vercel for Standard, Azure for Enterprise/Government):**

- **Decision:** Infrastructure scales with customer tier. Small deployments use cost-effective managed services. Enterprise/Government use Azure.
- **Standard Tier (Personal, Solo, Small Team, Mid-Size):**
  - `apps/web` + `apps/website` → Vercel (zero-config Next.js, edge functions, AI SDK streaming)
  - `services/agents` → Railway or Fly.io (Python containers, pay-per-use)
  - `services/signal-layer` → Railway or Fly.io (NATS JetStream container)
  - PostgreSQL → Supabase (managed PostgreSQL, Row Level Security reinforces tenant isolation, built-in storage for client photos/assets)
  - Payments → Stripe (PCI-compliant, hosted checkout)
  - Telephony → Twilio Voice / Vapi (voice AI, SMS, WhatsApp Business API)
  - All standard tenants share the SAME Supabase database — isolated by `tenant_id` + RLS, not separate instances
  - Estimated platform cost: $50-150/mo total
- **Enterprise Tier ($5K+/mo customers):**
  - `apps/web` → Vercel or Azure App Service (customer choice)
  - `services/agents` → Azure Container Apps (dedicated containers, autoscaling)
  - `services/signal-layer` → Azure Container Apps (NATS JetStream)
  - PostgreSQL → Azure Database for PostgreSQL Flexible Server (dedicated, FIPS-validated)
  - Dedicated infrastructure per customer — not shared database
- **Government Tier (IL5/IL6):**
  - Everything → Azure Government (IL5) or Azure Government Secret (IL6)
  - `apps/web` → Azure Static Web Apps or Azure App Service
  - All services on Azure Container Apps within government regions
  - Dedicated infrastructure, FIPS 140-2/140-3 encryption, no shared components
- **Air-Gapped Tier:**
  - All components self-hosted: PostgreSQL (local), NATS (local Docker), vLLM + open-source LLMs, Tauri desktop client
  - Zero cloud dependencies
- **Rationale:** Supabase IS PostgreSQL — Drizzle ORM connects identically. No code changes between tiers. RLS adds a second isolation layer. Supabase's built-in storage handles photo uploads (client profiles). Azure is reserved for customers who pay enough to justify dedicated infrastructure. This saves ~$300-500/mo vs. running everything on Azure from day one.
- **Migration Path:** Supabase → Azure PostgreSQL requires only a connection string change. The application code is identical.
- **Affects:** All deployment, CI/CD, infrastructure cost, tenant isolation strategy

**New Infrastructure Components (Self-Deploying Platform):**

- **Twilio / Vapi** — Voice AI (inbound calls, appointment scheduling), SMS, WhatsApp Business API. Edge function webhooks on Vercel handle inbound events.
- **Stripe** — Payment processing (deposits, subscriptions, usage-based billing). Stripe Elements for PCI-compliant card input. Webhooks for payment events.
- **Supabase Storage** — Client profile photos, business assets, visual intelligence image processing. Integrated with Supabase PostgreSQL — no separate blob storage needed.
- **Vision AI** — For client profile photo intelligence (Story 2b.1). Uses the Model Abstraction Layer — route vision tasks to OpenAI GPT-4o (vision) or Anthropic Claude (vision) via the existing per-task model routing config. No separate ML pipeline — vision is just another model call type.

**Organizational Learning Engine:**

- **Decision:** Platform-wide process capture, skill formation, and cross-agent/cross-tenant learning system
- **Process Capture Schema:**
  ```
  process_records table:
    id, tenant_id, agent_id, user_id (nullable),
    intent (what was the goal),
    process_steps (JSONB — ordered array of steps taken),
    decisions (JSONB — decision points with reasoning),
    end_state (JSONB — final outcome),
    evaluation (success/partial/failure + confidence score),
    reflection (JSONB — what worked, what didn't, what to do differently),
    tags (JSONB — business_type, agent_role, task_category),
    duration_ms, created_at
  ```
- **Skill Formation Pipeline:**
  ```
  Process Records (raw experience)
    → Pattern Detection (BMAD engine analyzes clusters of similar processes)
    → Skill Candidate (proposed skill with evidence: trigger, action, expected outcome, confidence)
    → Skill Review (Leadership Coach or owner approves)
    → Active Skill (stored in agent_configs.skills, applied at runtime)
    → Skill Monitoring (track success rate post-activation)
  ```
- **Skill Storage:** `agent_skills` table — `id, tenant_id, agent_id (nullable = shared), skill_name, trigger_conditions (JSONB), action_steps (JSONB), evidence (JSONB — source process_record IDs, success rate), confidence, status (candidate/active/deprecated), created_from (process_record_id), created_at`
- **Cross-Agent Learning:** When one agent develops a skill, related agents in the same tenant receive it as a skill candidate. Marketing agent learns "Tuesday promos work" → Scheduler agent receives candidate: "block fewer Tuesday slots to accommodate promo bookings"
- **Cross-Tenant Learning (Anonymized):** Successful skills with high confidence across multiple tenants of the same business type are anonymized and promoted to the Business Type Framework Dictionary. Salon A's "text reminder reduces no-shows 40%" → becomes default capability for all new Salon deployments. No customer data crosses boundaries — only the pattern and outcome statistics.
- **Human Process Capture:** When a business owner does something manually that an agent could learn (e.g., owner manually resolves a scheduling conflict), the platform can capture the process via: (a) owner describes what they did via WhatsApp/chat, (b) agent observes the actions and outcome, (c) owner flags "learn from this." The captured process enters the same pipeline as agent-generated process records.
- **Lesson Learned Registry:** `lessons_learned` table — cross-referenced to process_records and agent_skills. Captures what went wrong and the corrective action. Agents query this before executing similar tasks to avoid known pitfalls.
- **Cross-Environment Learning Boundaries:**
  - **Within a tenant:** Full sharing — all agents see all process records, skills, and lessons learned for their tenant
  - **Across tenants, same environment (commercial ↔ commercial):** Anonymized patterns only. Statistics cross (trigger, action, success rate, confidence). Never: client names, business details, revenue, any PII. Promoted to Business Type Framework Dictionary when confidence threshold met across 3+ tenants.
  - **Commercial → Government:** One-way, frozen snapshot. Government environments receive a static copy of the dictionary at deployment time. They never send data back. Dictionary updates require a manual software release cycle, not live sync.
  - **Government → Anything:** NEVER. Government/classified environments are hard-isolated. No process records, skills, lessons learned, or anonymized patterns ever leave the boundary. IL6 environments are fully air-gapped — learning stays within the instance permanently.
  - **Air-Gapped → Anything:** NEVER. Dictionary ships as a static file. Updates come via manual software releases (physical media for SCIF environments). The air-gapped instance learns internally but never shares externally.
  - **Anything → Air-Gapped:** One-way, manual. Dictionary updates delivered via approved software release process. No live connection.
- **Affects:** Database schema (3 new tables), BMAD innovation engine (feeds skill pipeline), agent runtime (skills loaded at instantiation), dictionary (anonymized skills feed back), cross-environment data flow governance

**Client Website & App Integration:**

- **Decision:** WisdomWorks can build websites for clients OR integrate with existing ones
- **Build mode (MVP):** Website Manager agent generates a Next.js site from industry templates, deployed to Vercel via API as a tenant-scoped project. Client gets subdomain (business.wisdomworks.com) or connects custom domain. Agent manages content: updates hours, publishes promos, adds booking widget. Connected to all other agents via signals.
- **Connect mode (MVP):** For clients with existing websites (Wix, WordPress, Squarespace, custom). Integration via embeddable widgets:
  - Booking widget (iframe or JS snippet) — powered by Scheduler agent
  - Chat widget (like Intercom) — powered by Customer Service agent
  - Contact form webhook → routes to agent pipeline instead of email
  - REST API endpoints (tenant-scoped, authenticated) for custom app integration
- **Growth:** Full website builder with templates, mobile app generation, native SDK (React Native/Flutter), WordPress/Shopify/Squarespace plugins
- **Affects:** Website Manager agent behavior, Vercel API integration, embeddable component library

**CI/CD — GitHub Actions + Turborepo:**

- **Decision:** Three simple GitHub Actions workflows leveraging Turborepo's remote caching
- **Workflows:**
  1. **PR check:** `turbo build test lint` — runs on every pull request, only rebuilds changed packages
  2. **Deploy web:** On merge to main, Vercel's GitHub integration deploys `apps/web` automatically
  3. **Deploy services:** On merge to main, build Docker images → push to Azure Container Registry → deploy to Azure Container Apps
- **Rationale:** Turborepo remote caching means CI only rebuilds what changed. A solo developer doesn't need complex pipeline orchestration.
- **Affects:** All deployment automation, development workflow

**Containerization — Docker:**

- **Decision:** Every service gets a Dockerfile, `docker-compose.yml` orchestrates local development
- **Dockerfiles:** `services/agents/Dockerfile`, `services/signal-layer/Dockerfile`
- **docker-compose.yml:** PostgreSQL + NATS JetStream + PowerSync for local dev
- **Rationale:** Non-negotiable for reproducible environments, Azure Container Apps deployment, and government deployment path
- **Implementation Notes:** Write `docker-compose.yml` (local dev) and `docker-compose.prod.yml` (mirrors Azure topology) — when government time comes, service topology is documented as code

### Decision Impact Analysis

**Implementation Sequence:**

1. Repository initialization (Turborepo + pnpm monorepo structure)
2. Database schema (typed core tables + JSONB, Drizzle ORM setup, pgvector extension)
3. Auth setup (Auth.js v5 + Entra ID)
4. tRPC API layer (router in `packages/api/`, server in Next.js)
5. NATS JetStream signal layer (Docker container + consumer setup)
6. Python agent service (FastAPI + LangGraph, REST/OpenAPI contract)
7. Globe renderer foundation (R3F, layer compositor skeleton, quality tier detection)
8. SSE bridge for real-time dashboard events
9. Tauri v2 desktop app shell (WebGL smoke test)
10. CI/CD pipelines (GitHub Actions workflows)

**Cross-Component Dependencies:**

- Data modeling (JSONB metadata) ↔ Agent runtime (agents query and extend ontology entities)
- tRPC router ↔ TanStack Query (shared type-safe data layer)
- NATS JetStream ↔ SSE bridge ↔ Globe store (real-time signal flow)
- GlobeQueryDirective ↔ Vercel AI SDK ↔ Zustand globe store (AI→globe pipeline)
- Quality tier system ↔ R3F layers ↔ Tauri WebGL capabilities (rendering adaptation)
- Docker containers ↔ Azure Container Apps ↔ GitHub Actions (deployment chain)
- Auth.js ↔ tRPC middleware ↔ NATS subject permissions (security chain)

### Polyglot Complexity Assessment

**Solo Developer Feasibility:**

- **TypeScript (~80% of codebase):** Primary language — frontend, API, shared types, database schema, globe renderer
- **Python (~15% of codebase):** Agent orchestration only — LangGraph graph definitions (100-200 lines per agent type) + FastAPI endpoints. Bounded, focused context.
- **Rust (~5% of codebase):** Tauri v2 glue code — configuration + custom commands for desktop integration (file system, app control, notifications). Estimated 200-500 lines total.
- **Development Ergonomics:** 5 processes in development — `docker-compose up` handles 3 (PostgreSQL, NATS, Python agents), Next.js dev server is 1, Tauri dev is 1. Manageable but do not add more services without strong justification.

## Implementation Patterns & Consistency Rules

### Naming Patterns

**Database Naming (PostgreSQL/Drizzle):**

- Tables: `snake_case`, plural — `entities`, `entity_types`, `relationship_types`, `signals`
- Columns: `snake_case` — `created_at`, `entity_id`, `display_name`
- Foreign keys: `{referenced_table_singular}_id` — `entity_id`, `relationship_type_id`
- Indexes: `idx_{table}_{columns}` — `idx_entities_type_id`, `idx_signals_created_at`
- Enums: `snake_case` — `entity_status`, `signal_priority`

**tRPC / API Naming:**

- tRPC routers: `camelCase` nouns — `entities`, `signals`, `ontology`, `agentRuntime`
- tRPC procedures: `camelCase` verbs — `entities.getById`, `signals.createBatch`, `ontology.search`
- REST endpoints (Python): lowercase, plural nouns, hyphens for multi-word — `/api/v1/agents/invoke`, `/api/v1/ontology/entities`
- Query parameters: `camelCase` — `?entityId=`, `?pageSize=`
- NATS subjects: `dot.separated.lowercase` — `signals.{tenant_id}.created`, `governance.{tenant_id}.evaluation`

**Code Naming (TypeScript):**

- React components: `PascalCase` — `EntityRenderer`, `GlobeCanvas`, `SignalFeed`
- Component files: `PascalCase.tsx` — `EntityRenderer.tsx`, `GlobeCanvas.tsx`
- Non-component TS files: `kebab-case.ts` — `globe-store.ts`, `use-quality-tier.ts`, `cache-provider.ts`
- Hooks: `useCamelCase` — `useGlobeStore`, `useQualityTier`, `useWebGLCapabilities`
- Functions/variables: `camelCase` — `getEntityById`, `signalCount`
- Constants: `UPPER_SNAKE_CASE` — `MAX_ENTITY_COUNT`, `DEFAULT_ZOOM_LEVEL`
- Types/interfaces: `PascalCase` — `GlobeQueryDirective`, `OntologyEntity`, `SignalPayload`
- Zod schemas: `camelCase` with `Schema` suffix — `entitySchema`, `signalPayloadSchema`

**Code Naming (Python):**

- Files/modules: `snake_case.py` — `agent_orchestrator.py`, `ontology_service.py`
- Functions/variables: `snake_case` — `invoke_agent`, `entity_count`
- Classes: `PascalCase` — `FounderAgent`, `OntologyService`
- Pydantic models: `PascalCase` — `InvokeRequest`, `EntityResponse`

### Structure Patterns

**Test Location:** Co-located with source files

- `EntityRenderer.tsx` → `EntityRenderer.test.tsx` (same directory)
- `globe-store.ts` → `globe-store.test.ts`
- Python: `agent_orchestrator.py` → `test_agent_orchestrator.py` (same directory or `tests/` within service)
- E2E tests: `apps/web/e2e/` (Playwright)

**Component Organization:** Feature-based within apps, type-based within packages

- `apps/web/src/features/dashboard/` — feature-specific components, hooks, utilities
- `apps/web/src/features/globe/` — globe page-level components
- `packages/ui/src/components/` — shared design system components (by type: `buttons/`, `forms/`, `layout/`)
- `packages/globe/src/layers/` — globe render layers
- `packages/globe/src/renderers/` — entity renderers

**Barrel Exports:** Each package exposes a single `index.ts` entry point

- `packages/ui/src/index.ts` — re-exports all public components
- `packages/db/src/index.ts` — re-exports schema, queries, types
- Internal directories do NOT use barrel files (avoids circular deps)

**Config Files:** Root-level for tooling, `packages/*/` for package-specific

- `turbo.json`, `pnpm-workspace.yaml`, `.eslintrc.js`, `prettier.config.js` — repo root
- `drizzle.config.ts` — `packages/db/`
- `tailwind.config.ts` — `apps/web/`, `packages/ui/`

### Format Patterns

**tRPC Response Format:** Direct return (tRPC handles serialization)

- Success: return the data directly — `return { entity, relationships }`
- Errors: throw `TRPCError` with appropriate code — `throw new TRPCError({ code: 'NOT_FOUND', message: '...' })`
- No wrapper objects (`{ data, error }`) — tRPC handles this

**REST Response Format (Python → TypeScript):**

- Success: `{ "data": ..., "meta": { "requestId": "..." } }`
- Error: `{ "error": { "code": "AGENT_TIMEOUT", "message": "...", "details": {} } }`
- HTTP status codes: 200 (success), 201 (created), 400 (validation), 401 (auth), 403 (forbidden), 404 (not found), 500 (server error)

**Data Exchange:**

- JSON fields: `camelCase` in TypeScript APIs, `snake_case` in Python APIs (FastAPI's `alias_generator` handles conversion)
- Dates: ISO 8601 strings — `"2026-03-17T14:30:00Z"`
- IDs: UUID v7 (time-sortable) — `crypto.randomUUID()` or `uuid7` in Python
- Nulls: Use `null` explicitly, never `undefined` in API responses
- Booleans: `true`/`false`, never `1`/`0`

### Communication Patterns

**NATS Event Naming:** `{domain}.{tenant_id}.{action}` — dot-separated, lowercase

- `signals.{tenant_id}.created`
- `ontology.{tenant_id}.entity.updated`
- `governance.{tenant_id}.evaluation.completed`
- `agents.{tenant_id}.invocation.started`

**Event Payload Structure:**

```typescript
interface DomainEvent<T = unknown> {
  id: string;           // UUID v7
  type: string;         // matches NATS subject
  tenantId: string;
  timestamp: string;    // ISO 8601
  source: string;       // originating service
  data: T;              // typed payload
  metadata?: Record<string, unknown>;
}
```

**Zustand Store Conventions:**

- One store per domain: `useGlobeStore`, `useAuthStore`, `useSignalStore`
- Actions defined inside the store (not external)
- Immutable updates via Immer middleware or spread
- Selectors: `useGlobeStore((s) => s.zoomLevel)` — always use selectors, never subscribe to whole store

### Process Patterns

**Error Handling:**

- **tRPC layer:** `TRPCError` with codes mapped to HTTP status. Caught by global error handler in `apps/web`
- **React UI:** Error boundaries per feature route (`apps/web/src/features/*/error.tsx` via Next.js conventions)
- **Agent services:** Python exceptions → FastAPI exception handlers → structured error response
- **NATS consumers:** Dead letter queue for failed events, exponential backoff retry (max 3 attempts)
- **User-facing errors:** Human-readable `message` + machine-readable `code`. Never expose stack traces or internal details.

**Loading States:**

- TanStack Query handles server state loading (`isLoading`, `isFetching`, `isError`)
- Zustand stores: no loading states in client stores — that's TanStack Query's job
- Skeleton components for initial page loads (Next.js `loading.tsx` convention)
- Streaming UI for AI responses (Vercel AI SDK `useChat()` handles this)

**Validation:**

- **API boundary (inbound):** Zod schemas validate all incoming data at tRPC procedure level
- **Python boundary (inbound):** Pydantic models validate all incoming requests
- **Database boundary:** Drizzle schema + PostgreSQL constraints as final safety net
- **Client-side:** React Hook Form + Zod for form validation (same schemas as server when possible)
- **JSONB metadata:** Zod schema per entity type, validated at write time, not read time

**Logging:**

- Structured JSON logs: `{ "level": "info", "message": "...", "tenantId": "...", "requestId": "...", "timestamp": "..." }`
- Levels: `error` (failures), `warn` (degraded), `info` (business events), `debug` (development only)
- Correlation: `requestId` header propagated through tRPC → NATS → Python services
- Audit events: separate from application logs, written to audit table (NIST AU compliance)

### Enforcement Guidelines

**All AI Agents MUST:**

1. Follow naming conventions exactly — snake_case DB, camelCase TS, PascalCase components, dot.separated NATS
2. Co-locate tests with source files — never create a separate top-level `__tests__/` directory
3. Use Zod schemas for all API boundary validation — never validate with manual `if` checks
4. Return `TRPCError` for tRPC errors, never raw `throw new Error()`
5. Use UUID v7 for all IDs — never auto-increment integers
6. Use ISO 8601 for all date serialization — never Unix timestamps in APIs
7. Wrap NATS events in `DomainEvent<T>` structure — never publish raw payloads
8. Use TanStack Query for server state — never `useEffect` + `fetch` + `useState`
9. Use feature-based organization in apps, type-based in packages
10. Propagate `tenantId` and `requestId` through all service boundaries

## Project Structure & Boundaries

### Complete Project Directory Structure

```
wisdomworks/
├── .github/
│   └── workflows/
│       ├── pr-check.yml                    # turbo build test lint
│       ├── deploy-web.yml                  # Vercel auto-deploy (backup/manual)
│       └── deploy-services.yml             # Docker build → ACR → Container Apps
├── .env.example                            # Template for local env vars
├── .eslintrc.js                            # Shared ESLint config
├── .prettierrc                             # Prettier config
├── turbo.json                              # Turborepo pipeline config
├── pnpm-workspace.yaml                     # Workspace member definitions
├── docker-compose.yml                      # Local dev: PostgreSQL, NATS, PowerSync
├── docker-compose.prod.yml                 # Production topology mirror
│
├── apps/
│   ├── web/                                # Next.js App Router — Operations Console
│   │   ├── next.config.ts
│   │   ├── tailwind.config.ts
│   │   ├── tsconfig.json
│   │   ├── package.json
│   │   ├── .env.local
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── layout.tsx              # Root layout (auth provider, theme, query provider)
│   │   │   │   ├── globals.css             # Tailwind v4 @theme tokens
│   │   │   │   ├── loading.tsx             # Root skeleton
│   │   │   │   ├── error.tsx               # Root error boundary
│   │   │   │   ├── api/
│   │   │   │   │   ├── trpc/[trpc]/route.ts    # tRPC HTTP handler
│   │   │   │   │   └── events/[stream]/route.ts # SSE bridge from NATS
│   │   │   │   ├── (auth)/
│   │   │   │   │   ├── login/page.tsx
│   │   │   │   │   └── callback/page.tsx
│   │   │   │   ├── (dashboard)/
│   │   │   │   │   ├── layout.tsx
│   │   │   │   │   ├── page.tsx                 # Dashboard home
│   │   │   │   │   ├── overview/page.tsx        # Instance overview
│   │   │   │   │   ├── agents/page.tsx          # Agent deployment status
│   │   │   │   │   ├── ontology/page.tsx        # Ontology browser
│   │   │   │   │   ├── signals/page.tsx         # Data flow visualization
│   │   │   │   │   └── settings/page.tsx        # Instance settings
│   │   │   │   ├── (globe)/
│   │   │   │   │   ├── layout.tsx
│   │   │   │   │   └── page.tsx                 # 3D globe view with chat
│   │   │   │   └── (admin)/
│   │   │   │       ├── layout.tsx
│   │   │   │       ├── engagements/page.tsx     # Engagement lifecycle
│   │   │   │       ├── governance/page.tsx      # Governance rule management
│   │   │   │       └── audit/page.tsx           # Audit log viewer
│   │   │   ├── features/
│   │   │   │   ├── dashboard/
│   │   │   │   │   ├── DashboardCard.tsx
│   │   │   │   │   ├── DashboardCard.test.tsx
│   │   │   │   │   ├── MetricsGrid.tsx
│   │   │   │   │   └── use-dashboard-data.ts
│   │   │   │   ├── globe/
│   │   │   │   │   ├── GlobePage.tsx            # Globe page wrapper
│   │   │   │   │   ├── GlobeChat.tsx            # Chat panel alongside globe
│   │   │   │   │   ├── GlobeControls.tsx        # Satellite controls (DOM overlay)
│   │   │   │   │   └── use-globe-query.ts       # AI query → directive hook
│   │   │   │   ├── ontology/
│   │   │   │   │   ├── OntologyBrowser.tsx
│   │   │   │   │   ├── EntityDetail.tsx
│   │   │   │   │   └── RelationshipGraph.tsx
│   │   │   │   ├── agents/
│   │   │   │   │   ├── AgentStatusList.tsx
│   │   │   │   │   ├── DeploymentWorkflow.tsx
│   │   │   │   │   └── AgentDetail.tsx
│   │   │   │   └── governance/
│   │   │   │       ├── GovernanceRuleEditor.tsx
│   │   │   │       └── PolicyList.tsx
│   │   │   ├── lib/
│   │   │   │   ├── trpc.ts                 # tRPC client setup
│   │   │   │   └── query-client.ts         # TanStack Query provider
│   │   │   └── middleware.ts               # Auth.js middleware
│   │   ├── e2e/                            # Playwright E2E tests
│   │   │   ├── playwright.config.ts
│   │   │   ├── dashboard.spec.ts
│   │   │   └── globe.spec.ts
│   │   └── public/
│   │       └── assets/
│   │           ├── fonts/                  # Geist Sans/Mono
│   │           └── images/
│   │
│   ├── desktop/                            # Tauri v2 — Desktop Agent Runtime
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── tailwind.config.ts
│   │   ├── vite.config.ts                  # Vite for Tauri frontend
│   │   ├── src-tauri/
│   │   │   ├── Cargo.toml
│   │   │   ├── tauri.conf.json             # Tauri config (FIPS flag, capabilities)
│   │   │   ├── capabilities/
│   │   │   │   └── default.json            # Permission capabilities
│   │   │   └── src/
│   │   │       ├── main.rs                 # Tauri entry point
│   │   │       ├── commands/
│   │   │       │   ├── mod.rs
│   │   │       │   ├── file_system.rs      # Local file access
│   │   │       │   ├── app_control.rs      # Application control
│   │   │       │   └── notifications.rs    # System notifications
│   │   │       └── lib.rs
│   │   └── src/
│   │       ├── App.tsx                     # Desktop app root
│   │       ├── main.tsx
│   │       ├── features/
│   │       │   ├── chat/
│   │       │   │   ├── ChatPanel.tsx        # Conversational AI interface
│   │       │   │   ├── ChatMessage.tsx
│   │       │   │   └── use-agent-chat.ts
│   │       │   ├── briefing/
│   │       │   │   ├── MorningBriefing.tsx
│   │       │   │   └── BriefingCard.tsx
│   │       │   ├── terminal/
│   │       │   │   ├── TerminalPanel.tsx
│   │       │   │   └── CommandHistory.tsx
│   │       │   └── passive/
│   │       │       ├── PassiveAgent.tsx     # Passive observation mode
│   │       │       └── SuggestionBubble.tsx
│   │       └── lib/
│   │           ├── trpc.ts                 # tRPC client for desktop
│   │           ├── tauri-commands.ts       # Typed Tauri invoke wrappers
│   │           └── offline-sync.ts         # PowerSync/ElectricSQL client
│   │
│   └── website/                            # Next.js — wisdomworks.ai marketing
│       ├── next.config.ts
│       ├── package.json
│       └── src/
│           └── app/
│               ├── layout.tsx
│               ├── page.tsx                # Landing page
│               ├── pricing/page.tsx
│               └── onboarding/page.tsx     # Self-service onboarding entry
│
├── packages/
│   ├── api/                                # tRPC router (shared across apps)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts                    # Barrel export
│   │       ├── root.ts                     # Root tRPC router
│   │       ├── trpc.ts                     # tRPC instance, context, middleware
│   │       └── routers/
│   │           ├── entities.ts             # Ontology entity CRUD
│   │           ├── relationships.ts        # Relationship queries
│   │           ├── signals.ts              # Signal layer queries
│   │           ├── agents.ts               # Agent management
│   │           ├── governance.ts           # Governance rules
│   │           ├── search.ts              # FTS + semantic search
│   │           ├── audit.ts               # Audit log queries
│   │           └── metering.ts            # Usage metering queries
│   │
│   ├── db/                                 # Drizzle ORM schema + migrations
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── drizzle.config.ts
│   │   └── src/
│   │       ├── index.ts                    # Barrel: schema, client, queries
│   │       ├── client.ts                   # Drizzle client instance
│   │       ├── schema/
│   │       │   ├── ontology.ts             # entities, entity_types, relationships, relationship_types
│   │       │   ├── signals.ts              # signals, signal_types
│   │       │   ├── agents.ts               # agent_instances, agent_configs
│   │       │   ├── governance.ts           # governance_rules, governance_evaluations
│   │       │   ├── audit.ts                # audit_logs
│   │       │   ├── auth.ts                 # users, sessions, accounts (Auth.js)
│   │       │   ├── metering.ts             # usage_events, billing_records
│   │       │   └── tenants.ts              # tenants, tenant_configs
│   │       ├── queries/
│   │       │   ├── ontology-queries.ts     # Typed ontology queries
│   │       │   ├── signal-queries.ts
│   │       │   └── search-queries.ts       # FTS + pgvector queries
│   │       └── migrations/                 # Drizzle-generated SQL migrations
│   │
│   ├── auth/                               # Auth.js v5 + Entra ID
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── config.ts                   # Auth.js config, providers
│   │       ├── adapter.ts                  # Drizzle adapter for Auth.js
│   │       └── rbac.ts                     # Role-based access control helpers
│   │
│   ├── shared/                             # Shared TypeScript types + utilities
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── types/
│   │       │   ├── ontology.ts             # OntologyEntity, EntityType, Relationship
│   │       │   ├── signals.ts              # Signal, DomainEvent<T>
│   │       │   ├── globe.ts                # GlobeQueryDirective, QueryColor, ZoomLevel
│   │       │   ├── agents.ts               # AgentConfig, InvocationResult
│   │       │   └── governance.ts           # GovernanceRule, PolicyEvaluation
│   │       ├── schemas/
│   │       │   ├── entity-schemas.ts       # Zod schemas per entity type
│   │       │   ├── signal-schemas.ts       # DomainEvent validation
│   │       │   └── directive-schemas.ts    # GlobeQueryDirective validation
│   │       ├── constants.ts                # Shared constants
│   │       └── generated/
│   │           └── agent-api.ts            # TypeScript types maintained by Claude Code from Pydantic models
│   │
│   ├── ui/                                 # Shared React component library
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── tailwind.config.ts
│   │   └── src/
│   │       ├── index.ts
│   │       └── components/
│   │           ├── buttons/                # shadcn/ui + WisdomWorks tokens
│   │           ├── forms/
│   │           ├── layout/
│   │           ├── data-display/
│   │           ├── feedback/               # Toasts, alerts, skeletons
│   │           └── navigation/
│   │
│   └── globe/                              # Globe renderer library (R3F)
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts
│           ├── GlobeCanvas.tsx             # Root <Canvas> with quality tier
│           ├── GlobeCanvas.test.tsx
│           ├── stores/
│           │   ├── globe-store.ts          # Zustand: zoom, explode, directives
│           │   └── globe-store.test.ts
│           ├── layers/
│           │   ├── OrgIntelligenceLayer.tsx     # Layer 1: org heat maps
│           │   ├── EntityRenderLayer.tsx         # Layer 2: polymorphic entities
│           │   ├── PlanningLayer.tsx             # Layer 3: planning overlays
│           │   └── QueryHighlightLayer.tsx       # Layer 4: AI query visualization
│           ├── renderers/
│           │   ├── OntologyEntityRenderer.tsx    # Single polymorphic renderer
│           │   ├── entity-type-registry.ts       # Federated type → render map
│           │   └── ConnectionRenderer.tsx        # 7 connection type visualizations
│           ├── controls/
│           │   ├── GlobeControlsLayout.tsx       # DOM overlay bridge
│           │   ├── ZoomControls.tsx
│           │   └── ExplodeControls.tsx
│           └── hooks/
│               ├── use-quality-tier.ts           # GPU detection → tier selection
│               ├── use-webgl-capabilities.ts     # WebGL feature detection
│               └── use-semantic-zoom.ts          # L0-L5 zoom state machine
│
├── services/
│   ├── agents/                             # Python — LangGraph agent orchestration
│   │   ├── Dockerfile
│   │   ├── pyproject.toml                  # Python package config
│   │   ├── requirements.txt
│   │   ├── package.json                    # Turborepo CI task wrapper
│   │   ├── .env.example
│   │   ├── app/
│   │   │   ├── main.py                     # FastAPI app entry
│   │   │   ├── config.py                   # Settings (Pydantic BaseSettings)
│   │   │   ├── routers/
│   │   │   │   ├── invoke.py               # POST /api/v1/agents/invoke
│   │   │   │   ├── ontology.py             # Ontology query endpoints
│   │   │   │   └── health.py               # Health check
│   │   │   ├── agents/
│   │   │   │   ├── founder_agent.py        # Founder Agent (orchestrator)
│   │   │   │   ├── role_agent.py           # Role Agent (derived from ontology)
│   │   │   │   ├── classifier_agent.py     # Email classification agent
│   │   │   │   ├── monitoring_agent.py     # Privacy monitoring/QA agent
│   │   │   │   └── base_agent.py           # Shared agent base class
│   │   │   ├── graphs/
│   │   │   │   ├── classification_graph.py # LangGraph: email classification flow
│   │   │   │   ├── delegation_graph.py     # LangGraph: Founder → role agent delegation
│   │   │   │   └── ingestion_graph.py      # LangGraph: document ingestion flow
│   │   │   ├── tools/
│   │   │   │   ├── ontology_tools.py       # Agent tools: query/update ontology
│   │   │   │   ├── signal_tools.py         # Agent tools: emit signals
│   │   │   │   ├── document_tools.py       # Agent tools: extract text from docs
│   │   │   │   └── artifact_tools.py       # Agent tools: generate PowerPoint/Excel/Word
│   │   │   ├── models/
│   │   │   │   ├── requests.py             # Pydantic: InvokeRequest, etc.
│   │   │   │   ├── responses.py            # Pydantic: InvocationResult, etc.
│   │   │   │   └── events.py               # Pydantic: DomainEvent mirror
│   │   │   └── services/
│   │   │       ├── model_service.py        # Model abstraction layer
│   │   │       ├── nats_service.py         # NATS publish/subscribe
│   │   │       └── extraction_service.py   # Document text extraction (PDF, Word, OCR)
│   │   └── tests/
│   │       ├── test_founder_agent.py
│   │       ├── test_classifier_agent.py
│   │       └── test_classification_graph.py
│   │
│   ├── signal-layer/                       # NATS JetStream configuration
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   ├── nats-server.conf               # NATS server config (JetStream, KV, auth)
│   │   └── scripts/
│   │       ├── setup-streams.sh            # Create JetStream streams on startup
│   │       └── setup-kv.sh                 # Create KV buckets
│   │
│   └── ingestion/                          # Generalized ingestion pipeline
│       ├── Dockerfile
│       ├── pyproject.toml
│       ├── requirements.txt
│       ├── package.json
│       └── app/
│           ├── main.py                     # FastAPI entry
│           ├── pipeline.py                 # Core pipeline: ingest → classify → extract → map → emit
│           ├── adapters/
│           │   ├── email_adapter.py         # Email ingestion
│           │   ├── document_adapter.py      # Document ingestion (PDF, Word, Excel)
│           │   ├── directory_adapter.py     # Directory/HR data sync
│           │   └── api_feed_adapter.py      # External API feeds
│           └── tests/
│               ├── test_pipeline.py
│               └── test_email_adapter.py
│
└── _bmad/                                  # BMAD framework (existing)
```

### Architectural Boundaries

**API Boundaries:**

| Boundary | Protocol | Auth | Location |
|---|---|---|---|
| Browser ↔ Next.js API | tRPC over HTTP | Auth.js session | `apps/web/src/app/api/trpc/` |
| Desktop ↔ Next.js API | tRPC over HTTP | Auth.js session | Same endpoint, different client |
| Next.js API ↔ Python Agents | REST/OpenAPI | Service-to-service JWT | `services/agents/app/routers/` |
| Next.js API ↔ NATS | NATS client library | NATS credentials | `packages/api/` → NATS |
| Browser ↔ SSE Bridge | Server-Sent Events | Auth.js session | `apps/web/src/app/api/events/` |
| Python Agents ↔ NATS | NATS client library | NATS credentials | `services/agents/app/services/nats_service.py` |

**Component Boundaries:**

- `packages/` are shared libraries — they export types, components, and utilities but never import from `apps/` or `services/`
- `apps/` import from `packages/` only — never from other `apps/` or directly from `services/`
- `services/` are independent processes — they communicate only via REST/OpenAPI or NATS events, never direct imports
- `packages/globe/` contains all R3F code — `apps/web` and `apps/desktop` import `<GlobeCanvas />` as a black box

**Data Boundaries:**

- All database access goes through `packages/db/` — no raw SQL in `apps/` or `services/`
- Python services access PostgreSQL via their own connection (SQLAlchemy or psycopg), not through Drizzle
- NATS KV cache accessed through `CacheProvider` interface in `packages/shared/`
- Tenant isolation enforced at query level — every query includes `tenantId` filter

### Requirements to Structure Mapping

**Layer 1 — Email Intelligence & Ontology:**

- Ontology engine: `packages/db/src/schema/ontology.ts` + `packages/api/src/routers/entities.ts`
- Email classification: `services/agents/app/agents/classifier_agent.py` + `services/agents/app/graphs/classification_graph.py`
- Signal layer: `services/signal-layer/` + `packages/api/src/routers/signals.ts`
- Integration adapters: `services/ingestion/app/adapters/`
- Document extraction: `services/agents/app/services/extraction_service.py` + `services/agents/app/tools/document_tools.py`

**Layer 2 — Desktop Agent:**

- Desktop runtime: `apps/desktop/` (Tauri v2)
- Chat interface: `apps/desktop/src/features/chat/`
- Briefing: `apps/desktop/src/features/briefing/`
- Terminal: `apps/desktop/src/features/terminal/`
- Passive mode: `apps/desktop/src/features/passive/`
- Offline sync: `apps/desktop/src/lib/offline-sync.ts`
- Agent orchestration: `services/agents/app/agents/` (Founder + role agents)

**Layer 3 — Operations Console:**

- Dashboard views: `apps/web/src/features/dashboard/` + `apps/web/src/app/(dashboard)/`
- Globe visualization: `packages/globe/` + `apps/web/src/features/globe/`
- Admin portal: `apps/web/src/app/(admin)/`
- Agent deployment: `apps/web/src/features/agents/`
- Ontology browser: `apps/web/src/features/ontology/`

**Cross-Cutting:**

- Auth: `packages/auth/` → consumed by `apps/web` middleware and tRPC context
- Governance: `packages/db/src/schema/governance.ts` + `packages/api/src/routers/governance.ts`
- Audit: `packages/db/src/schema/audit.ts` + `packages/api/src/routers/audit.ts`
- Metering: `packages/db/src/schema/metering.ts` + `packages/api/src/routers/metering.ts`
- Shared types: `packages/shared/src/types/` — imported everywhere
- Design system: `packages/ui/` — imported by all `apps/`

### Data Flow

```
Email/Docs → Ingestion Pipeline → Privacy Classification → Ontology Mapping → Signal Emission (NATS)
                                                                                    ↓
User Chat → Desktop/Web → tRPC → Python Agent Service → LangGraph → NATS Signals → SSE Bridge → Globe/Dashboard
                                       ↓                                                ↑
                                  Ontology Query (PostgreSQL + pgvector)          NATS KV Cache
```

**Ingestion Trigger Architecture:**

```
Exchange Webhook → tRPC endpoint (apps/web) → NATS publish (ingestion.{tenant_id}.email.received)
                                                        ↓
                                              Ingestion Service (NATS consumer) → email_adapter.py → pipeline.py
                                                        ↓
                                              Privacy Classification → Ontology Mapping → Signal Emission
```

The ingestion service (`services/ingestion/`) is event-driven — it subscribes to NATS subjects and processes inbound data. For email: Exchange webhooks hit a tRPC endpoint which publishes to NATS, and the ingestion service consumes. For scheduled syncs (directory, HR): a cron-like NATS timer triggers the adapter. The `services/ingestion/` container must be included in `docker-compose.yml` for local development alongside PostgreSQL, NATS, and the agent service.

## Architecture Validation Results

### Coherence Validation ✅

**Decision Compatibility:** All technology choices verified compatible. Key validated combinations:

- Turborepo + pnpm + tRPC + Drizzle + Next.js App Router — standard monorepo pattern
- NATS JetStream + KV + SSE bridge — single server, no redundant infrastructure
- LangGraph (Python) + FastAPI + Claude Code-maintained TypeScript types — clean cross-language boundary
- R3F + Zustand + Tauri v2 WebView2 — component model alignment, WebGL 2.0 supported

**Pattern Consistency:** Naming conventions (snake_case DB, camelCase TS, PascalCase components, dot.separated NATS) are internally consistent and align with ecosystem defaults. No contradictions between patterns and technology choices.

**Structure Alignment:** Project tree directly supports all architectural decisions — `packages/` for shared code, `apps/` for deployables, `services/` for independent processes. Boundary rules (packages never import apps, services communicate via REST/NATS only) enforce the architecture.

**Python↔PostgreSQL Schema Coherence:** TypeScript uses Drizzle ORM (`packages/db/`) as schema source of truth. Python services access PostgreSQL directly via psycopg/SQLAlchemy with their own Pydantic models. To prevent schema drift, CI must include a **schema contract test** that validates Python Pydantic models can read/write against the current Drizzle-migrated schema. This catches drift before production.

### Requirements Coverage ✅

**Layer Coverage:** All 170+ functional requirements across Layer 1 (Email Intelligence), Layer 2 (Desktop Agent), Layer 3 (Operations Console), and Cross-Cutting concerns have explicit directory mappings and architectural support.

**NFR Coverage:**

- Performance: pgvector HNSW (<10ms semantic search), NATS JetStream (<5ms event latency), quality tier system for 3D rendering
- Security: FIPS 140-2/140-3 (Tauri flag + Azure), NIST SP 800-53 (AC, AU, IA, SC, SI), tenant isolation at query + NATS subject level
- Scalability: 13 → 500+ users without rearchitecture (NATS scales, PostgreSQL scales, Azure Container Apps autoscale)
- Accessibility: WCAG 2.1 AA enforced through shadcn/ui component library defaults and UX spec compliance

**Remote Agent Command Note:** Email-as-correspondent channel for multi-instruction remote commands routes through `services/ingestion/app/adapters/email_adapter.py`. The adapter distinguishes command emails from organizational emails via canonical identity model matching.

### Implementation Readiness ✅

**Decision Completeness:** All critical and important decisions documented with specific versions, rationale, and implementation notes. Deferred decisions clearly marked with evaluation triggers.

**Structure Completeness:** ~100+ files and directories mapped with purpose annotations. All integration points specified. Component boundaries defined with clear import rules.

**Pattern Completeness:** 10 mandatory enforcement rules for AI agents. Concrete examples for naming, response formats, event payloads, and state management. Anti-patterns documented (no `useEffect` + `fetch`, no auto-increment IDs, no raw NATS payloads).

**tRPC Context Requirements:** The tRPC context (`packages/api/src/trpc.ts`) must extract `tenantId` from the Auth.js session and generate a `requestId` (UUID v7) per request. Every procedure receives `ctx.tenantId` and `ctx.requestId` for propagation through NATS events and Python service calls.

### Gap Analysis Results

**Addressed Gaps (from Party Mode review):**

1. **Schema contract testing** — CI must validate Python Pydantic models against Drizzle-migrated schema to prevent cross-language drift
2. **Ingestion trigger architecture** — documented above: Exchange webhooks → tRPC → NATS → ingestion service consumer
3. **tRPC context** — `tenantId` and `requestId` extraction specified for tRPC context definition
4. **Ingestion container** — `services/ingestion/` added to docker-compose.yml requirement

**Implementation Notes (not gaps, but guidance):**

5. **Incremental directory creation** — the project tree is a reference map, not a scaffold-all-at-once instruction. Create directories as stories demand them. Start with `apps/web`, `packages/db`, `packages/shared`, `packages/api`. Add `packages/globe`, `apps/desktop`, `services/agents` when building those stories.
6. **Dev tooling setup** — the first implementation story (repository initialization) must establish ESLint, Prettier, and TypeScript strict mode configurations that all subsequent stories inherit. These configs prevent formatting/linting inconsistencies between AI agents.
7. **Globe test strategy** — test the globe state machine (Zustand store) and directive→store flow with unit tests. Use Playwright to validate `GlobeCanvas` renders without WebGL context errors. Do not attempt visual regression testing for 3D content — test the data flow, not the pixels.
8. **Offline sync conflict resolution** — detailed design deferred to Layer 2 desktop epic. Architecture specifies PowerSync/ElectricSQL as the sync mechanism; the specific conflict resolution strategy (last-write-wins vs merge vs manual) is an implementation decision within the desktop sync story, not an architectural decision.

### Architecture Completeness Checklist

**✅ Requirements Analysis**

- [x] Project context thoroughly analyzed (170+ FRs, NFRs, UX implications)
- [x] Scale and complexity assessed (enterprise-grade, 8-12 subsystems)
- [x] Technical constraints identified (FIPS, NIST, email access gating)
- [x] Cross-cutting concerns mapped (10 identified and addressed)

**✅ Architectural Decisions**

- [x] Critical decisions documented with versions (PostgreSQL 16+, Drizzle 0.30+, tRPC 11+, R3F 9+, NATS 2.10+)
- [x] Technology stack fully specified (TypeScript + Python + Rust)
- [x] Integration patterns defined (tRPC, REST/OpenAPI, NATS events, SSE bridge)
- [x] Performance considerations addressed (pgvector HNSW, NATS KV cache, quality tiers)

**✅ Implementation Patterns**

- [x] Naming conventions established (DB, API, code, events)
- [x] Structure patterns defined (co-located tests, feature-based apps, type-based packages)
- [x] Communication patterns specified (DomainEvent<T>, NATS subjects, SSE bridge)
- [x] Process patterns documented (error handling, validation, logging, loading states)

**✅ Project Structure**

- [x] Complete directory structure defined (~100+ files)
- [x] Component boundaries established (packages → apps → services)
- [x] Integration points mapped (6 API boundaries)
- [x] Requirements to structure mapping complete (all 3 layers + cross-cutting)

**✅ Validation (Party Mode Enhanced)**

- [x] Schema contract testing requirement documented
- [x] Ingestion trigger architecture specified
- [x] tRPC context requirements clarified
- [x] Globe test strategy defined
- [x] Incremental creation guidance provided

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION

**Confidence Level:** High

**Key Strengths:**

- Ontology-driven polymorphic architecture supports extensibility without migrations
- NATS JetStream as unified event backbone eliminates redundant messaging infrastructure
- tRPC + Claude Code-maintained types provides end-to-end type safety across the polyglot boundary
- Quality tier system mitigates WebGL risk in Tauri v2
- Clear government deployment path from Vercel → Azure-only
- Solo developer feasibility validated (80% TypeScript, bounded Python/Rust)
- Party Mode review caught 4 gaps and refined 4 implementation guidelines

**Areas for Future Enhancement:**

- NATS WebSocket gateway for direct browser-to-NATS (Growth phase, when SSE bridge bottlenecks)
- Redis/Valkey dedicated cache (500+ users)
- Elasticsearch for faceted search (if FTS proves insufficient)
- Kubernetes migration (if Azure Container Apps scaling limits are reached)
- Offline sync conflict resolution protocol (detailed design during Layer 2 implementation)

### Implementation Handoff

**AI Agent Guidelines:**

- Follow all architectural decisions exactly as documented
- Use implementation patterns consistently across all components
- Respect project structure and boundaries — packages never import from apps or services
- Refer to this document for all architectural questions
- Propagate `tenantId` and `requestId` through every service boundary
- Create directories incrementally as stories require them, not all at once

**First Implementation Priority:**

```bash
pnpm dlx create-turbo@latest wisdomworks
```

Repository initialization with the monorepo structure, ESLint/Prettier/TypeScript strict mode configuration, and docker-compose.yml for local dev services is the first implementation story.

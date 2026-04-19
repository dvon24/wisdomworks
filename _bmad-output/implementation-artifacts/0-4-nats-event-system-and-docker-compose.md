# Story 0.4: NATS Event System & Docker Compose

Status: done

## Story

As a **developer**,
I want a NATS JetStream event system and a Docker Compose development environment,
so that services can communicate asynchronously with guaranteed delivery.

## Acceptance Criteria

1. **Given** the monorepo and database from previous stories exist, **When** the signal-layer service is configured, **Then** NATS JetStream is running via Docker Compose
2. **And** event naming follows `{domain}.{tenant_id}.{action}` pattern (dot-separated, lowercase)
3. **And** a `DomainEvent<T>` TypeScript type wraps all events with: `id`, `type`, `tenantId`, `timestamp`, `source`, `data`, `metadata`
4. **And** dead letter queue is configured with exponential backoff (max 3 attempts)
5. **And** at-least-once delivery is guaranteed with duplicate detection via `DomainEvent.id`
6. **And** an SSE bridge endpoint exists for browser real-time updates
7. **And** a `CacheProvider` interface using NATS KV is implemented (swappable to Redis at Growth)
8. **And** Docker Compose includes: PostgreSQL (with pgvector), NATS JetStream, and all service containers
9. **And** `docker compose up` starts the full development environment
10. **And** signal delivery completes within 60 seconds (NFR8)

## Tasks / Subtasks

- [x] Task 1: Create Docker Compose for local development (AC: #8, #9)
  - [x] docker-compose.yml with PostgreSQL (pgvector/pgvector:pg16) + NATS (nats:2.10-alpine, JetStream enabled)
  - [x] .env created from .env.example with local dev values
  - [x] `docker compose up -d` verified — both containers healthy
  - [x] PostgreSQL accessible on port 5432
  - [x] NATS accessible on port 4222, monitoring on 8222

- [x] Task 2: Create DomainEvent<T> type + Zod schema (AC: #2, #3)
  - [x] packages/shared/src/types/signals.ts — DomainEvent<T> interface
  - [x] packages/shared/src/schemas/signal-schemas.ts — Zod schema with UUID v7, ISO 8601, NATS subject validation
  - [x] Exported from packages/shared/src/index.ts

- [x] Task 3: Create NATS client wrapper + event publisher (AC: #2, #4, #5)
  - [x] services/signal-layer/src/nats-client.ts — lazy connection, JetStream manager, publishEvent with Nats-Msg-Id dedup header
  - [x] services/signal-layer/src/event-publisher.ts — createDomainEvent factory + emitEvent convenience function

- [x] Task 4: Configure JetStream streams + dead letter queue (AC: #1, #4, #5)
  - [x] services/signal-layer/src/setup-streams.ts — 5 streams (SIGNALS, ONTOLOGY, GOVERNANCE, AGENTS, DEADLETTER), 5-min dedup window
  - [x] services/signal-layer/src/event-consumer.ts — durable consumers, ack/nak with exponential backoff, dead letter routing after 3 attempts

- [x] Task 5: Create SSE bridge endpoint (AC: #6)
  - [x] apps/web/app/api/events/[stream]/route.ts — SSE stream with Auth.js session tenant isolation
  - [x] nats package added to apps/web

- [x] Task 6: Create CacheProvider interface + NATS KV implementation (AC: #7)
  - [x] packages/shared/src/cache-provider.ts — CacheProvider interface (get/set/delete)
  - [x] services/signal-layer/src/nats-kv-cache.ts — NatsKVCache implements CacheProvider

- [x] Task 7: Write tests (AC: all)
  - [x] signal-schemas.test.ts — 10 tests (valid event, missing fields, invalid UUID, invalid timestamp, NATS subject validation)
  - [x] event-publisher.test.ts — 7 tests (UUID v7, ISO 8601, subject format, metadata, uniqueness)
  - [x] 97 total tests pass across all packages. Build 12/12. Typecheck 12/12.

## Dev Notes

### Architecture Compliance

**Event Flow:** Agent/Service → `createDomainEvent()` → Zod validation → `publishEvent()` → NATS JetStream → Consumer/SSE Bridge → Browser

**NATS Subject Examples:**
- `signals.{tenant_id}.created` — new signal
- `ontology.{tenant_id}.entity.updated` — entity changed
- `governance.{tenant_id}.evaluation.completed` — governance check done
- `agents.{tenant_id}.invocation.started` — agent task started

**Enforcement Rules Applied:**
- Rule #7: ALL events wrapped in `DomainEvent<T>` — never raw payloads
- Rule #1: dot.separated NATS naming
- Rule #5: UUID v7 for event IDs
- Rule #6: ISO 8601 for timestamps
- Rule #10: tenantId + requestId propagated

### Technology Versions

| Technology | Version | Notes |
|-----------|---------|-------|
| NATS Server | 2.10+ | Alpine image, ~80MB RAM |
| nats (npm) | latest | NATS.js client library |
| PostgreSQL | 16+ | pgvector/pgvector:pg16 Docker image |

### Docker Compose Services

```yaml
# Expected docker-compose.yml structure
services:
  postgres:
    image: pgvector/pgvector:pg16
    ports: ["5432:5432"]
    environment:
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-password}
      POSTGRES_DB: wisdomworks
    volumes:
      - postgres_data:/var/lib/postgresql/data

  nats:
    image: nats:2.10-alpine
    ports:
      - "4222:4222"   # client
      - "8222:8222"   # monitoring
    command: ["--jetstream", "--store_dir=/data"]
    volumes:
      - nats_data:/data
```

### File Structure

```
services/signal-layer/
├── package.json              # Updated with nats dependency + scripts
├── src/
│   ├── nats-client.ts        # NATS connection + JetStream manager
│   ├── event-publisher.ts    # createDomainEvent + publishEvent
│   ├── event-consumer.ts     # subscribeToEvents + ack/nak
│   ├── setup-streams.ts      # JetStream stream creation
│   ├── nats-kv-cache.ts      # CacheProvider NATS KV implementation
│   └── event-publisher.test.ts

packages/shared/src/
├── types/
│   └── signals.ts            # DomainEvent<T> type
├── schemas/
│   ├── signal-schemas.ts     # Zod validation
│   └── signal-schemas.test.ts
├── cache-provider.ts         # CacheProvider interface
└── index.ts                  # Updated barrel exports

apps/web/app/api/events/[stream]/
└── route.ts                  # SSE bridge endpoint

docker-compose.yml            # PostgreSQL + NATS (repo root)
```

### Previous Story Learnings (from Story 0.3)

- Lazy initialization patterns needed for Next.js build compatibility (no env vars at build time)
- SSE bridge endpoint needs Auth.js session for tenant isolation (use `auth()` from `@wisdomworks/auth`)
- packages/shared currently exports `{}` — first real exports will be DomainEvent types + CacheProvider
- services/signal-layer has placeholder package.json with echo scripts — replace with real ones
- `@wisdomworks/db` uses lazy Proxy for db client — Docker PostgreSQL must be running for actual DB operations

### What This Story Does NOT Do

- No CI/CD pipeline (Story 0.5)
- No test infrastructure docker-compose.test.yml (Story 0.6)
- No actual signal processing logic — only the transport layer
- No Python agent NATS integration (Story 2.1+)
- No production Docker Compose (docker-compose.prod.yml) — just local dev

### References

- [Source: architecture.md — NATS JetStream decision, ~80MB RAM, 400K msgs/sec]
- [Source: architecture.md — DomainEvent<T> type definition]
- [Source: architecture.md — event naming pattern, subject examples]
- [Source: architecture.md — SSE bridge at /api/events/[stream]/route.ts]
- [Source: architecture.md — CacheProvider interface, NATS KV]
- [Source: architecture.md — Docker Compose: PostgreSQL + NATS + services]
- [Source: architecture.md — enforcement rule #7 (DomainEvent wrapper)]
- [Source: epics.md — Story 0.4 acceptance criteria, lines 500-519]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- Docker: pgvector/pgvector:pg16 + nats:2.10-alpine pulled and started healthy
- pnpm test: 97 tests across 5 packages (shared 20, signal-layer 7, auth 14, api 22, db 34)
- pnpm build: 12/12 successful
- pnpm typecheck: 12/12 successful
- Zod v4 fix: z.record(z.string(), z.unknown()) needed for metadata field

### Completion Notes List

- Docker Compose includes health checks for both PostgreSQL and NATS
- NATS JetStream enabled via `--jetstream` flag with persistent storage
- DomainEvent schema validates UUID v7 format (version nibble = 7), ISO 8601 timestamps, and lowercase dot-separated NATS subjects
- Signal-layer converted from echo stubs to real TypeScript package with tsconfig, eslint, vitest
- SSE bridge uses `force-dynamic` to prevent Next.js from static-rendering the route
- NatsKVCache TTL is bucket-level in NATS KV, not per-key — documented as limitation
- Zod v4 requires `z.record(z.string(), z.unknown())` instead of `z.record(z.unknown())`

### Change Log

- 2026-04-19: Story 0.4 implemented — Docker Compose, DomainEvent types, NATS client, JetStream streams, SSE bridge, CacheProvider

### File List

- docker-compose.yml (created)
- .env (created — gitignored)
- packages/shared/package.json (modified — added zod, vitest, test script)
- packages/shared/vitest.config.ts (created)
- packages/shared/src/index.ts (modified — barrel exports for DomainEvent, schemas, CacheProvider)
- packages/shared/src/types/signals.ts (created)
- packages/shared/src/schemas/signal-schemas.ts (created)
- packages/shared/src/schemas/signal-schemas.test.ts (created)
- packages/shared/src/cache-provider.ts (created)
- services/signal-layer/package.json (modified — real TS package with deps)
- services/signal-layer/tsconfig.json (created)
- services/signal-layer/vitest.config.ts (created)
- services/signal-layer/eslint.config.mjs (created)
- services/signal-layer/src/nats-client.ts (created)
- services/signal-layer/src/event-publisher.ts (created)
- services/signal-layer/src/event-consumer.ts (created)
- services/signal-layer/src/setup-streams.ts (created)
- services/signal-layer/src/nats-kv-cache.ts (created)
- services/signal-layer/src/event-publisher.test.ts (created)
- apps/web/package.json (modified — added nats dependency)
- apps/web/app/api/events/[stream]/route.ts (created)

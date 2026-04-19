# Story 0.7: Model Abstraction Layer

Status: done

## Story

As a **developer**,
I want a multi-provider AI abstraction layer supporting Anthropic and OpenAI,
so that any agent can be routed to the optimal model per task without provider lock-in.

## Acceptance Criteria

1. **Given** the monorepo and service infrastructure exist, **When** the Model Abstraction Layer is implemented, **Then** Vercel AI SDK is integrated in TypeScript services
2. **And** LangGraph is integrated in Python agent services (`services/agents`)
3. **And** two providers are configured: Anthropic (Claude) and OpenAI (GPT)
4. **And** a `ModelProvider` interface abstracts provider-specific calls
5. **And** an adapter pattern allows direct SDK access for provider-specific features
6. **And** model routing configuration supports per-task model selection
7. **And** basic try-catch failover: if primary provider fails, fallback to secondary
8. **And** a simple benchmark test harness exists: given a prompt + expected output, score accuracy across providers
9. **And** model calls include `tenantId` for usage tracking
10. **And** usage events are logged to the `usage_events` table

## Tasks / Subtasks

- [ ] Task 1: Install Vercel AI SDK + provider packages (AC: #1, #3)
  - [ ] Add `ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai` to `packages/shared`
  - [ ] Add vitest if not present

- [ ] Task 2: Create ModelProvider interface + routing config types (AC: #4, #6)
  - [ ] Create `packages/shared/src/ai/model-provider.ts`:
    - `ModelProvider` interface: `generateText(prompt, options)`, `generateStream(prompt, options)`, `getModel(modelId)`
    - `ModelRouteConfig` type: `{ task: string, provider: 'anthropic' | 'openai', model: string, fallback?: { provider, model } }`
    - `ModelRoutingTable` type: `Record<string, ModelRouteConfig>` — maps task names to model configs
  - [ ] Create `packages/shared/src/ai/index.ts` barrel export
  - [ ] Export from `packages/shared/src/index.ts`

- [ ] Task 3: Create AI client with provider routing + failover (AC: #3, #5, #7)
  - [ ] Create `packages/shared/src/ai/ai-client.ts`:
    - `createAIClient(routingTable: ModelRoutingTable)` — factory
    - `callModel(task, prompt, options?)` — looks up routing table, calls correct provider
    - Try-catch failover: if primary fails, attempts fallback provider
    - Uses Vercel AI SDK `generateText()` under the hood
    - Adapter pattern: `getProviderSDK(provider)` returns raw SDK for provider-specific features
  - [ ] Default routing table with sensible defaults for common tasks

- [ ] Task 4: Create usage tracking (AC: #9, #10)
  - [ ] Create `packages/db/src/schema/metering.ts`:
    - `usage_events` table: `id` (UUID v7), `tenant_id` (FK → tenants), `event_type` (text: model_call, voice_minute, sms, storage), `provider` (text), `model` (text), `task` (text), `input_tokens` (integer), `output_tokens` (integer), `latency_ms` (integer), `cost_estimate` (numeric), `metadata` (JSONB), `created_at` (timestamp)
    - Index on `tenant_id` + `created_at`
  - [ ] Update `packages/db/src/schema/index.ts` — export usage_events
  - [ ] Update `packages/db/src/index.ts` — export new schema
  - [ ] Create `packages/shared/src/ai/usage-tracker.ts`:
    - `trackUsage(tenantId, event)` — inserts usage_event record
    - Integrate into `callModel` — automatically tracks every model call

- [ ] Task 5: Create benchmark test harness (AC: #8)
  - [ ] Create `packages/shared/src/ai/benchmark.ts`:
    - `runBenchmark(testCases: BenchmarkCase[], routingTable)` — runs each test case against configured models
    - `BenchmarkCase` type: `{ prompt: string, expectedOutput: string, task: string }`
    - Scores: accuracy (fuzzy match), latency, cost
    - Returns `BenchmarkResult[]` with per-provider scores
  - [ ] Create sample benchmark cases for classification and text generation tasks

- [ ] Task 6: Python LangGraph scaffold (AC: #2)
  - [ ] Create `services/agents/src/ai_client.py`:
    - Mirror of TypeScript ModelProvider concept for Python
    - Uses `anthropic` and `openai` Python SDKs
    - Model routing from config (reads same ModelRoutingTable format via JSON)
    - Basic failover: try primary, fallback on exception
  - [ ] Update `services/agents/pyproject.toml` if new deps needed

- [ ] Task 7: Write tests (AC: all)
  - [ ] Create `packages/shared/src/ai/ai-client.test.ts`:
    - Routing table resolves correct provider for task
    - Failover attempts secondary when primary throws
    - Unknown task throws clear error
  - [ ] Create `packages/shared/src/ai/benchmark.test.ts`:
    - Benchmark runner produces results with expected shape
  - [ ] Create `packages/db/src/schema/metering.test.ts`:
    - usage_events schema has correct columns
    - tenant_id is NOT NULL
  - [ ] Verify `pnpm build` and `pnpm typecheck` pass

## Dev Notes

### Architecture Compliance

**Vercel AI SDK (TypeScript) + LangGraph (Python):**
- Architecture specifies hybrid: Python for agent orchestration, TypeScript for frontend delivery and streaming
- Vercel AI SDK v6+ handles `useChat()`, streaming, model-agnostic calls
- LangGraph handles agent state machines, tool use, multi-step reasoning
- Both use the same ModelRoutingTable config format

**Per-Agent Per-Task Model Routing:**
- `agent_configs.modelRouting` (Story 1.8) stores per-task routing per agent
- This story creates the routing infrastructure; later stories populate it per agent
- Example: `{ "code_generation": { "provider": "anthropic", "model": "claude-sonnet-4-20250514", "fallback": { "provider": "openai", "model": "gpt-4o" } } }`

### Technology Versions

| Technology | Version | Notes |
|-----------|---------|-------|
| Vercel AI SDK | v6+ | `ai` package |
| @ai-sdk/anthropic | latest | Claude provider |
| @ai-sdk/openai | latest | OpenAI provider |
| anthropic (Python) | v0.52+ | Already in pyproject.toml |
| openai (Python) | v1.86+ | Already in pyproject.toml |

### File Structure

```
packages/shared/src/ai/
├── index.ts              # Barrel export
├── model-provider.ts     # Interface + routing types
├── ai-client.ts          # Provider routing + failover
├── usage-tracker.ts      # Usage event logging
├── benchmark.ts          # Benchmark test harness
├── ai-client.test.ts
└── benchmark.test.ts

packages/db/src/schema/
└── metering.ts           # usage_events table

services/agents/src/
└── ai_client.py          # Python model routing mirror
```

### Previous Story Learnings

- Lazy patterns needed for Next.js build (don't evaluate at import time)
- `usage_events` table follows same pattern as others: UUID v7 PK, tenant_id FK, timestamps
- Mock external services in unit tests — don't call real AI APIs
- P0 naming convention: `*.p0.test.ts` for critical tests

### What This Story Does NOT Do

- No actual agent logic (Epic 2a)
- No `useChat()` frontend integration (Epic 3)
- No `agent_configs.modelRouting` storage (Story 1.8)
- No automated model evaluation pipeline (Growth)
- No billing based on usage (Story 0.10)

### References

- [Source: architecture.md — Vercel AI SDK v6 + LangGraph hybrid decision]
- [Source: architecture.md — per-agent per-task model routing]
- [Source: architecture.md — usage_events table in metering.ts]
- [Source: epic-review-findings.md — findings 11-16 on multi-model routing]
- [Source: epics.md — Story 0.7 acceptance criteria, lines 559-578]

## Dev Agent Record

### Agent Model Used

(to be filled by dev agent)

### Debug Log References

### Completion Notes List

### Change Log

### File List

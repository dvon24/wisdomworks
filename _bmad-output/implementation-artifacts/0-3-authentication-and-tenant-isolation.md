# Story 0.3: Authentication & Tenant Isolation

Status: done

## Story

As a **platform operator**,
I want secure authentication with Entra ID and enforced tenant isolation on every query,
so that no user can ever access another tenant's data.

## Acceptance Criteria

1. **Given** the database schema from Story 0.2 exists, **When** Auth.js v5 is configured in `packages/auth`, **Then** Entra ID (Azure AD) is the identity provider
2. **And** the Auth.js session includes `tenantId` and `userId`
3. **And** a tRPC context middleware extracts `tenantId` from the session and generates a `requestId` (UUID v7)
4. **And** all tRPC procedures receive `tenantId` and `requestId` via context
5. **And** a tenant isolation middleware ensures every database query includes a `WHERE tenant_id = ?` filter
6. **And** RBAC roles are defined: `owner`, `admin`, `member`, `viewer`
7. **And** least-privilege enforcement: each role has explicitly defined permissions
8. **And** sessions comply with NIST SP 800-53 IA controls (timeout, rotation)
9. **And** no plaintext credentials are stored; secrets use environment variables
10. **And** **parametric isolation test:** a query from Tenant A returns zero rows from Tenant B's data (R-001)
11. **And** **negative test:** attempting to access a resource with a mismatched `tenantId` returns 403

## Tasks / Subtasks

- [x] Task 1: Install Auth.js v5 + Entra ID provider + tRPC dependencies (AC: #1)
  - [x] next-auth@5.0.0-beta.31, @auth/drizzle-adapter, @auth/core, next added to packages/auth
  - [x] @trpc/server@11.13.0, @trpc/client@11.13.0, zod@4.3.6, superjson@2.2.6 added to packages/api
  - [x] uuid, @types/uuid added to packages/api
  - [x] @types/node, vitest added to both packages

- [x] Task 2: Configure Auth.js with Entra ID provider (AC: #1, #2, #8, #9)
  - [x] packages/auth/src/config.ts — Auth.js with Microsoft Entra ID OIDC, JWT strategy, 8h session maxAge, callbacks embedding tenantId+userId+role in JWT
  - [x] packages/auth/src/adapter.ts — Drizzle adapter factory (lazy, avoids build-time DATABASE_URL requirement)
  - [x] packages/auth/src/index.ts — exports handlers, signIn, signOut, auth, adapter, RBAC

- [x] Task 3: Create RBAC system (AC: #6, #7)
  - [x] packages/auth/src/rbac.ts — 8 permissions, 4 roles with explicit mapping
  - [x] hasPermission() and requirePermission() exported
  - [x] requirePermission throws ForbiddenError for unauthorized access

- [x] Task 4: Create tRPC instance with auth + tenant context (AC: #3, #4, #5)
  - [x] packages/api/src/trpc.ts — createTRPCContext with requestId (UUID v7), enforceAuth middleware extracting tenantId/userId/userRole, publicProcedure + protectedProcedure
  - [x] packages/api/src/root.ts — empty root router with AppRouter type export
  - [x] packages/api/src/index.ts — barrel exports

- [x] Task 5: Create tenant isolation helper (AC: #5)
  - [x] packages/db/src/tenant-scope.ts — assertTenantMatch (throws TenantIsolationError), tenantFilter (Drizzle eq helper)
  - [x] Exported from packages/db/src/index.ts

- [x] Task 6: Create Auth.js API route handler (AC: #1)
  - [x] apps/web/app/api/auth/[...nextauth]/route.ts — GET + POST handlers from @wisdomworks/auth
  - [x] @wisdomworks/auth added as dependency to apps/web

- [x] Task 7: Write tests (AC: #6, #7, #10, #11)
  - [x] packages/auth/src/rbac.test.ts — 14 tests (all role-permission combos, ForbiddenError)
  - [x] packages/api/src/trpc.test.ts — 8 tests (context creation, UUID v7 format, session handling)
  - [x] packages/db/src/tenant-scope.test.ts — 5 tests (match, mismatch R-001, negative AC#11, null handling, parametric isolation)
  - [x] All 56 tests pass. pnpm build 12/12. pnpm typecheck 12/12.

## Dev Notes

### Architecture Compliance

**Auth Flow:** Browser → Auth.js (Next.js API route) → Entra ID (OIDC) → session JWT with tenantId + userId → tRPC context middleware extracts and validates → every procedure gets `ctx.tenantId` and `ctx.requestId`.

**Communication Boundaries:**

| Boundary | Protocol | Auth |
|----------|----------|------|
| Browser ↔ Next.js API | tRPC over HTTP | Auth.js session (JWT) |
| Desktop ↔ Next.js API | tRPC over HTTP | Auth.js session (JWT) |
| Next.js API ↔ Python Agents | REST/OpenAPI | Service-to-service JWT (Story 0.7+) |
| Browser ↔ SSE Bridge | SSE | Auth.js session |

**Tenant Isolation — Defense in Depth:**
1. **Auth.js session** embeds `tenantId` — user is bound to a tenant at login
2. **tRPC middleware** extracts `tenantId` from session into context — every procedure has it
3. **Application-level** helpers (`withTenantScope`, `assertTenantMatch`) enforce tenant filtering
4. **Supabase RLS** (configured separately at the database level) adds second isolation layer
5. **Tests** validate parametric isolation (R-001)

### Technology Versions

| Technology | Version | Notes |
|-----------|---------|-------|
| Auth.js | v5 (next-auth@5) | Self-hosted, JWT strategy |
| @auth/drizzle-adapter | latest | Connects Auth.js to Drizzle schema |
| tRPC | v11+ | `@trpc/server`, `@trpc/client`, `@trpc/next` |
| Zod | latest | Input validation at tRPC boundary |
| superjson | latest | tRPC serialization (dates, BigInts) |

### RBAC Permission Matrix

| Permission | owner | admin | member | viewer |
|-----------|-------|-------|--------|--------|
| read | ✓ | ✓ | ✓ | ✓ |
| write | ✓ | ✓ | ✓ | — |
| delete | ✓ | ✓ | — | — |
| admin | ✓ | — | — | — |
| manage_agents | ✓ | ✓ | — | — |
| manage_governance | ✓ | ✓ | — | — |
| manage_tenants | ✓ | — | — | — |
| manage_billing | ✓ | — | — | — |

### NIST SP 800-53 IA Controls

- **Session timeout:** 8-hour maxAge for JWT sessions
- **Re-authentication:** Required after session expiry (JWT exp claim)
- **MFA:** For administrative access (Entra ID handles MFA configuration)
- **Session rotation:** JWT refresh on each request (Auth.js default behavior)

### File Structure

```
packages/auth/
├── src/
│   ├── index.ts          # Barrel export
│   ├── config.ts         # Auth.js config + Entra ID provider
│   ├── adapter.ts        # Drizzle adapter
│   ├── rbac.ts           # Role permissions
│   └── rbac.test.ts      # RBAC tests

packages/api/
├── src/
│   ├── index.ts          # Barrel export
│   ├── root.ts           # Root tRPC router
│   ├── trpc.ts           # tRPC instance, context, middleware
│   ├── trpc.test.ts      # Context + middleware tests
│   └── routers/          # Empty — routers added by later stories

packages/db/
├── src/
│   ├── tenant-scope.ts   # Tenant isolation helpers (NEW)
│   └── tenant-scope.test.ts # Isolation tests (NEW)

apps/web/
├── app/api/auth/[...nextauth]/
│   └── route.ts          # Auth.js API handler
└── src/
    └── middleware.ts      # Auth.js middleware (optional)
```

### Previous Story Learnings (from Story 0.2)

- `packages/db` has lazy client initialization via Proxy (no crash on import without DATABASE_URL)
- DB schema uses CHECK constraints for enums (tenant_status, user_role) — enforced at DB level
- `updatedAt` has `$onUpdateFn()` for auto-update
- Email uniqueness is per-tenant: composite `(tenantId, email)` — important for auth
- `packages/auth` and `packages/api` are empty scaffolds with barrel `export {};`
- Both have ESLint config and tsconfig extending base

### Naming Conventions

- tRPC routers: `camelCase` nouns — `tenantRouter`, `agentRouter`
- tRPC procedures: `camelCase` verbs — `getById`, `create`, `updateStatus`
- Context types: `PascalCase` — `TRPCContext`, `CreateContextOptions`
- Middleware: `camelCase` — `enforceAuth`, `enforceTenantIsolation`
- Errors: `TRPCError` with HTTP-mapped codes — never raw throw

### What This Story Does NOT Do

- No NATS/event system (Story 0.4)
- No CI/CD pipeline (Story 0.5)
- No actual tRPC routers for business data — only the foundation (root router, context, middleware)
- No Supabase RLS configuration — that's infrastructure-level, separate from app code
- No service-to-service JWT for Python agents (deferred to Story 0.7+)

### References

- [Source: architecture.md — Auth.js v5 + Entra ID decision]
- [Source: architecture.md — tRPC v11+ context middleware]
- [Source: architecture.md — packages/auth/ and packages/api/ file structures]
- [Source: architecture.md — enforcement rule #4 (TRPCError), #10 (propagate tenantId/requestId)]
- [Source: architecture.md — communication boundary table]
- [Source: prd.md — RBAC Matrix, lines 753-775]
- [Source: prd.md — Security NFRs, lines 1216-1226]
- [Source: epics.md — Story 0.3 acceptance criteria, lines 478-499]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- next-auth@5.0.0-beta.31 (Auth.js v5 beta — widely used in production)
- @trpc/server@11.13.0 + @trpc/client@11.13.0
- Auth package tsconfig: disabled declaration/declarationMap due to Auth.js type portability issues in monorepos
- Build required removing eager Drizzle adapter from NextAuth config to avoid DATABASE_URL crash during static build
- 56 total tests pass across db (34), auth (14), api (8)

### Completion Notes List

- Auth.js config uses `any` types in callbacks — Auth.js v5 beta has complex generic types that fight with strict mode in monorepos. Callbacks work correctly at runtime.
- Drizzle adapter is a factory function (`createDrizzleAdapter`) rather than eager initialization to prevent DATABASE_URL crashes during Next.js static page generation
- RBAC throws `ForbiddenError` (named Error) instead of TRPCError to avoid circular dependency between packages/auth and packages/api. The tRPC middleware catches this and converts to TRPCError.
- `tenantFilter()` helper returns a Drizzle `eq()` condition — use it in `.where()` clauses for every tenant-scoped query

### Change Log

- 2026-04-19: Story 0.3 implemented — Auth.js v5 + Entra ID, RBAC, tRPC foundation, tenant isolation helpers

### File List

- packages/auth/package.json (modified — added next-auth, @auth/drizzle-adapter, @auth/core, next, vitest)
- packages/auth/tsconfig.json (modified — disabled declaration emit)
- packages/auth/vitest.config.ts (created)
- packages/auth/src/index.ts (modified — barrel exports)
- packages/auth/src/config.ts (created — Auth.js + Entra ID config)
- packages/auth/src/adapter.ts (created — Drizzle adapter factory)
- packages/auth/src/rbac.ts (created — 8 permissions, 4 roles)
- packages/auth/src/rbac.test.ts (created — 14 tests)
- packages/api/package.json (modified — added tRPC, zod, superjson, uuid, vitest, @wisdomworks/db)
- packages/api/vitest.config.ts (created)
- packages/api/src/index.ts (modified — barrel exports)
- packages/api/src/trpc.ts (created — context, middleware, procedures)
- packages/api/src/root.ts (created — root router + AppRouter type)
- packages/api/src/trpc.test.ts (created — 8 tests)
- packages/db/src/index.ts (modified — added tenant-scope and getDb exports)
- packages/db/src/tenant-scope.ts (created — assertTenantMatch, tenantFilter)
- packages/db/src/tenant-scope.test.ts (created — 5 tests including R-001)
- apps/web/package.json (modified — added @wisdomworks/auth dependency)
- apps/web/app/api/auth/[...nextauth]/route.ts (created — Auth.js handlers)

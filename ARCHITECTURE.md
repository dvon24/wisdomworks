# WisdomWorks — Architecture Boundary Rules

## Workspace Structure

```
wisdomworks/
├── apps/           # Deployable applications
│   ├── web/        # Operations Console (Next.js → Vercel)
│   ├── website/    # Public marketing site (Next.js → Vercel)
│   └── desktop/    # Desktop Agent (Tauri v2)
├── packages/       # Shared libraries (never deployed alone)
│   ├── api/        # tRPC router
│   ├── auth/       # Auth.js v5 + Entra ID
│   ├── db/         # Drizzle ORM schema + migrations
│   ├── globe/      # Globe renderer (R3F/Three.js)
│   ├── shared/     # Shared types, constants, utilities
│   └── ui/         # Component library (shadcn/ui)
└── services/       # Backend services (Docker containers)
    ├── agents/     # Python — LangGraph agent orchestration
    ├── signal-layer/ # NATS JetStream
    └── ingestion/  # Data ingestion pipeline
```

## Import Boundary Rules

1. **Packages** never import from apps or services
2. **Apps** import from packages only (not from other apps or services)
3. **Services** communicate via REST/NATS only (no direct imports across service boundaries)
4. Each package exposes a single `index.ts` entry point — no internal barrel files

## Organization Rules

- **Apps:** feature-based organization (`apps/web/src/features/dashboard/`)
- **Packages:** type-based organization (`packages/ui/src/components/buttons/`)

## Naming Conventions

| Context | Convention | Example |
|---------|-----------|---------|
| DB columns | `snake_case` | `tenant_id` |
| TS functions/variables | `camelCase` | `getTenant` |
| React components | `PascalCase.tsx` | `GlobeCanvas.tsx` |
| Non-component TS files | `kebab-case.ts` | `globe-store.ts` |
| Hooks | `useCamelCase` | `useQualityTier` |
| Constants | `UPPER_SNAKE_CASE` | `MAX_RETRY_COUNT` |
| NATS subjects | `dot.separated.lowercase` | `ontology.tenant123.updated` |
| Python files | `snake_case.py` | `agent_orchestrator.py` |

## Testing

- Co-locate tests with source files — never create a separate `__tests__/` directory
- `EntityRenderer.tsx` → `EntityRenderer.test.tsx` (same directory)
- Python: `agent_orchestrator.py` → `test_agent_orchestrator.py`

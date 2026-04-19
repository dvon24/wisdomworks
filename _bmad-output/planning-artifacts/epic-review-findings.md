# Epic Structure Review — Party Mode Findings

**Date:** 2026-04-05
**Participants:** Bob (Scrum Master), John (Product Manager), Winston (Architect), Barry (Quick Flow Solo Dev), Murat (TEA), Carson (Brainstorming Coach), Victor (Innovation Strategist)
**Topic:** Review of proposed 9-epic structure for WisdomWorks MVP + Growth Vision Expansion

---

## Proposed Epic Structure (Pre-Review)

9 epics covering 124 FRs + 44 NFRs:

1. Platform Foundation & Secure Access
2. Organizational Knowledge Model
3. Email Intelligence & Privacy Boundary
4. Personal Agent & Daily Productivity
5. Agent Network & Cross-Org Intelligence
6. Operations Console & Platform Management
7. 3D Intelligence Globe
8. Governance, Compliance & Audit
9. Desktop Agent Runtime

---

## All 21 Findings

| # | Finding | Raised By | Recommendation | Impact |
|---|---------|-----------|----------------|--------|
| 1 | Epic 1 overloaded — split dev pipeline from auth | Bob | Split into Epic 0 (Dev Pipeline) + Epic 1 (Auth & Tenants) | Epic restructure |
| 2 | Epic 9 too large (42 FRs) — many are Growth scope | Bob, Barry | Strip to Tauri shell + chat; move Remote Command, Passive Mode to Growth | Scope reduction |
| 3 | Scope creep in MVP — Remote Command, Passive Mode, full artifact suite | John | Move FR114-FR128 and most of FR45-FR50 to Growth | Scope reduction |
| 4 | Showcase mode (FR85) isn't a feature — it's the product working | John | Fold into whichever epic delivers first end-to-end demo | Epic merge |
| 5 | Epic 2 (Ontology) is empty without data source | Winston | Include test data seeding or basic ingestion in Epic 2 | Epic content |
| 6 | Globe (Epic 7) is highest risk — scope to minimal viable | Winston, Barry | MVP: entities + connections + basic zoom. Particle effects/semantic zoom = Growth | Scope reduction |
| 7 | Governance foundations should be in Epic 1, not Epic 8 | Winston | Basic audit logging + allow/deny rules in platform foundation; advanced governance UI later | Epic restructure |
| 8 | 9 epics / 90 days / solo dev is too many | Barry | Target 5-6 focused epics | Epic consolidation |
| 9 | Sprint timeline reality: ~10 days per epic max | Barry | Prioritize ruthlessly | Planning |
| 10 | Artifact generation — ship PDF only at MVP | John | FR45-FR47 (PPT, Excel, Word) deferred to Growth | Scope reduction |
| 11 | Multi-model routing is foundational, not a separate epic | John, Winston | Weave Model Abstraction Layer into Epic 1 foundation, used by all subsequent agent stories | Architecture |
| 12 | Task-to-model config map is the cost control mechanism | Winston, John | Ship with at least 2 providers (OpenAI + Anthropic) and per-task routing config | Architecture |
| 13 | Model swap regression test is P0 acceptance criteria | Murat | Epic 1 Model Abstraction story must include benchmark test harness | Testing |
| 14 | Provider failover needed for uptime and government path | John, Murat | Basic try-catch fallback at MVP; circuit breaker at Growth | Architecture |
| 15 | Don't over-engineer — interface + config + 2 providers | Barry | Simple abstraction, Vercel AI SDK + LangGraph both support multi-provider already | Architecture |
| 16 | Use Vercel AI SDK (TS) + LangGraph (Python) as the abstraction — not direct SDKs, not raw APIs | Winston, Barry | Already in architecture. Ship with 2 providers (Anthropic + OpenAI). Gemini add-on. Direct SDK only for provider-specific features via adapter pattern | Confirms architecture |
| 17 | Agents should be deployed on optimal models based on empirical benchmarks, not static global config | Devon, Winston | `agent_configs.modelRouting` stores per-task model routing per agent instance | Schema + deployment |
| 18 | Model fitness evaluation is a consulting deliverable and differentiator | John | Axis team runs benchmarks during deployment, proves model selection with evidence | Business value |
| 19 | Benchmark harness per role category needed (coding, comms, analytics, classification) | Murat | MVP: manual benchmark with 50 test cases per category. Growth: automated evaluation pipeline | Testing |
| 20 | MVP: manual model assignment with benchmark data. Growth: automated recommendation engine | Barry | Ship the config schema + simple benchmark. Automate at Growth | Phasing |
| 21 | Per-agent model routing impacts Epic 2 (Ontology/Axis team) and Epic 4 (Personal Agent) | All | Axis team deployment workflow includes model fitness step; agent provisioning uses per-task routing | Epic content |

---

## Key Scope Decisions

### Moved to Growth (NOT MVP)

- FR114-FR121: Remote Agent Command (external email commands)
- FR122-FR128: Passive Agent Mode (observation, suggestions, feedback loops)
- FR45-FR47: PowerPoint, Excel, Word generation (keep PDF only at MVP)
- Globe particle effects, 7 connection type animations, full semantic zoom (L4-L5)
- Automated model fitness evaluation pipeline
- Circuit breaker failover pattern
- Gemini provider (add when needed)

### Added to MVP

- Model Abstraction Layer with 2 providers (Anthropic + OpenAI) in Epic 1
- Per-agent `modelRouting` config in `agent_configs` schema
- Basic model benchmark harness (50 test cases per role category)
- Basic governance foundations (audit logging + allow/deny rules) in Epic 1
- Test data seeding in Epic 2 to prove ontology works with data

---

## Revised Epic Structure (Recommended)

Based on all 21 findings, the team recommends consolidating to **6-7 epics**:

### Epic 0: Repository, Dev Pipeline & Platform Foundation (Sprint 0)
- Monorepo initialization (Turborepo + pnpm)
- Database schema (18 tables, Drizzle ORM, pgvector)
- Auth.js v5 + Entra ID + tenant isolation
- NATS JetStream + Docker Compose
- CI/CD (GitHub Actions + Turborepo)
- Sprint 0 test infrastructure (B-002, B-003, B-004)
- Model Abstraction Layer (Vercel AI SDK + LangGraph, 2 providers)
- Basic governance foundations (audit logging, allow/deny rules)
- **User value:** Developer can build, test, and deploy the platform. Auth and tenant isolation work. Multi-model AI abstraction operational.

### Epic 1: Organizational Intelligence Foundation (Sprint 1)
- Ontology construction (Axis team workflow)
- Entity model with JSONB metadata + Zod validation
- NATS event system (DomainEvent<T>, streams, KV)
- Basic email ingestion pipeline (B-001 gate: Exchange webhook)
- Privacy boundary (classification + purge)
- Test data seeding to prove ontology with data
- Per-agent model routing config (`agent_configs.modelRouting`)
- **User value:** The Axis team can model an organization and email flows into organizational intelligence with strict privacy.

### Epic 2: Personal Agent & Morning Briefing (Sprint 2)
- Personal agent creation (role-derived from ontology)
- Morning briefing generation
- Email drafting + grammar correction
- Task management + calendar awareness
- Knowledge base queries
- Agent state persistence + cloud sync
- Model fitness evaluation (manual benchmark per role)
- PDF artifact generation (only PDF at MVP)
- **User value:** Each employee has a personal AI agent running on the optimal model for their role.

### Epic 3: Agent Network & Signal Intelligence (Sprint 2-3)
- Agent-to-agent communication via structured signals
- Cross-agent task coordination
- Cross-agent discovery (connections humans missed)
- BMAD innovation engine
- Signal routing governance
- **User value:** Agents collaborate across the organization, discovering hidden intelligence.

### Epic 4: Operations Console & Dashboards (Sprint 3)
- Admin portal (environment overview, agent health, data flow)
- Dashboard views (individual, team, functional, program, enterprise)
- Agent deployment & lifecycle management
- Engagement tracking + consulting lifecycle
- Public website (product info, onboarding)
- Showcase = the product working (FR85 folded in)
- **User value:** Devon can monitor, manage, and demonstrate the entire platform.

### Epic 5: 3D Intelligence Globe (Sprint 3-4)
- Minimal viable globe (entities + connections + basic zoom)
- Connected/fractured toggle (simplified animation)
- Quality tier system (full/reduced/minimal fallback)
- Basic query visualization (AI-driven globe state)
- **User value:** Organizational intelligence explored through interactive 3D visualization.
- **Deferred to Growth:** Full semantic zoom (L4-L5), 7 particle-flow connection types, saved lenses

### Epic 6: Desktop Agent & Tauri Shell (Sprint 4)
- Tauri v2 app shell rendering web app
- Desktop chat window
- Basic terminal channel
- Agent interaction across channels
- **User value:** The AI agent lives on the desktop.
- **Deferred to Growth:** Outlook integration, app control, remote commands, passive observation mode

---

## Architecture Updates Needed

1. **`agent_configs` schema:** Add `modelRouting: jsonb` field for per-task model config per agent
2. **Axis team deployment workflow:** Add model fitness evaluation step
3. **Model Abstraction Layer:** Explicit story in Epic 0 with benchmark test harness
4. **PRD update:** FR71 (multi-model) should reference per-agent routing, not just per-platform

---

## Growth Vision: Self-Deploying AI Platform (Findings 22-35)

### Vision Statement

WisdomWorks evolves from "organizational intelligence for consulting firms" to **"Tell us what you need. AI builds it. AI runs it. AI improves it."** — a self-deploying AI platform that serves any business from solo hair stylist ($50/mo) to defense contractor ($25K/mo).

### Additional Findings (Round 2 & 3)

| # | Finding | Raised By | Recommendation |
|---|---------|-----------|----------------|
| 22 | Self-deploying AI platform = "Shopify for org intelligence" — the Growth/Scale vision | Devon, Victor | Capture as Growth vision in PRD. Not MVP scope but influences MVP architecture |
| 23 | AI Onboarding Agent replaces manual Axis team at Growth | Winston, John | Design Axis team workflow (FR28-FR30) to be automatable — structured data collection, scriptable provisioning |
| 24 | Dynamic pricing engine calculates subscription from org profile | Winston | Add pricing model config to schema. MVP: manual pricing. Growth: calculated from factors |
| 25 | Automated instance provisioning requires infra-as-code | Winston, Barry | MVP: scriptable provisioning workflow. Growth: fully automated via control plane |
| 26 | Zero marginal cost per deployment = pure software margins | Victor | Revenue model shifts from consulting-limited to platform-unlimited |
| 27 | Onboarding conversation IS the product demo — the AI sells itself | Victor, John | The quality of the onboarding AI directly drives conversion |
| 28 | MVP architecture must not block self-service: scriptable provisioning, structured onboarding data, instance lifecycle API | Barry | Design for automation even if manual at MVP |
| 29 | WisdomWorks is a platform factory — "Tell us what you need, AI builds it, AI runs it, AI improves it" | Devon | Capture as Growth/Scale vision. Defines the destination |
| 30 | Customer spectrum: $50/mo salon to $25K/mo defense contractor — same platform, different deployment tiers | John, Winston | Design deployment tier system (Micro/Small/Standard/Enterprise/Air-Gapped) |
| 31 | Industry template library + AI customization hybrid for onboarding | Winston | Templates accelerate, conversation customizes. MVP: manual templates. Growth: AI-driven |
| 32 | BMAD innovation engine works at every tier — salon to defense | Winston, All | Already in FRs (FR58-FR61). Build for consulting firm, works everywhere |
| 33 | Micro tier (SQLite + Ollama + single app) could serve solo businesses for $5-15/mo | Winston | Architecture decision: design packages so they work with minimal dependencies |
| 34 | AI Onboarding Agent IS the sales funnel — quality = conversion | Murat, John | Onboarding conversation quality is a first-class testing concern at Growth |
| 35 | MVP architecture decisions must not block the self-service platform future | Barry | Structured data, scriptable provisioning, multi-tenant, per-agent routing — all in MVP |

### Customer Spectrum

| Customer | They Say | WisdomWorks Builds | Price Point |
|----------|---------|-------------------|-------------|
| Solo hair stylist | "I need appointment scheduling with text reminders" | Scheduling agent + SMS + calendar + client mgmt | $50-100/mo |
| Local restaurant | "I need reservations and review monitoring" | Booking agent + review aggregation + inventory | $100-200/mo |
| Real estate office (10) | "I need lead tracking and showing coordination" | Lead agent + calendar + docs + market analysis | $300-500/mo |
| Consulting firm (50) | "I need organizational intelligence" | Full WisdomWorks (current MVP) | $2,000-5,000/mo |
| Defense contractor (500) | "I need classified signal processing" | Enterprise + compliance + white-glove Axis | $10,000-25,000/mo |
| Manufacturing company | "I need prototyping pipeline with 3D printer" | Manufacturing agent + hardware + design workflow | $1,000-3,000/mo |

### Deployment Tiers

| Tier | Stack | Users | Cost to Run | Use Case |
|------|-------|-------|-------------|----------|
| **Micro** | Next.js + SQLite + Ollama | 1-5 | $5-15/mo | Solo/small business |
| **Small** | Next.js + PostgreSQL + NATS (single container) | 5-50 | $50-150/mo | Small teams |
| **Standard** | Full stack (current architecture) | 50-500 | $200-2,000/mo | Mid-size orgs |
| **Enterprise** | Full stack + dedicated infra + compliance | 500+ | $5,000+/mo | Government/enterprise |
| **Air-Gapped** | Self-hosted, local LLM, no cloud | Any | Hardware only | SCIF/classified |

### Industry Template Library

```
Templates (starting scaffolds, customized by AI conversation):
├── Professional Services (consulting, legal, accounting)
├── Small Business / Retail (salon, restaurant, shop)
├── Manufacturing / R&D (factory, lab, prototyping)
├── Government / Defense (cleared, compliance-heavy)
├── Healthcare (HIPAA, patient management)
└── Custom (AI builds from scratch via conversation)
```

### How BMAD Works at Every Tier

```
Monitor Business Signals → Detect Pattern/Anomaly/Opportunity
→ Generate BMAD Solution Brief → Present to Owner with Confidence Score
→ Owner Approves → Agent Implements → Monitor Results → Learn
```

- **Salon:** "73% of no-shows are first-time online bookings → suggest $10 deposit"
- **Consulting:** "Two teams solving same problem → surface connection"
- **Defense:** "Signal pattern matches threat indicator → escalate to analyst"
- **Restaurant:** "Thursday dinner reservations dropped 40% this month → suggest promotion"

### MVP Architecture Decisions That Enable This Vision

1. **Structured Axis team data collection** → automatable by AI later
2. **Scriptable instance provisioning** → API-driven later
3. **Multi-tenant isolation** → multi-tier deployment later
4. **Per-agent model routing** → auto-optimization later
5. **BMAD innovation engine (FR58-FR61)** → works at any tier from day one
6. **Template-based workflows** → template library later
7. **Modular package structure** → packages work with minimal dependencies (enables Micro tier)

---

## Axis Team at Every Scale (Findings 36-40)

### The Axis Team IS the Product

The Axis team's role is identical at every scale — discover the org structure, derive agents, connect them via signals, optimize models, and continuously improve via BMAD. For a salon, that's 3-4 coordinated agents. For a defense contractor, that's 200+.

### Small Business Agent Teams

Even a solo hair stylist gets a full coordinated team:

| Agent | Function | Signals It Sends | Signals It Receives |
|-------|----------|-----------------|-------------------|
| **Scheduler** | Appointments, reminders, cancellations | Booking patterns, empty slots, no-show data | Promotion schedules from Marketing |
| **Marketing** | Social media, Google Business, promotions, email campaigns | Campaign results, engagement metrics | Empty slot data from Scheduler, analytics from Website |
| **Website Manager** | Build/maintain site, SEO, online booking widget, publish promos | Traffic analytics, conversion data | Availability from Scheduler, promo content from Marketing |
| **Customer Service** | Review responses, follow-ups, loyalty program | Satisfaction scores, retention data | Booking history from Scheduler, campaign context from Marketing |

The Axis intelligence layer coordinates: Scheduler spots empty Tuesday → Marketing creates promo → Website publishes → Customer Service follows up with past clients → Axis monitors results.

### Agent Output Channels

Agents don't just analyze — they act through output channels:

```
Agent Output Channels:
├── Documents (PDF, Word, Excel, PPT) — MVP
├── Emails (draft, send) — MVP
├── Calendar events — MVP
├── Websites (build, deploy, maintain) — Growth
├── SMS/text messages — Growth
├── Social media posts — Growth
├── 3D print jobs — Growth
├── Invoices, contracts, proposals — Growth
└── [extensible via plugin architecture]
```

MVP data model should capture which output channels exist per organization even if only email/docs/calendar are implemented.

### Additional Findings (Round 4)

| # | Finding | Raised By | Recommendation |
|---|---------|-----------|----------------|
| 36 | Every deployment gets a full agent team — Scheduler + Marketing + Website + Customer Service even for a salon | John, Devon | Axis team derives agent roster at any scale; agent count scales with business complexity |
| 37 | Axis intelligence layer IS the product — coordination between agents creates value, not individual agents | Devon, John | Same signal layer, same BMAD engine at every tier |
| 38 | Website builder is an agent output endpoint — agents CREATE and MANAGE client websites | Winston | Growth: AI generates + deploys + maintains websites from templates |
| 39 | Agent output channels model: email, websites, SMS, social, documents, calendar, hardware | Barry | MVP data model captures output channels per org, even if only email/docs implemented |
| 40 | Small business tier needs MORE reliability — no IT team to catch errors | Murat | Governance framework supports fine-grained approval gates per action type |

---

## Axis Team Full Deployment Workflow (Findings 41-44)

### Complete Axis Team Workflow

```
1. UNDERSTAND — Interview/conversation about the business
2. DERIVE — Agent roster from organizational structure
3. DETERMINE — Surfaces needed (website, mobile app, desktop, dashboard)
4. EVALUATE — Benchmark models per agent per task (Gemini vs OpenAI vs Anthropic)
5. CONNECT — Signal layer wiring between all agents
6. DEPLOY — Provision infrastructure, deploy agents, launch surfaces
7. MONITOR — BMAD continuous improvement cycle
```

### Model Evaluation Per Agent Per Task

The Axis team doesn't pick one model — it benchmarks candidates per task:

```
Example: Salon Scheduler Agent
├── Parse appointments: Haiku wins (94% accuracy, fastest, cheapest)
├── Write promotions: GPT-4o wins (4.2/5 quality rating)
└── Analyze patterns: Sonnet wins (96% pattern detection)

Result: 3 different models for 3 different tasks on ONE agent
```

### AxisDeploymentSpec Schema

```typescript
type AxisDeploymentSpec = {
  organization: { name, industry, size, compliance }
  surfaces: { website?, mobileApp?, desktopApp?, webDashboard }
  agents: Array<{
    role, name,
    modelRouting: Record<taskType, { provider, model, benchmarkScore, fallback }>,
    outputChannels: string[],
    governanceRules: GovernanceRule[]
  }>
  integrations: Array<{ type, config }>
  pricing: { tier, monthlyBase, modelCostEstimate, total }
}
```

MVP: stored in `tenant_configs`, manually populated. Growth: AI-generated from onboarding conversation.

### Additional Findings (Round 5)

| # | Finding | Raised By | Recommendation |
|---|---------|-----------|----------------|
| 41 | Axis team determines surfaces to deploy (website, mobile app, desktop) based on business needs + industry best practices | Devon, Winston | `AxisDeploymentSpec.surfaces` captures deliverables per org |
| 42 | Model evaluation is per-agent per-task, choosing optimal provider based on benchmarks | Devon, Winston | Benchmark harness tests candidates against role-specific test cases |
| 43 | Model evaluation results are a consulting deliverable and competitive differentiator | John | Evidence-based model selection creates switching cost |
| 44 | AxisDeploymentSpec schema captures full deployment config | Barry | Goes into `tenant_configs` at MVP; manually populated now, AI-generated at Growth |

---

## MVP Pivot: Self-Deploying Platform (Findings 45-48)

### The Pivot

Devon decided the MVP IS the self-deploying platform — not a consulting-only tool. The consulting firm becomes the first customer deployed through the same AI onboarding pipeline as any other business.

### Additional Findings (Round 6)

| # | Finding | Raised By | Recommendation |
|---|---------|-----------|----------------|
| 45 | Agents and Axis team must operate autonomously — human-in-the-loop is opt-in, not default | Devon | Progressive autonomy via `governanceRules` per agent; approval gates reduce as trust/accuracy increases |
| 46 | MVP IS the self-deploying platform, not a consulting tool | Devon | MVP must demonstrate: conversation → AxisDeploymentSpec → agents deployed → running autonomously |
| 47 | Devon's consulting firm = first customer through the self-deploying pipeline | Devon, Victor | Hardest use case validates the platform — if it handles 200+ agents, it handles 4 for a salon |
| 48 | Full demo loop MVP: AI onboarding + agent runtime + dashboard, working end-to-end for 1-2 industry templates | Devon | Dashboard is real, agent runtime is real, AI onboarding is real. No website/mobile app generation at MVP |

### Revised Epic Structure (Self-Deploying Platform MVP)

Based on ALL 48 findings, the epic structure must be redesigned around the self-deploying platform:

#### Epic 0: Repository, Dev Pipeline & Platform Foundation (Sprint 0)
- Monorepo initialization (Turborepo + pnpm)
- Database schema (18+ tables, Drizzle ORM, pgvector)
- Auth.js v5 + Entra ID + tenant isolation
- NATS JetStream + Docker Compose
- CI/CD (GitHub Actions + Turborepo)
- Sprint 0 test infrastructure (B-002, B-003, B-004)
- Model Abstraction Layer (Vercel AI SDK + LangGraph, 2 providers)
- Basic governance foundations (audit logging, allow/deny rules)
- AxisDeploymentSpec schema in `tenant_configs`
- **User value:** Platform can build, test, deploy, and host multi-tenant agent systems with multi-model AI.

#### Epic 1: AI Onboarding & Axis Intelligence Engine (Sprint 1)
- Conversational AI onboarding flow (natural language → structured data)
- AxisDeploymentSpec generation from conversation
- Industry template scaffolding (Professional Services + Small Business)
- Axis team workflow: Understand → Derive → Determine → Evaluate → Connect → Deploy → Monitor
- Ontology construction from onboarding data
- Per-agent model routing config + basic benchmark harness
- Automated agent provisioning from AxisDeploymentSpec
- **User value:** A business owner describes their needs → AI builds their AxisDeploymentSpec → agents are derived and deployed automatically.

#### Epic 2: Agent Runtime & Signal Intelligence (Sprint 2)
- Agent execution engine (LangGraph orchestration)
- Agent-to-agent communication via structured signals (NATS)
- Privacy boundary (email classification + purge)
- Email ingestion pipeline (Exchange webhook)
- Personal agent creation (role-derived from ontology)
- Morning briefing generation
- Email drafting + grammar correction
- Task management + basic calendar awareness
- Agent state persistence + cloud sync
- BMAD innovation engine (signal monitoring → solution briefs)
- Progressive autonomy framework (governance rules per agent per action)
- **User value:** Deployed agents actually run, communicate, process email, and improve the business — autonomously.

#### Epic 3: Operations Console & Intelligence Dashboard (Sprint 3)
- Admin portal (environment overview, agent health, data flow)
- Dashboard views (individual, team, enterprise)
- Agent lifecycle management (deploy, pause, restart, update)
- Tenant management + deployment tracking
- Real-time agent activity feed
- BMAD solution brief review interface
- Showcase = the product onboarding itself
- Public website (product info, AI onboarding entry point)
- **User value:** Devon (and future customers) can monitor, manage, and demonstrate the entire platform. New customers onboard through the website.

#### Epic 4: 3D Intelligence Globe (Sprint 3-4)
- Minimal viable globe (entities + connections + basic zoom)
- Connected/fractured toggle (simplified animation)
- Quality tier system (full/reduced/minimal fallback)
- Basic query visualization (AI-driven globe state)
- **User value:** Organizational intelligence explored through interactive 3D visualization.
- **Deferred to Growth:** Full semantic zoom (L4-L5), particle-flow connections, saved lenses

#### Epic 5: Desktop Agent & Tauri Shell (Sprint 4)
- Tauri v2 app shell rendering web app
- Desktop chat window
- Basic terminal channel
- Agent interaction across channels
- **User value:** The AI agent lives on the desktop.
- **Deferred to Growth:** Outlook integration, app control, remote commands, passive observation mode

### What Changed from Previous Structure

| Aspect | Previous (Consulting MVP) | New (Self-Deploying MVP) |
|--------|--------------------------|-------------------------|
| **Entry point** | Manual Axis team configuration | AI onboarding conversation |
| **Target customer** | Devon's consulting firm only | Any business (salon → enterprise) |
| **Agent deployment** | Manual provisioning | Automated from AxisDeploymentSpec |
| **Autonomy** | Human approval required | Autonomous by default, approval opt-in |
| **Industry support** | Consulting only | 2 templates (Professional Services + Small Business) |
| **First customer** | Devon (manual setup) | Devon (through AI onboarding pipeline) |
| **Epic count** | 7 (Epic 0-6) | 6 (Epic 0-5), more focused |
| **Key new epic** | None | Epic 1: AI Onboarding & Axis Engine |
| **Merged** | Separate ontology + agent epics | Combined into Epic 2 (Agent Runtime) |

### Deferred to Growth

- Website generation (agent builds client websites)
- Mobile app generation
- SMS/text messaging
- Social media posting
- 3D print job integration
- Automated model fitness evaluation pipeline
- Dynamic pricing engine (auto-calculated)
- Remote Agent Command (FR114-FR121)
- Passive Agent Mode (FR122-FR128)
- PowerPoint, Excel, Word generation
- Circuit breaker failover
- Additional industry templates beyond 2

---

## Organizational Blueprints & Business Model (Findings 49-52)

### Additional Findings (Round 7)

| # | Finding | Raised By | Recommendation |
|---|---------|-----------|----------------|
| 49 | Axis team needs prebuilt organizational blueprints by size — reference architectures for agent roster, signal topology, and governance level | Devon | Create blueprint library: Solo (1-2 people, 3-4 agents), Small Team (3-20, 8-12 agents), Mid-Size (20-200, 30-60 agents), Enterprise (200+, 100+ agents), scaling agent count, signal complexity, and governance depth |
| 50 | Blueprints are distinct from industry templates — blueprints define org SHAPE (how many agents, what governance), templates define org FUNCTION (what agents DO) | Winston | Blueprint × Template = deployment spec. Solo × Salon = 4 agents doing hair stuff. Enterprise × Defense = 200+ agents doing classified stuff |
| 51 | Security deposit required before provisioning — customer pays upfront to cover infrastructure/LLM costs | Devon | Minimum deposit (e.g., $50-500 based on tier) + minimum trial commitment (30-60 days). Deposit applies to first invoice. No free tier — LLM costs are real from minute one |
| 52 | Demo should be shown to customer BEFORE deposit — prove value, then ask for commitment | Devon | Onboarding flow: AI conversation → generate demo/preview of their deployment → show agent roster + cost estimate → collect deposit → provision → deploy |

### Organizational Blueprint Library

Blueprints define the **shape** of the deployment — how many agents, how they connect, what governance level applies. Combined with industry templates (which define what agents DO), they produce the full AxisDeploymentSpec.

| Blueprint | Org Size | Agent Count | Signal Complexity | Governance | Example |
|-----------|----------|-------------|-------------------|------------|---------|
| **Solo** | 1-2 people | 3-4 agents | Simple (linear) | Minimal — mostly autonomous | Hair stylist, freelancer |
| **Small Team** | 3-20 people | 8-12 agents | Moderate (hub-and-spoke) | Light — approval on financials only | Small restaurant, real estate office |
| **Mid-Size** | 20-200 people | 30-60 agents | Complex (mesh network) | Standard — role-based approvals | Consulting firm, mid-size manufacturer |
| **Enterprise** | 200+ people | 100-300+ agents | Full mesh + hierarchical | Strict — compliance-driven, audit trail | Defense contractor, hospital system |
| **Air-Gapped** | Any | Varies | Isolated (no external signals) | Maximum — all actions logged | SCIF, classified environments |

```
Blueprint (org shape) × Template (industry function) = AxisDeploymentSpec

Example:
  Solo Blueprint × Salon Template = {
    agents: [Scheduler, Marketing, Website, CustomerService],
    signals: linear (Scheduler↔Marketing↔Website↔CustomerService),
    governance: { default: "autonomous", financial: "notify-owner" }
  }

  Enterprise Blueprint × Defense Template = {
    agents: [200+ role-derived agents across divisions],
    signals: hierarchical mesh with classification boundaries,
    governance: { default: "approval-required", routine: "autonomous", classified: "dual-approval" }
  }
```

### Customer Onboarding & Payment Flow

```
1. DISCOVER — Customer lands on website, starts AI conversation
2. UNDERSTAND — AI interviews about business (industry, size, needs)
3. PREVIEW — AI generates demo deployment preview:
   - Agent roster with roles and capabilities
   - Signal topology visualization
   - Estimated monthly cost breakdown (LLM + infra)
   - Blueprint + Template selection shown
4. DEMO — Customer sees their agents in action (sandbox/simulation)
5. COMMIT — Security deposit + minimum trial agreement:
   - Deposit: $50 (Solo) / $200 (Small) / $500 (Mid) / $2,000+ (Enterprise)
   - Minimum trial: 30 days (Solo/Small) / 60 days (Mid/Enterprise)
   - Deposit applies to first invoice
   - No free tier — LLM costs are real
6. PROVISION — Infrastructure spun up, agents deployed
7. ACTIVATE — Customer notified, agents begin operating
8. MONITOR — BMAD continuous improvement cycle begins
```

### Why No Free Tier

- Every agent call = LLM API cost (real money from minute one)
- Even Solo tier runs 3-4 agents making dozens of LLM calls daily
- Security deposit filters tire-kickers and proves intent
- Minimum trial ensures enough time for agents to demonstrate value
- Deposit applies to first invoice — it's not a fee, it's prepayment

---

## Status

- **Review:** Complete (MVP pivot + blueprints + business model applied)
- **Total Findings:** 52
- **Findings 1-21:** Epic structure review + multi-model routing
- **Findings 22-28:** Self-deploying platform vision + architecture implications
- **Findings 29-35:** Universal platform vision (any business, any size) + deployment tiers + BMAD at every tier
- **Findings 36-40:** Axis team at every scale + agent output channels + small business reliability
- **Findings 41-44:** Axis team full deployment workflow + model evaluation + AxisDeploymentSpec
- **Findings 45-48:** MVP pivot to self-deploying platform + autonomy + Devon's firm as first customer
- **Next step:** User approves revised epic structure → exit party mode → proceed to story creation (Step 3)

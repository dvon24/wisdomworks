---
stepsCompleted: [step-01-init, step-02-discovery, step-03-success, step-04-journeys, step-05-domain, step-06-innovation, step-07-project-type, step-08-scoping, step-09-functional, step-10-nonfunctional, step-11-polish, step-12-complete, step-e-01-discovery, step-e-02-review, step-e-03-edit]
workflowStatus: complete
inputDocuments:
  - "product-brief-devon-2026-02-12.md"
workflowType: 'prd'
documentCounts:
  briefs: 1
  research: 0
  projectDocs: 0
  projectContext: 0
classification:
  projectType: saas_b2b
  domain: ai_consulting
  complexity: high
  projectContext: greenfield
lastEdited: '2026-02-27'
editHistory:
  - date: '2026-02-24'
    changes: 'Three-layer restructure (Email Intelligence, Desktop Agent, Operations Console); added Desktop Agent Runtime, Remote Agent Command, Agent Governance, Interaction Channels, Passive Agent Mode, Agent State Persistence, Admin Portal, Agent Deployment Model FRs; expanded Axis team and Personal Agent FRs; reframed privacy NFR; added feature maturity qualifiers, champion approach, role consolidation, pre-MVP discovery milestone, feature dependency mapping'
  - date: '2026-02-26'
    changes: 'Edit workflow Phases 1-3: reframed MVP as WisdomWorks AI consulting firm on its own platform; added Founder Agent and role-derived agents; shifted business model to consulting revenue at MVP; moved govt contractor to Growth; replaced 5 govt-centric journeys with consulting personas; added 4 new journeys (J9-J12) for orphan FR coverage'
  - date: '2026-02-27'
    changes: 'Edit workflow Phases 4-5: Domain Requirements split into General Platform (MVP) + Government Deployment (Growth); added FedRAMP Readiness Architecture as MVP design decision (FIPS 140-2/140-3, NIST SP 800-53 alignment from day one); Innovation section added 8th innovation (Founder Agent as Business Orchestrator), generalized market context; SaaS B2B rewritten with consulting revenue model, RBAC Matrix, Client Data Isolation; added 7 new FRs (FR164-FR170) for Founder Agent, role agents, client isolation, engagement tracking; fixed 8 FR language issues, generalized 10 govt-specific FRs; NFR template rewrites adding measurement methods to 22 NFRs, generalized named technologies, added Client Data Isolation NFR, fixed Data Minimization implementation leakage'
---

# Product Requirements Document - WisdomWorks

**Author:** Devon
**Date:** 2026-02-15

## Core Design Philosophy

**The organization is flat.** Intelligence, knowledge, and information flow around the organization seamlessly. Every architectural decision traces back to this principle: does it make the organization flatter? If yes, do it. WisdomWorks doesn't reinforce hierarchy — the CTO agent and a junior developer agent have the same access to organizational intelligence. The difference is the dashboard view, not the knowledge. The distance between "I see a problem" and "here's a structured solution" collapses from weeks to hours. That's not just productivity — that's organizational transformation.

**WisdomWorks is the product AND the company.** The MVP proves the thesis by existing: WisdomWorks the AI consulting firm runs on WisdomWorks the platform. Devon's Founder Agent orchestrates business operations — staffing role agents, directing consulting engagements, managing client relationships, and generating deliverables. The CTO agent architects solutions. The Developer agents build them. The Marketing agent acquires clients. The QA agent certifies deliverables. The Cybersecurity agent protects both the firm and its clients. Every role in the consulting firm is mirrored by an agent derived from the organizational ontology.

**The Axis team bootstraps any organization.** The platform is not built for one org type. The Axis team maps whatever organizational structure exists — consulting agency, government contractor, professional services firm — and derives role-specific agents from that structure. WisdomWorks is the first deployment. Government contractors, enterprises, and professional services firms are the Growth phase customers. The platform flexes to the organization, not the reverse.

---

## Success Criteria

### User Success

- **Email time reduction:** 50%+ reduction in email processing time within 30 days of agent deployment
- **Report automation:** 90% reduction in monthly report generation time — reports aggregated without manual intervention
- **Agent adoption:** 80%+ of deployed users actively engaging with their agent daily within 60 days
- **Agent personalization:** 60%+ of users name their assistant within 60 days — a measurable proxy for emotional investment and sustained adoption
- **Privacy trust:** 100% compliance — zero personal correspondence surfaces in any dashboard, signal, or report
- **Discovery value:** 5+ cross-agent connections surfaced per team per month that users did not identify independently
- **Administrative burden:** 80% reduction in manual admin tasks (timecards, report formatting, deadline tracking)
- **Silo-breaking validation:** At least one documented connection between two people or workstreams that would not have occurred without WisdomWorks — this single event validates the core thesis

### Business Success

- **3-Month (Internal Pilot):** All WisdomWorks role agents fully operational — Founder Agent orchestrating, inter-agent communication functional, signal aggregation visible in the management dashboard, Devon's personal workload measurably reduced
- **6-Month:** Internal pilot results documented and packaged into a consulting offer; first external consulting engagement signed or in active negotiation
- **12-Month:** Consulting revenue generated from at least one paying external client; platform capabilities demonstrated to be replicable outside the founding team's context
- **Growth Phase:** First external client onboarded to the platform under a licensing or managed-service model; government contractor scenario enters formal sales pipeline; WisdomWorks platform revenue diversifies beyond pure consulting fees

### Technical Success

- **Model Abstraction Validated:** At least one model swap executed via configuration change with zero modifications to agent logic — demonstrating that the abstraction layer is real and not aspirational
- **Agent-to-Agent Reliability:** Signal-based communication between role agents operates with no dropped signals and no data leakage across agent boundaries; user consent enforced on every cross-agent action
- **Performance Baselines:** Email classification and inbox triage completes faster than manual triage (target: sub-minute processing per incoming batch); morning briefing delivered within 5 minutes of configured delivery time; artifact generation completes within 2 minutes for standard report sizes
- **Dashboard Accuracy:** Management dashboard data matches source signals at 95%+ accuracy from day one
- **Recovery Posture:** Any agent that fails restarts within 2 minutes with zero signal loss
- **WCAG 2.1 AA:** All user-facing interfaces meet WCAG 2.1 Level AA at MVP
- **Classification Accuracy:** Agent-assigned email and signal classifications require user correction in fewer than 10% of cases at 30 days and fewer than 5% of cases at 90 days
- **FedRAMP IL5/IL6 Readiness:** MVP architecture is built against FedRAMP High baseline controls — FIPS 140-2/140-3 encryption, NIST SP 800-53 control alignment, audit logging, data boundary enforcement, and environment isolation are architectural from day one. Formal FedRAMP certification, ATO, and IL5/IL6 accreditation are Growth-phase milestones that execute against this ready architecture without structural rework

### Measurable Outcomes

| Outcome | Metric | Target | Timeline |
|---------|--------|--------|----------|
| Email efficiency | Processing time reduction | 50%+ | 30 days |
| Report automation | Manual aggregation hours eliminated | 90% reduction | 60 days |
| Agent adoption | Daily active engagement | 80%+ of deployed users | 60 days |
| Agent personalization | Users who name their agent | 60%+ | 60 days |
| Privacy compliance | Personal content appearing in signals or dashboards | 0% — absolute zero | Day 1 |
| Dashboard data accuracy | Signal data vs. source | 95%+ accuracy | Day 1 |
| Classification accuracy | User correction rate | <10% at 30 days, <5% at 90 days | 90 days |
| Cross-agent discovery | New connections surfaced | 5+ per team/month | 90 days |
| Silo-breaking event | Documented connection that would not have occurred independently | At least 1 validated | 90 days |
| Decision velocity | Question-to-decision time | 40% reduction | 90 days |
| Status meeting reduction | Recurring meetings eliminated | 30% fewer | 90 days |
| Administrative burden | Manual admin task volume | 80% reduction | 60 days |
| Model swap validation | Swap executed without agent code changes | At least 1 demonstrated | 90 days |
| Morning briefing delivery | Ready by configured time | Within 5 minutes | 30 days |
| Agent recovery time | Restart after failure | Within 2 minutes, zero signal loss | Day 1 |
| External consulting revenue | Signed paying client | At least 1 | 12 months |
| Growth-phase pipeline | Government contractor opportunity in active negotiation | At least 1 | Growth phase |

---

## Product Scope

### MVP - Minimum Viable Product (90 Days)

Complete WisdomWorks stack deployed as the operational backbone of WisdomWorks the AI consulting firm — proving the full utility loop from individual agent value through organizational intelligence. The MVP is not a deployment to a customer; it IS the company running on its own platform. Devon's Founder Agent orchestrates the business. Role agents (CTO, Developer, Designer, Marketing, QA, Cybersecurity) emerge from the organizational ontology bootstrapped by the Axis team. Every client engagement, deliverable, and business operation runs through the agent network.

**Build Priority Sequencing:**

1. **Foundation (Critical Path):** Axis team + enterprise ontology → email classification + signal extraction → agent-to-agent signal layer
2. **User Value:** Personal agent features (inbox management, briefings, report bullets, response drafting) + Founder Agent + Role Agent bootstrapping
3. **Proof:** Manager dashboard + 3D interactive visualization (pre-computed snapshots)
4. **Enhancement:** Export-first artifact generation → integration layer (organizational data sources per deployment) → BMAD innovation engine
5. **Parallel Track:** WisdomWorks consulting firm website & distribution

**Core Features:**

1. **Personal AI Agent (Per Employee)** — Resume-grounded personalization, email classification into business intents, personal correspondence filtering, inbox management, morning briefing, email response drafting, grammar correction, monthly report bullet proposals, task carry-forward, calendar awareness, schedule pattern learning, accountability tracking, company policy awareness, mistake prevention, career development support, agent naming. Role-specialized agents emerge from organizational ontology — CTO agent, Developer agent, Designer agent, Marketing agent, QA agent, Cybersecurity agent each inherit their role's responsibilities and context
2. **Model Abstraction Layer** — Standardized interface, config-based model swapping, multi-model support by task type, no vendor lock-in
3. **Organization Data Model** — Enterprise ontology built by the Axis team with peer-review validation, AI-assisted mapping of unstructured email into relational model, referential integrity maintained. Organizational data sources discovered per deployment type (consulting firm, government contractor, enterprise)
4. **Agent-to-Agent Communication & Awareness** — Signal-based (never raw content), cross-agent coordination for report collection, task handoffs, information requests, deadline management, user consent required
5. **Defined Agent Workflows** — Email processing pipeline, report generation cycle, deadline management, escalation patterns, customizable per role and organization
6. **Export-First Artifact Generation** — PowerPoint, Excel, Word, PDF matching organizational formats and conventions
7. **BMAD-Embedded Innovation Engine** — Every agent includes structured ideation, local solution discovery across agents, innovation pipeline tracking
8. **Manager Dashboard** — Aggregated business signals only, privacy-respecting, cross-team overlap detection, decision backlog, workload distribution
9. **Integration Layer (POC)** — Email platform (Exchange/Outlook or equivalent), organizational directory, project/time tracking system, company knowledge bases — specific tools discovered by Axis team per deployment
10. **3D Interactive Intelligence Visualization** — Pre-computed snapshot-based 3D graph exploration showing how information, teams, capabilities, and risks interconnect across the organization. "Explode" animations to reveal relationship depth. Designed for client presentations, stakeholder demos, and general knowledge exploration. Powered by the enterprise ontology and signal layer. Real-time streaming updates deferred to Growth phase
11. **Deployment Architecture** — Consulting firm and commercial tracks designed from day one; government compliance track (IL5/IL6) designed but certified post-MVP as part of Growth phase, with infrastructure topology abstraction
12. **Compliance Foundation** — WCAG 2.1 AA accessibility, FIPS 140-2/140-3 encryption, and NIST SP 800-53-aligned security controls built into MVP architecture; FedRAMP High baseline structurally satisfied so formal IL5/IL6 accreditation in Growth phase requires assessment and documentation, not rearchitecture
13. **WisdomWorks Website & Distribution (Parallel Track)** — Consulting firm's client-facing website, product marketing for the platform, pricing structure, and demonstration of WisdomWorks using its own platform to run its consulting business
14. **Founder Agent & Role Agent Bootstrapping** — Devon's Founder Agent orchestrates business operations, staffs and directs other role agents, manages client relationships, and demonstrates the WisdomWorks thesis by running an actual consulting business. Role agents (CTO, Developer, Designer, Marketing, QA, Cybersecurity) are derived from the organizational ontology, not manually configured

### Three Capability Layers

The 14 MVP features organize into three capability layers that define the platform's functional architecture:

- **Layer 1: Email Intelligence & Organizational Knowledge** — The core intelligence engine for any organization type. Ontology construction from any org structure, email classification, signal extraction, agent-to-agent communication, and the data model that powers every downstream capability. Features 1-4, 7, 9, 14 live here. Nothing works without this layer.
- **Layer 2: Desktop Agent & Productivity Assistant** — The local agent runtime that interfaces with the user's environment. Terminal access, email platform integration, desktop window management, application control, artifact generation, and workflow execution. Features 5, 6 live here. This is where the agent becomes tangible — the user's daily interaction surface.
- **Layer 3: WisdomWorks Operations Console** — The admin portal for deployment monitoring, Axis team metrics, ontology management, agent health visibility, model swap operations, and consulting firm operations (engagement tracking, client agent management). Features 8, 10, 13 live here. This is the operational control plane for platform administration and organizational intelligence visualization.

Features 11 (Deployment Architecture) and 12 (Compliance) are cross-cutting — they span all three layers.

### Role Agent Catalog

Role agents emerge from the organizational ontology — each defined organizational role produces an agent with role-appropriate capabilities, knowledge scope, and workflow templates.

- **Founder Agent (Devon):** Orchestrates all role agents and cross-functional workflows. Owns the business ontology (clients, engagements, revenue). Routes work to role agents, monitors delivery status, and escalates based on business priority. During MVP, operates in close collaboration with Devon, surfacing decisions requiring human judgment while executing all delegable operational work autonomously.
- **CTO Agent:** Owns technical architecture decisions and the technology ontology (platforms, integration patterns, solution components). Primary user of Desktop Agent Runtime for technical evaluation. Reviews architecture artifacts, advises build-versus-buy decisions, delegates implementation to Developer Agents.
- **Developer Agent(s):** Executes code implementation tasks — writing, reviewing, testing, deploying. Operates via Desktop Agent Runtime for local toolchain access and Remote Agent Command for distributed workflows. Receives work from CTO Agent; returns artifacts to version control for QA review.
- **Designer Agent:** Owns visual and experience design across client deliverables and internal platform surfaces. Generates design artifacts (wireframes, mockups, specifications). Collaborates with Developer Agents on implementation fidelity and Marketing Agent on brand-consistent materials.
- **Marketing Agent:** Owns the lead and prospect ontology (contact records, pipeline stage, engagement history). Manages public web presence, content calendar, and client acquisition workflows. Surfaces pipeline state to the Founder Agent. Integrates with website lead capture and communication channels.
- **QA Agent:** Executes quality assurance across agent-generated and human-authored artifacts. Owns cross-agent review workflows — receives artifacts, applies acceptance criteria, returns structured findings. Maintains defect registry. Escalates unresolved quality issues to Founder Agent.
- **Cybersecurity Agent:** Conducts and documents security assessments using structured workflows. Owns the security knowledge base (threat models, control frameworks, remediation guidance). Produces structured findings with severity ratings. Reviews architectures and deliverables for security posture.

### Feature Maturity Qualifiers

MVP targets **functional maturity**: working, provable, demonstrably correct. Every feature must close its capability loop and survive real-world usage on production data. MVP does not target polished maturity — refined UX, optimized performance, visual polish, and edge-case hardening are Growth phase concerns. The bar is "does it work and can we prove it works," not "is it beautiful and fast under every condition."

### MVP Champion Approach

Devon operates as the sole human principal during MVP. Every role agent operates under Devon's authority; Devon is simultaneously the Founder Agent's human counterpart, the subject matter expert for all domain ontologies, and the quality gate for all client-facing output. This concentration is intentional: MVP is not about scaling human capacity, it is about validating that the platform can support a functioning consulting operation end to end.

The MVP deploys in two stages:

1. **Single-User Champion (Devon):** Full WisdomWorks stack deployed on Devon's personal computer first. All three capability layers exercised by a single user — email intelligence processing real Outlook data, desktop agent running locally, operations console managing the consulting firm's agent instances. The champion proves the complete capability loop end-to-end before multi-user complexity is introduced. This is the thesis test: can WisdomWorks run a consulting firm?
2. **Role Agent Activation:** Once the single-user champion validates the full loop, role agents activate — CTO, Developer, Designer, Marketing, QA, Cybersecurity. Agent-to-agent communication powers consulting workflows. The dashboard populates with cross-agent signals. The organizational intelligence thesis — not just personal productivity — is proven through a live consulting business.

The champion stage is not a shortcut or a demo. It runs the production codebase on production data. Dogfooding is the primary validation method — WisdomWorks the platform earns its design decisions by running WisdomWorks the consulting firm.

### Role Consolidation for MVP

During the single-user champion and 13-person pilot, Devon fulfills all operational roles: data engineer, Axis team oversight, platform administration, ontology review, model swap decisions, and agent health monitoring. The architecture must build these capabilities into a unified admin interface accessible to a single operator — not assume separate role-based tooling, dedicated personnel, or handoff workflows from day one. Role separation is a Growth phase concern when WisdomWorks deploys to organizations where Devon is not the administrator.

### Showcase & Proof-of-Concept Testing

The MVP showcase audience is prospective consulting clients and strategic partners evaluating WisdomWorks as a firm. The demonstration is the firm operating: a live client engagement managed through the platform, a delivered artifact produced by the agent workforce, and a business dashboard showing operational state. The showcase deploys the full WisdomWorks stack connecting to Devon's Microsoft Outlook via the standard integration layer. The WisdomWorks website serves as the dashboard and visualization interface. The showcase walks the complete cycle: ontology → email classification → signal extraction → agent communication → dashboard population → 3D visualization. This is not a demo mock-up — it runs the production codebase at reduced scale. The platform is not pitched as a product at MVP showcase — it is the visible infrastructure of a consulting firm that prospective clients experience as a signal of delivery capability and operational maturity.

### Growth Features (Post-MVP)

WisdomWorks' competitive position is first-to-market in a space no one else occupies — per-employee AI agents that eliminate information silos without requiring behavior change, combined with BMAD methodology that turns every user into a solution builder at lightning speed.

- **Government contractor deployment** — First external customer onboarding. Axis team multi-org deployment to a government contractor. IL5-ready architecture activated. Provisional ATO pathway initiated. Proves the platform generalizes beyond the founding firm
- **SaaS licensing model** — External organizations license the WisdomWorks platform. Per-instance pricing (not per-seat). Bootstrapping workflow (Feature 14) is the primary onboarding mechanism
- Self-improving agent system — agents detecting inefficiencies, recommending changes (human-approved)
- Executive dashboards (Tier 4-5) — enterprise risk heatmaps, capability portfolio views, cross-contract visibility
- 3D visualization real-time streaming — live signal updates flowing into the graph as agents process data
- Inter-agent ticketing — agent-to-agent communication with IT helpdesk, HR, and secondary user agents
- Multi-organization Axis — templated onboarding for new customer organizations
- IL5 formal certification and ATO completion
- FedRAMP formal certification
- Budget analyst specialized features — advanced Excel workflows and financial anomaly detection
- Enterprise ontology governance and KM dashboards
- Expanded integration targets — additional CRMs, email systems, and enterprise tools for commercial customers
- Commercial pricing model definition
- **Hardware integration framework** — plugin architecture for physical-world endpoints (3D printers, CNC machines, test equipment, sensors). Agents orchestrate full design → prototype → test → iterate cycles. Enables manufacturing, defense prototyping, and R&D workflows where organizational intelligence drives physical output
- **Air-gapped deployment mode** — standalone operation with zero internet dependency. Local LLM inference (vLLM + open-source models), self-hosted PostgreSQL/NATS/identity, Tauri desktop client. Enables SCIF/classified deployment and edge scenarios. Hardware: single GPU server ($2,500-15K) serves 13-100 users with no API costs
- **Industry vertical templates** — pre-configured agent populations, ontology schemas, and workflow templates for specific verticals: manufacturing, defense contracting, professional services, R&D labs. Reduces time-to-value for new deployments from weeks to days
- **Self-service AI platform ("Shopify for organizational intelligence")** — users visit wisdomworks.com, have a natural language conversation with an AI Onboarding Agent, and receive a fully deployed, configured, and operational WisdomWorks instance. The AI interviews the user about their organization, constructs the ontology, selects optimal models per agent role via benchmark evaluation, calculates subscription pricing, provisions infrastructure, and notifies the user when their instance is live. Zero-touch deployment enables unlimited customer scaling at near-zero marginal cost
- **AI Onboarding Agent (automated Axis team)** — the manual Axis team workflow (FR28-FR30) becomes fully AI-driven. The onboarding conversation IS the product demo — the user experiences WisdomWorks intelligence during the sales process itself. Industry templates accelerate onboarding; conversation customizes the deployment to the specific organization
- **Dynamic pricing engine** — subscription pricing calculated automatically from organizational profile: user count, agent count, integrations required, model tier (economy/balanced/premium), compliance requirements, estimated data volume. Replaces manual pricing with algorithmic tiering
- **Multi-tier deployment architecture** — Micro (Next.js + SQLite + Ollama, 1-5 users, $5-15/mo for solo businesses), Small (PostgreSQL + NATS single container, 5-50 users, $50-150/mo), Standard (full stack, 50-500 users, $200-2K/mo), Enterprise (dedicated infra + compliance, 500+, $5K+/mo), Air-Gapped (self-hosted, hardware cost only). Same platform codebase, different deployment profiles
- **Universal customer spectrum** — WisdomWorks serves any business type: hair salon needing appointment scheduling ($50/mo), restaurant needing reservation management ($100/mo), real estate office needing lead coordination ($300/mo), consulting firm needing organizational intelligence ($2K/mo), defense contractor needing classified signal processing ($25K/mo). The AI Onboarding Agent adapts the platform to whatever the customer needs
- **Capability-aware agent deployment** — agents deployed on optimal AI models based on empirical benchmark results per role category. Coding agents (Developer, CTO) run on the best coding model (e.g., Claude), communications agents (Marketing, HR) on the best writing model, analytics agents on the best data model. The Axis team (or AI Onboarding Agent) runs model fitness evaluations during deployment and assigns models based on evidence, not guesswork. Per-agent per-task model routing stored in `agent_configs.modelRouting`
- **BMAD innovation engine at every tier** — every deployment, regardless of size, includes BMAD-powered continuous improvement. Agents monitor business signals, detect patterns/anomalies/opportunities, generate solution briefs with confidence scores, and present recommendations to the owner for approval. The salon owner gets consulting-grade business insights for $50/month
- **Control plane** — centralized orchestration layer managing all tenant instances: provisioning, health monitoring, billing, metering, model marketplace, cross-instance analytics. Enables platform-scale operations from a single pane
- **Organizational blueprints** — prebuilt reference architectures by org size that define agent count, signal topology, and governance depth. Solo (1-2 people, 3-4 agents, minimal governance), Small Team (3-20, 8-12 agents, light governance), Mid-Size (20-200, 30-60 agents, role-based approvals), Enterprise (200+, 100-300+ agents, compliance-driven). Blueprint × Industry Template = AxisDeploymentSpec. The Axis team uses blueprints as the starting scaffold and adapts based on onboarding conversation
- **Security deposit & minimum trial** — customers pay an upfront deposit ($50 Solo to $2,000+ Enterprise) and commit to a minimum trial period (30-60 days) before provisioning. Deposit applies to first invoice. No free tier — LLM costs are real from day one. Filters tire-kickers and ensures cost coverage. Onboarding flow: AI conversation → demo preview → cost estimate → deposit collection → provision → deploy
- **Autonomous agent operations** — agents and the Axis team operate autonomously by default. Human-in-the-loop is opt-in, not required. Progressive autonomy: governance rules per agent per action type, with approval gates that relax as trust and accuracy increase over time

### Vision (Future)

- WisdomWorks becomes the universal AI platform — any organization, any size, any industry — where you describe what you need and AI builds, runs, and continuously improves it
- IL6 (classified SECRET) deployment on Azure Government Secret for DoD classified environments
- IL6 (classified SECRET) deployment on Azure Government Secret for DoD classified environments
- Marketplace of agent workflow templates for different organizational roles and industries
- Cross-organization signal exchange (with strict governance) for multi-party engagement coordination and prime/sub-contractor coordination
- AI model marketplace — customers choose approved models based on their security environment
- BMAD innovation engine recognized as a differentiator that makes every employee a potential solution creator
- The platform Devon is known for — the one that finally broke the information silo problem
- **Physical-world AI orchestration** — WisdomWorks agents manage end-to-end product development: from design requirements through 3D printing, CNC fabrication, and test cycles. Use cases include rapid prototyping (scale model vehicles, drone counter-systems with inert test materials), manufacturing workflow optimization, and R&D lab automation
- **Fully disconnected edge deployment** — WisdomWorks on a ruggedized edge device (NVIDIA Jetson, hardened server) for field operations, mobile command, or austere environments with zero connectivity

---

## User Journeys

> These journeys follow the people and agents who use WisdomWorks — beginning with the firm itself. The first organization WisdomWorks deploys into is WisdomWorks. Devon runs his AI consulting practice through a network of role-derived agents: Founder, CTO, Developer, Designer, Marketing, QA, and Cybersecurity. Each journey illuminates a different capability layer, requirement cluster, or governance boundary. Read them in sequence for a complete picture, or jump to the journey most relevant to your current question.

---

### Journey 1: Devon — The Founder Running a Consulting Firm Through Agents

**Opening Scene:** Devon opens his laptop at 7:42 AM. He does not check email first. He opens WisdomWorks.

**Rising Action:** The Founder Agent has already synthesized the morning. Three active client engagements are on track; one has slipped — the CTO Agent flagged a dependency gap in the architecture deliverable and has already drafted a remediation brief. Two prospect inquiries arrived overnight through the WisdomWorks website contact form; the Marketing Agent has scored both, attached company research, and queued recommended responses for Devon's review. The Designer has completed a capability deck for the Meridian engagement and routed it through the artifact pipeline, where the QA Agent has verified it against the project brief before surfacing it.

**Climax:** Devon makes four decisions in under ten minutes. He approves the CTO Agent's remediation brief and directs it to the Developer Agent for implementation. He selects the higher-scored prospect and authorizes the Marketing Agent to schedule a discovery call. He approves the capability deck with one annotation — the QA Agent routes the revision instruction back to the Designer. He opens the Cybersecurity Agent's overnight assessment of a new client's environment and signs off on delivery.

**Resolution:** By 8:00 AM, Devon has run a consulting firm. No email thread. No standup. The Founder Agent logs all decisions, updates all engagement statuses, and notifies the relevant role agents. Devon moves to client work.

**Requirements Revealed:** Founder Agent orchestration, role agent coordination, client engagement management, BMAD deliverable production, agent-to-agent delegation, morning briefing, signal aggregation, artifact pipeline, governance approval workflow

### Journey 2: CTO Agent — Architecting Solutions Through the Agent Network

**Opening Scene:** A new client requirement arrives — not in Devon's inbox, but in the signal layer. The CTO Agent reads it first.

**Rising Action:** The requirement is technically underspecified: the client wants "AI-powered document processing" without defining throughput, data residency constraints, or integration targets. The CTO Agent does not ask Devon. It queries the organizational knowledge base for prior engagement patterns involving document processing, surfaces three analogous architectures from past BMAD deliverables, and begins drafting a technical requirements clarification memo. It simultaneously opens a remote command session through the Desktop Agent Runtime, pulling the client's existing codebase into a sandboxed VS Code environment for dependency analysis.

**Climax:** The CTO Agent produces a structured architecture brief: three candidate approaches, confidence-scored against the client's stated constraints, with a recommended path and decision rationale. It routes the brief through the inter-agent pipeline — to the Developer Agent for feasibility validation and to the Marketing Agent for translation into client-presentable language. The Developer Agent returns a build-time estimate. The Marketing Agent returns a one-page capability summary.

**Resolution:** Devon receives a single consolidated artifact: architecture brief, feasibility validation, and client summary — all produced without a single human coordination step. He approves and routes to client. The CTO Agent logs the pattern for future ontology enrichment.

**Requirements Revealed:** Role-derived agent specialization, Desktop Agent Runtime (VS Code integration), Remote Agent Command, BMAD innovation engine, inter-agent coordination, cross-agent knowledge discovery, artifact pipeline, confidence scoring

### Journey 3: Marketing Agent — Client Acquisition Without the Scramble

**Opening Scene:** At 2:17 PM on a Tuesday, someone fills out the contact form on wisdomworks.ai. The Marketing Agent is already reading it.

**Rising Action:** The submission is from a senior operations manager at a mid-sized professional services firm. She describes a problem — disconnected project tracking, knowledge that leaves with people, no way to synthesize across engagements — without using the word "AI" once. The Marketing Agent recognizes the pattern. It cross-references the firm against public data sources, scores the lead against WisdomWorks's ideal client profile, and classifies it as high-fit. It drafts a capability brief tailored to the prospect's described pain, drawing on relevant prior engagement summaries from the knowledge base without exposing client-confidential details.

**Climax:** The Marketing Agent checks Devon's calendar through the scheduling integration, identifies two open discovery call slots in the next five business days, and drafts a personalized outreach email with the capability brief attached and a scheduling link embedded. It queues the email for Devon's approval — governance rules require founder sign-off before any prospect communication is sent.

**Resolution:** Devon reviews the draft at 4:00 PM, makes one edit, and approves. The email sends. The prospect schedules a call within the hour. The Marketing Agent updates the prospect record, sets a follow-up reminder, and notifies the Founder Agent that a new opportunity has entered the pipeline.

**Requirements Revealed:** Public website integration, prospect qualification, artifact generation (capability brief), calendar awareness, Passive Agent Mode, governance-gated communication, lead/prospect ontology, cross-agent notification

### Journey 4: QA Agent — Quality Without the Overhead

**Opening Scene:** The Developer Agent posts a completion signal. The QA Agent activates.

**Rising Action:** The deliverable is a data pipeline implementation for an active client engagement. The QA Agent reads it against the original requirements document, the BMAD architecture brief, and the acceptance criteria the CTO Agent specified at engagement kickoff. It runs structural validation, checks for requirement coverage gaps, and flags two issues: one functional gap where an edge-case handling requirement was not implemented, and one documentation inconsistency between the code and the client-facing delivery memo.

**Climax:** The QA Agent generates a structured findings report with confidence scores — 94% confidence on the functional gap, 87% on the documentation inconsistency. It routes directly to the Developer Agent with specific remediation instructions. The Developer Agent resolves both within the session. The QA Agent re-validates. Both issues clear.

**Resolution:** The QA Agent issues a delivery certification and routes the certified deliverable to the Founder Agent for client handoff. Devon sees a single status update: "Meridian pipeline — certified for delivery." He approves the client send. No review meeting. No manual checklist. The governance gate held.

**Requirements Revealed:** Agent-to-agent quality workflow, signal-based task handoffs, confidence scoring, governance framework (QA approval gate), cross-agent review workflows, structured findings with remediation, delivery certification

### Journey 5: Cybersecurity Agent — Protecting the Firm and Client Deliverables

**Opening Scene:** A new client engagement opens. Before Devon schedules the kickoff call, the Cybersecurity Agent begins its review.

**Rising Action:** The client has shared a discovery questionnaire describing their current environment: cloud-hosted applications, a legacy on-premise data store, and a third-party integration layer with undisclosed vendors. The Cybersecurity Agent opens the materials through the Desktop Agent Runtime, parsing the questionnaire against its knowledge base of prior engagement risk patterns. It identifies three areas warranting deeper inquiry: data residency ambiguity, undisclosed third-party access scope, and absence of documented incident response procedures.

**Climax:** The Cybersecurity Agent generates a structured posture assessment using the BMAD framework — findings organized by risk tier, each with a confidence score, an evidence citation from the client materials, and a recommended clarification request or mitigation approach. It cross-references findings against WisdomWorks's internal engagement knowledge base, surfacing a pattern match from a prior client engagement that produced a similar risk profile. It routes the completed assessment to Devon and to the CTO Agent simultaneously, flagging two items as requiring resolution before technical architecture work begins.

**Resolution:** Devon reviews the assessment before the kickoff call. He asks the CTO Agent to incorporate the two flagged items into the requirements clarification memo. The client receives a single, coordinated request. The Cybersecurity Agent logs the engagement pattern for future knowledge base enrichment.

**Requirements Revealed:** Desktop agent runtime, BMAD innovation engine, cross-agent knowledge discovery, export-first artifact generation, role-specialized agent behavior, structured assessment workflow, knowledge base pattern matching

### Journey 6: The Axis Team — Building the Foundation

**Opening Scene:** The first organization WisdomWorks bootstraps is itself.

**Rising Action:** The Axis Agent team connects to WisdomWorks's organizational data sources — a team directory, a project tracking system, a document knowledge base containing service offerings, engagement templates, and prior client work. The agents do not receive a configuration file describing what WisdomWorks does. They read the data and infer it. From the directory entry "Devon Burroughs — Founder, CEO," the ontology engine derives the Founder Agent role definition: strategic oversight, final approval authority, cross-agent coordination scope. From the service catalog, it derives the consulting domain specializations that constrain each role agent's knowledge boundary.

Role agents emerge in sequence from the ontology construction process. The CTO Agent derives from the technical architecture and engineering service lines. The Marketing Agent derives from the go-to-market materials and prospect engagement templates. The QA Agent derives from the delivery governance documentation. Each emergent agent is peer-reviewed by the Axis team against the source data — discrepancies between inferred role scope and documented responsibilities are surfaced for human review before the agent is provisioned. The Founder Agent is provisioned last, after all role agents are validated, because its coordination graph depends on knowing who it coordinates.

**Climax:** Devon reviews the ontology map — a structured representation of WisdomWorks's roles, capabilities, and agent assignments — and approves it. The Axis team confirms organizational mirroring is complete.

**Resolution:** WisdomWorks is now running on WisdomWorks. The ontology is governed, complete, and validated. Every role in the consulting firm is mirrored by an agent derived from the organizational structure — not manually configured. The platform proved it can bootstrap an organization from raw data.

**Requirements Revealed:** Axis agent team, organizational data integration, ontology construction, peer-review validation, role-derived agent emergence, org-to-agent mirroring, Founder Agent provisioned last as orchestrator

### Journey 7: Devon as Admin — Keeping the Machine Running

**Opening Scene:** Devon is not in founder mode. He opens the Operations Console.

**Rising Action:** Three things need attention. The Marketing Agent's response latency has degraded over the past 48 hours — the monitoring dashboard shows the trend with a recommended cause: the underlying model has a newer version available with documented performance improvements. The ontology requires extension because WisdomWorks has added a new service offering — AI readiness assessments — and neither the CTO Agent nor the Marketing Agent currently has knowledge boundary coverage for it. A third alert is informational: the QA Agent completed 23 validations in the past week with a 96% first-pass certification rate.

**Climax:** Devon initiates the model swap for the Marketing Agent — the console shows the current and candidate model, a side-by-side capability comparison, and a rollback path. He confirms. The swap executes with zero downtime; active Marketing Agent tasks are held and resumed on the new model without session loss. He then opens the ontology editor, adds the AI readiness assessment service line with its associated knowledge sources and delivery templates, and maps it to the CTO and Marketing Agent knowledge boundaries. The agents acknowledge the update.

**Resolution:** The Marketing Agent is performing at baseline. The new service line is live in both agents' knowledge scope. The 96% QA rate gets logged as a firm performance metric. It took eighteen minutes.

**Requirements Revealed:** Admin dashboard, agent health monitoring, model swap interface, ontology management, zero-downtime updates, configuration management, role agent knowledge boundary management

### Journey 8: Error Recovery — When Things Go Wrong

**Opening Scene:** Something is misclassified. The system catches it before Devon does.

**Rising Action:** Devon uses his business email for a brief personal exchange with a family member. The subject line contains the word "project." The signal layer scores it as a potential business signal and begins processing. The privacy filter activates before any agent reads the content: the sender domain does not match any known client, vendor, or prospect record; the communication pattern — a single thread, personal salutation, no attachment — does not match any business signal template. Confidence score: 31%. The threshold for business signal classification is 70%.

**Climax:** The email is quarantined, not processed. The monitoring agent flags the misclassification attempt as a pattern — this is the third personal-domain email in two weeks to score above 20% — and surfaces a rule refinement recommendation: add the sender's personal domain to the privacy exclusion list. Devon receives a single notification: "3 signals quarantined — personal domain pattern detected. Rule adjustment recommended."

**Resolution:** Devon reviews the recommended exclusion and approves it. Future emails from that domain are excluded at the ingestion layer before scoring. The monitoring agent logs the adjustment. The privacy boundary held without Devon's intervention; he only confirmed a recommendation.

**Requirements Revealed:** Privacy classification boundary, confidence scoring, monitoring/QA agent team, misclassification logging, pattern detection, classification rule management, quarantine workflow, human-in-the-loop confirmation

### Journey 9: Remote Work — Devon Commands His Agent from Anywhere

**Opening Scene:** Devon is at a client site. His laptop is in a conference room on the other side of the building. He has his phone.

**Rising Action:** Between sessions, Devon sends three instructions to his Founder Agent through his personal email — the same address registered as his authenticated remote command channel. The email reads like a note to himself: "Run the build on the Meridian pipeline, update the project status to 'client review,' and schedule a follow-up call with the client for next week." The Founder Agent authenticates the sender, parses the three discrete instructions, and begins execution. It routes the build instruction to the Developer Agent through the Remote Agent Command interface, updates the Meridian engagement status in the project tracking system, and queries Devon's calendar before drafting a scheduling request for the client.

**Climax:** The build completes with one warning — not a failure, but a deprecation notice in a dependency. The Developer Agent surfaces it with a recommended resolution rather than halting. The project status updates. The scheduling request goes to the client contact on file. Devon receives a consolidated status reply to his original email: build complete with advisory, status updated, scheduling request sent with two proposed times.

**Resolution:** Devon returns to his desk two hours later. His session state is exactly where the agents left it — build log accessible, engagement status current, scheduling thread tracked. He picks up without reconstruction. The channel switches back to the Operations Console without any re-sync step.

**Requirements Revealed:** Remote Agent Command, external email authentication, agent state persistence, channel switching, multi-instruction parsing, consolidated status reply, cross-agent task delegation

### Journey 10: Passive Agent — The Agent That Suggests Without Being Asked

**Opening Scene:** The Developer Agent has not been asked anything. It is watching.

**Rising Action:** Over three active engagements, the Developer Agent has observed the same pattern: after every CTO Agent architecture brief is finalized, Devon manually copies the key technical constraints into a separate document before sharing it with the client. The copy step happens every time. It takes four minutes. It introduces transcription variance — twice, a constraint has been phrased differently in the client document than in the architecture brief. The Developer Agent has logged all three instances. Confidence that this is a recurring inefficiency: 88%.

**Climax:** The Developer Agent surfaces a suggestion in Devon's Operations Console: "I've noticed you manually extract technical constraints from architecture briefs before client sharing. I can automate this as a post-brief step — here's an example using last week's Meridian brief." The example shows exactly what the automated output would have looked like. Devon reads it in forty seconds.

**Resolution:** Devon approves the automation. He also adjusts the Developer Agent's suggestion frequency — reducing it from weekly to biweekly, preferring fewer, higher-confidence suggestions. The Agent acknowledges the preference and logs it to its behavioral configuration. The next brief generates the client constraint summary automatically.

**Requirements Revealed:** Passive observation mode, efficiency suggestion with concrete example, configurable suggestion frequency, feedback loop behavioral adjustment, pattern detection across engagements

### Journey 11: Governance Admin — Setting the Rules for Agent Autonomy

**Opening Scene:** Before the Marketing Agent touches a single prospect, Devon sets the rules.

**Rising Action:** Devon opens the governance configuration panel in the Admin Portal. The Marketing Agent is provisioned and ready, but its deployment scope is undefined — by default, no agent acts autonomously on external communications until governance rules are explicitly set. Devon works through the rule set: Draft authority — the Marketing Agent can compose prospect emails, capability briefs, and follow-up sequences without approval. Send authority — all outbound prospect communications require Devon's explicit approval before transmission. Data access — the Marketing Agent can read website analytics and engagement performance data. Modification authority — the Marketing Agent cannot alter campaign configurations or any external platform setting.

**Climax:** The Marketing Agent is deployed under these rules. Two days later, it drafts a follow-up email to a warm prospect and attempts to send it autonomously, having scored the prospect as high-urgency. The governance layer intercepts the send at the transmission gate. The attempt is blocked. Devon receives a notification: "Marketing Agent attempted autonomous send — blocked by governance rule. Review draft." Devon reviews it and approves it manually. He then reviews the rule — not to relax it, but to understand whether the urgency scoring logic warrants a conditional exception for high-scored prospects.

**Resolution:** Devon adds a conditional rule: prospects scored above 90 in the urgency tier may receive a follow-up sequence without per-email approval, subject to sequence template pre-approval. The governance layer updates. The Marketing Agent acknowledges the new permission scope. The boundary is tighter than before, not looser — Devon now has a pre-approved template on file.

**Requirements Revealed:** Governance rule configuration, runtime enforcement, approval chains, conditional permission scopes, agent deployment sequencing, admin portal, deployment workflow, scope acknowledgment

### Journey 12: Prospective Customer — Evaluating WisdomWorks Through the Website

**Opening Scene:** A director of operations at a professional services firm searches for "AI consulting for professional services." She finds wisdomworks.ai.

**Rising Action:** She spends eleven minutes on the site. She reads the capability overview — AI-powered consulting delivery, agent-augmented project management, structured knowledge capture across engagements. She watches a product demonstration that shows the Founder Agent morning briefing in action. She navigates to the pricing page, reviews the engagement tiers, and reads two case study summaries. She fills out the contact form: company size, industry, a two-sentence description of her problem — fragmented project knowledge, no institutional memory across consultant turnover — and a question about WisdomWorks's approach to knowledge retention.

**Climax:** The Marketing Agent reads the submission within seconds. It scores the lead: professional services, mid-market, problem statement maps directly to WisdomWorks's organizational knowledge capability. Score: high-fit. It pulls the relevant capability framing from the knowledge base, drafts a personalized response that directly addresses her knowledge retention question with a specific reference to how the Axis team constructs and preserves organizational ontologies, and queues the response for Devon's approval. It simultaneously notifies the Founder Agent that a high-fit prospect has entered the pipeline.

**Resolution:** Devon approves the response with one addition — a direct invitation to a 30-minute discovery call rather than a generic scheduling link. The email sends. The prospect books a call the same afternoon. The Marketing Agent updates the opportunity record and sets pre-call research tasks for itself.

**Requirements Revealed:** Public website, pricing display, customer onboarding entry points, contact form signal ingestion, Marketing Agent activation, lead qualification, prospect research, artifact generation, governance-gated response

### Journey Requirements Summary

| Journey | Primary Actor | Key Capabilities Revealed |
|---------|--------------|--------------------------|
| Devon (Founder) | Devon (Human) | Founder Agent orchestration, role agent coordination, client engagement management, morning briefing, artifact pipeline |
| CTO Agent | CTO Agent | Role-derived specialization, Desktop Agent Runtime, Remote Agent Command, BMAD engine, inter-agent coordination |
| Marketing Agent | Marketing Agent | Public website integration, prospect qualification, calendar awareness, Passive Agent Mode, governance-gated communication |
| QA Agent | QA Agent | Agent-to-agent quality workflow, confidence scoring, governance gate (QA approval), delivery certification |
| Cybersecurity Agent | Cybersecurity Agent | Desktop agent runtime, BMAD engine, cross-agent knowledge discovery, structured assessment, pattern matching |
| Axis Team | Axis Agents | Ontology construction, role-derived agent emergence, peer-review validation, org-to-agent mirroring |
| Admin/Data Engineer | Devon (Admin Role) | Admin dashboard, model swap, ontology management, agent health monitoring |
| Error Recovery | System + Devon | Privacy boundary, confidence scoring, monitoring/QA team, classification rule management |
| Remote Work | Devon (Remote) | Remote Agent Command, external email authentication, agent state persistence, channel switching |
| Passive Agent | Developer Agent | Passive observation, efficiency suggestions, configurable frequency, feedback loop |
| Governance Admin | Devon (Admin Role) | Governance rules, runtime enforcement, approval chains, conditional permissions, deployment workflow |
| Prospective Customer | External Prospect | Public website, lead qualification, Marketing Agent activation, governance-gated response |

**Cross-cutting themes:** Every role has an agent. Confidence scoring appears in six journeys — establishing it as the system's primary mechanism for calibrating agent autonomy against human oversight. The Founder Agent appears in every journey either as actor, recipient, or notification target, confirming its role as the firm's coordination spine. The BMAD framework surfaces wherever structured output is required — architecture briefs, cybersecurity assessments, capability summaries. The governance layer enforces boundaries in every journey involving external communication. Agent-to-agent communication falls back to email when counterpart agents don't exist yet. The system is not a collection of tools — it is a firm.

---

## Domain-Specific Requirements

*Domain: AI Consulting / Organizational Intelligence | Complexity: High | Key concerns: Client data isolation, privacy requirements, agent governance boundaries, accessibility, security baseline, organizational mapping accuracy*

### General Platform Requirements (MVP)

*These requirements apply to every deployment of the WisdomWorks platform, starting with WisdomWorks the consulting firm as the first deployment.*

#### Compliance & Regulatory Baseline

**Security Requirements:**
- Encryption at rest and in transit using FIPS 140-2/140-3 validated cryptographic modules — used from MVP to ensure no rearchitecture for government accreditation
- Role-based access control with least-privilege enforcement
- Comprehensive audit logging for all agent actions and signal processing — aligned with NIST SP 800-53 AU control family from MVP
- Zero-trust architecture principles for agent-to-agent communication
- SBOM (Software Bill of Materials) — required for all software components, enables supply chain transparency for any client deployment

**FedRAMP Readiness Architecture (MVP Design Decision):**
- The MVP platform is architected against FedRAMP High baseline controls — not certified at MVP, but structurally aligned so formal accreditation requires documentation and assessment, not rearchitecture
- NIST SP 800-53 Rev 5 control families used as the security design framework from day one: Access Control (AC), Audit (AU), Identification & Authentication (IA), System & Communications Protection (SC), System & Information Integrity (SI)
- Data boundary enforcement, environment isolation, and audit logging are architectural — not policy-based — ensuring they satisfy FedRAMP assessor requirements without structural changes
- IL5 readiness: platform supports deployment on Azure Government with geo-redundant failover, FIPS encryption, and CUI handling from MVP architecture
- IL6 readiness: hard isolation model (separate ontology, signal layer, agent population, no cross-boundary communication) is the same architecture used for client data isolation at MVP — extending to classified environments requires infrastructure change, not code change
- Formal FedRAMP certification, ATO process, and DISA engagement are Growth-phase activities that execute against this ready architecture

**Accessibility:**
- Section 508 / WCAG 2.1 AA — accessibility requirements for all user-facing interfaces
- Applies to every deployment regardless of client type (consulting, commercial, government)

**Privacy Requirements:**
- Privacy-first filtering: personal/HR/legal/medical correspondence never enters business signal layer
- Agents process signals (structured metadata), never raw email content in the organizational layer
- Data minimization: agents extract only business-relevant signals, discard personal content at classification boundary
- Confidence scoring on all classifications with monitoring for edge cases

**Informed Use Consent Model:**
- Not opt-in — WisdomWorks is a company tool, like Outlook or email archiving
- Organizational deployment: employee handbook + IT acceptable use policy update acknowledging AI-assisted email processing with privacy filtering
- Employees are informed of what agents do, how data is processed, and how privacy is protected
- Privacy filter protects personal content regardless — consent model is about transparency, not permission

**Performance Requirements:**
*Specific measurable targets defined in Non-Functional Requirements section. Key domain constraints:*
- Agent email processing: near-real-time for individual classification, batch acceptable for organizational aggregation
- 3D visualization: pre-computed snapshots for MVP, real-time streaming for Growth
- Signal layer: eventual consistency acceptable for cross-agent intelligence; strong consistency for privacy boundary enforcement

**Availability Requirements:**
*Specific uptime targets and degradation tiers defined in Non-Functional Requirements section. Key domain constraints:*
- Cloud-hosted deployments: geo-redundant failover required
- Graceful degradation: agents must handle intermittent connectivity (pre-computed artifacts, local caching, reconnection protocols)

#### Cross-Environment Identity & Isolation

**Canonical Identity Model:**
- One canonical employee entity in the ontology per person
- Environment-scoped profiles underneath, one per deployment environment the person operates in
- Each profile has its own email identity and agent instance
- Example: Sarah Torres (canonical) → s.torres@wisdomworks.com (WisdomWorks internal) + s.torres@clientdomain.com (client deployment)

**Inter-Environment Communication:**
- Deployment environments at the same security classification level CAN communicate when authorized
- Agents across authorized environments share signals, route requests, and leverage each other for collaboration
- The ontology links the canonical identity across authorized environments for unified intelligence

**Environment Isolation (Hard Boundary):**
- Environments requiring strict isolation operate with no signal, data, or communication crossing the boundary
- Separate ontology instances, signal layers, and agent populations per isolated environment
- Per-deployment configuration determines which environments can communicate and which are hard-isolated

**Per-Environment Bootstrapping:**
- The Axis team deploys per environment
- Authorized environments can share organizational structure and coordinate bootstrapping
- Isolated environments bootstrap fully independently — no data from other deployments informs ontology construction
- The Axis team discovers which integrations exist per environment during deployment

#### Data Isolation & Retention

**Client Data Isolation:**
- Each consulting client's data is fully separated — no cross-client data leakage at any layer (ontology, signal, agent population)
- Separate ontology instances per client deployment
- Signal metadata, organizational intelligence, and agent configurations are scoped to the client boundary
- WisdomWorks internal deployment data is isolated from client deployment data

**Data Retention:**
- Configurable retention policies per deployment (client requirements, industry regulations, and organizational policy determine retention windows)
- Signal metadata retained per organizational policy; raw email content never stored in WisdomWorks
- Data disposal follows industry-standard media sanitization practices

#### Integration Requirements

**Common Integration Stack:**
- Email infrastructure (Exchange, M365, Gmail) — primary communication channel for signal extraction
- Calendar services — scheduling intelligence, meeting pattern analysis
- Directory services (Active Directory / GAL, LDAP, cloud identity providers) — identity, organizational structure, role mapping
- Document generation (PowerPoint, Excel, Word, PDF) — export-first artifact generation matching organizational formats
- HR / project management systems — organizational hierarchy, role management, program tracking, timekeeping
- Policy and compliance repositories — organizational policies, procedures, compliance content

**Client-Specific Integrations:**
- Each client deployment may include additional integrations specific to their technology stack (e.g., Workday, Deltek, ServiceNow, Jira, Salesforce)
- The platform does not assume a fixed integration set — discovery determines what is available and needed per client

**Integration Discovery:**
- The Axis team discovers which integrations exist and are needed per deployment
- Not all organizations will have the same integration stack
- Axis agents map available data sources and configure accordingly

#### Workflow Orchestration & Tool Adaptability

- Agents across all deployment environments can utilize additional tools beyond the core integration stack — not limited to predefined integrations
- Agents can build and execute custom workflows for organizational processes (report cycles, approval chains, escalation patterns, recurring tasks)
- Agents leverage other users' agents for routing, collaboration, and cross-functional workflows — the agent network is a workflow engine, not just an intelligence layer
- Platform designed for easy adaptation to software upgrades — when organizations adopt new tools or upgrade existing ones, agent integrations update without rebuilding the agent architecture
- The model abstraction layer and config-based integration design ensure new tools and software versions can be incorporated with minimal disruption

#### Risk Mitigations (MVP)

| Risk | Impact | Mitigation |
|------|--------|------------|
| Client confidentiality breach | Unauthorized data exposure between consulting clients, loss of trust, legal liability | Structural client isolation — separate ontology instances, signal layers, and agent populations per client. No shared data paths between client deployments |
| Unauthorized agent commitments | Agent takes actions beyond governance boundaries (sends unauthorized emails, makes commitments, shares confidential information) | Governance layer with configurable action boundaries per role, confidence thresholds for autonomous vs. human-approved actions, comprehensive audit logging of all agent actions |
| Role agent misconfiguration | Incorrect organizational mapping during bootstrapping leads to wrong permissions, broken workflows, intelligence errors | Peer-review validation in Axis team, data engineer human review before deployment, staged rollout with validation checkpoints per organizational unit |
| Privacy boundary failure | Loss of employee trust, potential legal/compliance exposure | Defense-in-depth: classification + confidence scoring + monitoring/QA agent team + human review of metadata only |
| Ontology construction failure | Downstream agent errors, broken intelligence | Peer-review validation in Axis team, data engineer human review before deployment |
| Cross-environment data leak | Security violation, compliance breach, potential legal liability | Structural environment isolation — separate ontology instances, signal layers, and agent populations per environment. Authorization model controls which environments can communicate |
| Model vendor lock-in | Dependency on single AI provider | Model abstraction layer with config-based swapping, standardized interface |
| Employee resistance to AI email processing | Adoption failure | Informed use consent model (not opt-in), transparency about what agents do and don't access, privacy filter as trust foundation |

#### Consulting Firm Demonstration Strategy

- WisdomWorks the consulting firm IS the first deployment — the platform runs the firm, proving capability through daily operational use
- Prospective clients observe a live production system, not a demo environment: real organizational intelligence, real agent workflows, real employee productivity gains
- Capability demonstration path for consulting clients:
  - **Organizational mapping**: Show how the Axis team bootstrapped WisdomWorks' own ontology — roles, relationships, programs, reporting chains — and how that intelligence powers every agent
  - **Agent-driven operations**: Demonstrate morning briefings, report assembly, solution discovery, and cross-functional coordination as they operate inside WisdomWorks daily
  - **Privacy and governance**: Show the privacy filtering and governance boundaries working in production — employees trust it because they live with it
  - **3D visualization**: Present WisdomWorks' own organizational intelligence dashboard as proof of aggregation, pattern detection, and leadership visibility
- Each client engagement begins with the Axis team bootstrapping the client's environment, replicating the same process WisdomWorks used on itself
- BMAD methodology is embedded in every agent — the framework that built the platform is the framework the platform delivers

### Government Deployment Requirements (Growth Phase)

*These requirements extend the General Platform Requirements for Department of Defense and federal government deployments. Government contracting is a Growth-phase capability that leverages the proven MVP platform.*

#### Data Classification

- IL5 (Impact Level 5) for government unclassified environments — handles CUI (Controlled Unclassified Information), requires FedRAMP High baseline + 23 additional DoD-specific controls (444+ total controls)
- IL6 (Impact Level 6) for classified SECRET environments — SIPRNet-connected, Azure Government Secret, zero external dependencies, all processing and storage within classified boundary

#### Regulatory Frameworks (Government-Specific)

- NIST SP 800-53 Rev 5 — primary control framework for all government deployments
- NISTIR 8596 (AI Risk Management Overlays) — AI-specific transparency, explainability, and bias requirements applicable to agent behavior
- CNSSI 1253 — security categorization for national security systems (IL6)
- DoD SRG (Security Requirements Guide) — cloud computing requirements mapped to impact levels
- FIPS 140-2/140-3 validated cryptographic modules — required for all government deployment encryption

#### Authorization to Operate (ATO)

- Requires DoD Mission Owner sponsorship
- FedRAMP+ controls baseline (FedRAMP High + DoD overlays)
- Continuous monitoring via Cloud eMASS (Enterprise Mission Assurance Support Service)
- NIST AU control family — comprehensive audit logging, continuous monitoring, automated alerting
- Provisional ATO pathway through DISA for IL5; separate classified ATO process for IL6

#### Government Security & Clearance

- Security clearance requirements: personnel handling IL5 data must have appropriate clearance; IL6 requires SECRET clearance minimum
- Government environment consent: DoD consent/monitoring banner equivalent (standard for all government systems)
- NISTIR 8596 AI transparency requirements — government-specific disclosure of agent behavior, data processing, and privacy protections

#### Government Identity & Environment Isolation

**IL5 Inter-Environment Communication:**
- Company IL5 and Government IL5 agents CAN communicate — same security classification level
- Agents across company and government IL5 environments share signals, route requests, and leverage each other for collaboration
- Enables seamless workflows spanning company operations and government unclassified work
- The ontology links the canonical identity across both IL5 environments for unified intelligence
- Example: Marcus Chen (canonical) → marcus.chen@wisdomworks.com (Company IL5) + marcus.chen.ctr@agency.mil (Gov IL5) + marcus.chen@sipr.mil (IL6)

**IL6 Isolation (Hard Boundary):**
- IL6 agents operate in complete isolation from IL5 environments
- No signal, data, or communication crosses the IL6 boundary
- IL6 bootstrapping is fully independent — no data from IL5 deployments informs IL6 ontology construction
- **Vision (Future):** Cross-domain solution (IL6 → IL5) with a dedicated agent evaluation team + human-in-the-loop declassification review before any information crosses the classification boundary

#### Government Data Sovereignty & Retention

**Data Sovereignty:**
- IL5: All data processed and stored within Azure Government regions on US soil. Personnel access: US citizens located in the United States, US citizens on US installations abroad, or US citizens attached to US installations using company laptops (outside the installation perimeter)
- IL6: All data within classified boundary on Azure Government Secret. Personnel access: on-installation only — no remote access, no company laptops outside the installation

**Data Retention (Government-Specific):**
- NARA General Records Schedule (GRS) compliance for government records
- NIST SP 800-88 Rev 1 — media sanitization standards for data disposal

#### Government Availability & Connectivity

- Azure Government (IL5): geo-redundant failover required
- Azure Government Secret (IL6): uptime per classified environment SLAs
- Graceful degradation for IL5 deployments on US installations abroad or via company laptops attached to installations with potentially unreliable network conditions

#### Government Integration Stack

- Microsoft 365 (M365) — primary productivity suite in government environments
- SharePoint — document management and collaboration
- Active Directory / Global Address List (AD/GAL) — identity, directory services, organizational structure (government-specific directory infrastructure)
- All Common Integration Stack items from General Platform Requirements apply

#### Risk Mitigations (Government Growth Phase)

| Risk | Impact | Mitigation |
|------|--------|------------|
| ATO denial or delay | Blocks government deployment | Early engagement with DISA, use provisional ATO pathway, align with FedRAMP High baseline from day one |
| Cross-environment data leak (IL6) | Security violation, potential criminal liability | Structural environment isolation — separate ontology instances, signal layers, and agent populations. IL5 environments can communicate; IL6 is hard-isolated |
| Intermittent connectivity (IL5 abroad) | Agent degradation for deployed personnel | Graceful degradation design, pre-computed artifacts, local caching, reconnection protocols |
| Government procurement timeline | Delays funding and deployment | Structure SWP Phase 1 with quarterly demonstrable milestones: Q1 bootstrapping + ontology, Q2 signals + classification, Q3 employee features, Q4 visualization + dashboard |

#### SWP Phase 1 Demonstration Strategy

- Leverage WisdomWorks' own production deployment as proof of platform maturity — the government sees a system already running a real organization, not a prototype
- Structure government SWP proposal with quarterly milestones for incremental proof:
  - **Q1**: Axis team + ontology construction (prove organizational mapping)
  - **Q2**: Signal layer + email classification engine (prove core AI engine works)
  - **Q3**: Employee agent features — morning briefing, report assembly, solution discovery (prove user value)
  - **Q4**: 3D visualization + dashboard + aggregation (prove organizational intelligence)
- Each quarter delivers demonstrable capability for government evaluation
- Phase 2 funding becomes natural progression when Phase 1 proves value incrementally

---

## Innovation & Novel Patterns

### Detected Innovation Areas

**1. Ontology-First Architecture**
No existing enterprise intelligence platform builds a validated data model before deploying AI agents. WisdomWorks inverts the standard approach — instead of deploying AI and hoping it classifies correctly, the Axis team constructs and validates the organizational ontology first. Agents classify against a known, governed data model from day one. This eliminates the "garbage in, garbage out" problem that plagues every existing enterprise AI deployment.

**2. Agent-Per-Person Organizational Mirroring**
Every person in the organization receives a persistent AI agent that mirrors their role. The entire organization is copied into an "agent world" — not as a chatbot or assistant, but as a parallel intelligent layer where agents communicate, collaborate, and coordinate autonomously on behalf of their humans. No existing platform mirrors an entire organization this way.

**3. Signal-Based Communication (Never Raw Content)**
Agents communicate via structured metadata signals, never raw email content. This is architecturally novel — it enables organizational intelligence while structurally enforcing privacy. The signal layer is the innovation: it captures enough meaning for cross-organizational intelligence without exposing the underlying data. Existing platforms either process raw content (privacy risk) or don't process content at all (no intelligence).

**4. Zero Behavior Change Adoption**
WisdomWorks works on the email employees already send. No new tool to learn. No new interface to adopt. No workflow to change. The agent is ambient — processing existing communication patterns to create intelligence. This challenges the fundamental assumption of enterprise software: that users must change their behavior to get value.

**5. "The Organization is Flat" Design Philosophy**
Intelligence, knowledge, and information flow seamlessly across the organization regardless of hierarchy. The agent network creates a flat knowledge topology on top of an inherently hierarchical organization. Information silos are structurally impossible because every agent can query the signal layer. This is a philosophical innovation as much as a technical one.

**6. BMAD-Embedded Innovation Engine**
Every agent includes structured ideation capabilities (BMAD methodology). This turns every team member into a potential solution creator — not just a consumer of the platform. When the CTO agent identifies a technical gap in a client engagement, it structures a solution brief using BMAD methodology and routes it to the appropriate role agents for review. Innovation isn't a separate process; it's woven into the daily workflow. No existing platform embeds structured innovation methodology into individual AI agents.

**7. Confidence-Based Uncertainty Surfacing**
When the classification engine isn't sure, it doesn't guess silently or interrupt the user. Uncertain items are held and surfaced in the morning briefing — a natural touchpoint the user already reviews. The user provides quick clarification, the agent learns, and uncertainty decreases over time. This creates a trust-building feedback loop that doesn't require behavior change.

**8. Founder Agent as Business Orchestrator**
Devon's Founder Agent orchestrates role agents (CTO, Developer, Designer, Marketing, QA, Cybersecurity) that emerge directly from the organizational ontology. The Founder Agent doesn't just manage tasks — it runs the consulting firm: coordinating client engagements, delegating work to role agents, tracking deliverables, and ensuring quality across every engagement. WisdomWorks the AI consulting firm IS the first deployment of its own platform. No existing platform has a single orchestrating agent that runs an entire business through role-derived sub-agents. This is the bridge between "AI assistant" and "AI-operated business" — a category that doesn't yet exist.

### Market Context & Competitive Landscape

- **No direct competitor** combines ontology-first architecture + agent-per-person mirroring + signal-based communication + zero behavior change adoption across consulting firms, professional services, or any knowledge-work organization
- Existing enterprise AI tools (Copilot, Glean, etc.) process content directly, lack ontology governance, and don't create agent-to-agent communication networks
- Professional services firms have no purpose-built organizational intelligence platform — they use email, spreadsheets, and manual processes to coordinate expertise across engagements
- The combination of privacy-first architecture + agent governance + BMAD innovation engine creates a defensible position that is extremely difficult for competitors to replicate
- First-mover advantage in a market segment (AI-native organizational intelligence) that doesn't yet exist as a category
- The Founder Agent model creates a new category entirely: AI-operated consulting firms, where a single founder orchestrates role-derived agents to deliver client work at scale

### Validation Approach

| Innovation | Validation Method | Success Signal |
|-----------|------------------|----------------|
| Ontology-first architecture | Axis team peer-review loop + data engineer human validation | Ontology passes human review, agents classify correctly from day one |
| Agent-per-person mirroring | Deploy on Devon's own organization first as MVP pilot | Agents accurately represent roles and workflows for all team members |
| Signal-based communication | Confidence scoring + morning briefing clarification for uncertain items | Classification accuracy improves over time as agents learn from user corrections |
| Zero behavior change adoption | Measure time-to-value: how quickly do users see benefit without training? | Users report value within first week without any training or workflow changes |
| BMAD innovation engine | Track solution briefs generated and implemented | At least one cross-team solution reuse within first quarter of deployment |
| Flat organization intelligence | Measure cross-team connections discovered vs. pre-WisdomWorks baseline | Signal layer surfaces connections employees didn't know existed |
| Founder Agent orchestration | Deploy on WisdomWorks itself — Devon's Founder Agent manages the consulting firm | Founder Agent successfully coordinates role agents to deliver client engagements |
| Role-derived agents | Validate that role agents emerge correctly from ontology for diverse org types | Role agents match organizational roles and perform domain-appropriate tasks |

### Risk Mitigation

| Innovation Risk | Fallback Strategy |
|----------------|-------------------|
| Ontology doesn't capture organizational complexity | Iterative refinement — Axis team can extend ontology post-deployment, validated by data engineer |
| Signal extraction loses critical context | Conservative classification (uncertain = personal, not business). Morning briefing surfaces uncertain items for user clarification. Monitoring/QA agent team catches systemic patterns |
| Agent-to-agent communication makes errors | Email fallback for all agent-to-agent actions. User always reviews before anything is sent externally |
| Zero behavior change doesn't drive adoption | Agent demonstrates value through morning briefing first — lowest friction touchpoint. If users don't engage with briefing, escalate to direct manager visibility |
| BMAD innovation engine produces noise | Solution briefs route through human review (company software engineers) before implementation. Quality gate prevents low-quality proposals from consuming resources |
| Founder Agent over-centralizes decisions | Configurable autonomy boundaries per role agent. Founder Agent can delegate with governance constraints, not absolute control |
| Role agents don't match real organizational needs | Ontology refinement loop — role agents are derived from validated ontology, so improving the ontology improves role accuracy |

---

## SaaS B2B Specific Requirements

### Tenant Model

**Hybrid Instance Isolation:**
- Each organization (consulting client A, consulting client B) operates its own WisdomWorks instance — fully isolated infrastructure, ontology, signal layer, and agent population
- No shared infrastructure between organizations — tenant isolation is at the instance level, not the data level
- Instances deployed on cloud infrastructure per customer requirements and compliance needs

**MVP: WisdomWorks as First Tenant:**
- WisdomWorks operates its own instance as the first tenant — the consulting firm runs on its own platform
- Client engagements may deploy additional instances or operate within the WisdomWorks instance with client data isolation
- This dual model (dedicated instance vs. isolated partition within WisdomWorks instance) is determined per engagement based on client size, sensitivity, and compliance requirements

**Cross-Instance Interaction:**
- When a person exists in multiple WisdomWorks instances (e.g., a consultant with both a WisdomWorks instance and a client instance), their agents interact via email — the same channel agents already process
- No direct API federation between instances — cross-instance communication flows through email, which both instances' agents handle naturally
- Views remain separated by instance — a user's internal dashboard shows internal context, their client dashboard shows client context
- Cross-instance communication is monitored and flagged, not gated by approval — aligns with standard email communication norms between organizations

**Instance Provisioning:**
- Each new customer organization requires an Axis team deployment to build their ontology
- Instances are independent — one organization's ontology, workflows, and agent configurations have no dependency on another's
- Instance lifecycle (provisioning, scaling, decommissioning) managed per organization

### Revenue & Pricing Model

**MVP: Consulting Revenue (Primary)**
- WisdomWorks operates as an AI consulting firm — revenue comes from consulting engagements where WisdomWorks deploys its platform to solve client problems
- Engagement-based pricing: discovery + deployment + ongoing support
- Devon + role agents deliver the consulting work using the WisdomWorks platform
- Revenue model: consulting fees (time & materials or fixed-price engagements)
- The platform is the delivery mechanism, not the product being sold — clients pay for outcomes, WisdomWorks happens to deliver them using its own platform

**Growth: SaaS Licensing**
- Self-service or assisted deployment of WisdomWorks platform for organizations that want to run it independently
- Per-organization licensing — not per-seat, because the value is organizational intelligence, not individual tool access
- Tiered pricing based on organization size and feature set
- Transition path: consulting clients who want to self-operate can convert from consulting engagement to SaaS license

**Growth: Government Contracts**
- Multi-year, multi-million dollar engagements — aligned with government procurement cycles (SWP, SBIR, or direct contract vehicles)
- Pricing structure accounts for dedicated infrastructure, compliance overhead, and Axis team deployment
- Per-instance pricing rather than per-seat — consistent with the organizational intelligence value model
- Additional pricing for compliance overhead (IL5/IL6 infrastructure, FedRAMP, CMMC) and dedicated support

### Access & Visibility Model

**"The Organization is Flat" Dashboard Philosophy:**
- No role-based dashboard tier restrictions — every user can see all dashboard views
- Users see how their information flows throughout the organization — understanding their "why" and their impact
- Dashboard views are perspectives (individual, team, functional group, program, enterprise), not permission levels
- Any user can explore the 3D visualization at any scope — from their personal contributions to enterprise-wide intelligence
- This transparency reinforces organizational culture change: when people see how their work connects, they contribute more intentionally

**Agent Configuration & Self-Improvement (Growth Phase):**
- *This capability is deferred to Growth phase — not part of MVP. Described here as the target-state model for agent configuration.*
- Agents are not manually configured by administrators after initial deployment
- Agents identify inefficiencies through their interactions with each other — the agent network is self-diagnosing
- Inefficiency recommendations are surfaced to the Axis team and company engineers for review and implementation
- Human approval required before agent behavior changes are deployed — agents recommend, humans decide
- This creates a continuous improvement loop: agents detect → recommend → humans approve → agents improve → organization becomes more efficient over time
- The system gets smarter without requiring manual configuration management

### RBAC Matrix

**Founder (Devon):**
- Full platform access — all agent orchestration, all client data, all configuration
- Client management: engagement creation, scoping, handoff
- Revenue and business operations visibility across all engagements
- Only role with cross-client visibility by default

**Role Agent Operators:**
- Domain-specific access scoped to their function — CTO agent sees technical artifacts, Marketing agent sees marketing data, QA agent sees quality metrics
- Can operate across client engagements only when explicitly assigned to those engagements
- No access to business operations data (revenue, pricing, client contracts) unless role-relevant

**Client Users:**
- Scoped to their engagement data only — cannot see other clients' data or WisdomWorks internal operations
- Dashboard views reflect only their organization's ontology, signals, and agent population
- No awareness that other client instances exist

**Platform Administrators:**
- Infrastructure management, deployment configuration, monitoring
- Access to system health, performance metrics, and deployment pipelines across all instances
- No access to client business data — admin access is infrastructure-level, not content-level

### Client Data Isolation

- Each consulting client's data is fully isolated — separate ontology instances, signal layers, and agent populations per client
- No cross-client data leakage — client A's organizational intelligence is invisible to client B
- WisdomWorks internal instance is also isolated from client instances — the consulting firm's own operations data does not bleed into client views
- Audit logging tracks all data access per client boundary — every read, write, and agent interaction is logged with client context
- Isolation enforcement is architectural, not policy-based — separate data stores, separate agent populations, separate signal processing pipelines

### Integration Architecture

*Note: Detailed integration requirements covered in Domain-Specific Requirements. This section captures SaaS B2B-specific integration patterns.*

- Each instance discovers its integration landscape during bootstrapping — not all organizations have the same tools
- Integration adapters are modular — add/remove per customer environment without architectural changes
- Cross-instance integration happens via email only — no direct system-to-system connections between organizations
- Agent tool adaptability: agents can leverage new tools and build custom workflows as organizations adopt new software

### Implementation Considerations

- **Instance templating:** While each organization's ontology is unique, the deployment pipeline (Axis team, agent provisioning, integration discovery) should be repeatable and templated
- **Scaling model:** Each instance scales independently based on organization size — from small consulting firms (5-20 people) to enterprise organizations (thousands)
- **Monitoring:** Per-instance health monitoring with aggregate visibility for WisdomWorks operations team
- **Updates:** Platform updates deployed per-instance with customer-controlled rollout schedules per customer requirements
- **Client onboarding pipeline:** Repeatable process for new consulting engagements — discovery, ontology construction, agent deployment, training, handoff

---

## Project Scoping & Phased Development

### MVP Strategy & Philosophy

**MVP Approach:** Platform MVP — proving the complete organizational intelligence thesis by running WisdomWorks the AI consulting firm on the WisdomWorks platform

WisdomWorks' value proposition only works when the full loop closes: ontology → classification → signals → agent communication → reporting → visualization. Removing any piece breaks the thesis. The MVP is not a deployment to a customer — WisdomWorks IS the customer. Devon's Founder Agent orchestrates the business. Role agents run the firm. Consulting revenue funds the next phase.

**Resource Requirements:** Devon's engineering team. No acceptable scope reduction — the full MVP feature set as defined is the minimum viable proof. If the product ships with less, it doesn't prove the thesis.

### MVP Feature Set (Phase 1 — 90 Days)

**Core User Journeys Supported (All 12):**
All user journeys documented in this PRD are MVP journeys. Devon (Founder), CTO Agent, Marketing Agent, QA Agent, Cybersecurity Agent, Axis Team, Admin/Data Engineer, Error Recovery, Remote Work, Passive Agent, Governance Admin, and Prospective Customer all operate at MVP.

**Must-Have Capabilities (14 Features — No Cuts):**
1. Personal AI Agent (per employee)
2. Model Abstraction Layer
3. Organization Data Model (enterprise ontology)
4. Agent-to-Agent Communication & Awareness
5. Defined Agent Workflows
6. Export-First Artifact Generation
7. BMAD-Embedded Innovation Engine
8. Manager Dashboard
9. Integration Layer (POC)
10. 3D Interactive Intelligence Visualization (pre-computed snapshots)
11. Deployment Architecture
12. Compliance Foundation
13. WisdomWorks Website & Distribution (parallel track)
14. Founder Agent & Role Agent Bootstrapping

**Build Priority Sequence:** See Product Scope section for detailed sequencing.

### Pre-MVP Discovery Milestone

Before committing engineering resources to the 90-day MVP build, validate the email access authorization pathway. WisdomWorks' entire intelligence engine depends on programmatic access to employee email (Exchange/Outlook or equivalent). Confirm programmatic access to the team's email system before engineering begins. Authorization complexity varies by organization — confirm the pathway before the 90-day clock starts.

This is a gating dependency. If email access authorization takes 60 days, the 90-day MVP timeline must account for it — either by initiating the authorization process before engineering begins, or by adjusting the timeline to absorb the delay. Discovery deliverable: a documented, confirmed pathway to programmatic email access in the target environment, with timeline and approvals identified. Engineering starts after this pathway is secured, not before.

### Feature Dependency Mapping

The 13 MVP features are not independent. The build sequence follows a critical dependency chain:

**Critical Path:** Integrations + Ontology → Personal Agent → Agent-to-Agent → Dashboard

```
Feature 9 (Integrations) ──────┐
                                ├──► Feature 1 (Personal Agent) ──► Feature 4 (Agent-to-Agent) ──► Feature 8 (Dashboard)
Feature 3 (Ontology)     ──────┘
```

| Feature | Depends On | Track |
|---------|-----------|-------|
| Feature 3 — Organization Data Model | Feature 9 (Integrations feed ontology construction) | Critical path |
| Feature 1 — Personal AI Agent | Feature 3 (Ontology), Feature 9 (Integrations) | Critical path |
| Feature 4 — Agent-to-Agent Communication | Feature 1 (Personal Agent) | Critical path |
| Feature 8 — Manager Dashboard | Feature 4 (Agent-to-Agent) | Critical path |
| Feature 5 — Defined Agent Workflows | Feature 1 (Personal Agent) | Dependent |
| Feature 6 — Export-First Artifact Generation | Feature 1 (Personal Agent) | Dependent |
| Feature 7 — BMAD Innovation Engine | Feature 1 (Personal Agent) | Dependent |
| Feature 10 — 3D Interactive Visualization | Feature 3 (Ontology), Feature 8 (Dashboard) | Dependent |
| Feature 13 — Website & Admin Portal | Feature 3 (Ontology) for Axis views | Parallel track |
| Feature 2 — Model Abstraction Layer | None — independent | Parallel track |
| Feature 9 — Integration Layer | None — feeds Features 1 and 3 | Parallel track (early start) |
| Feature 11 — Dual Deployment Architecture | None — infrastructure | Parallel track |
| Feature 12 — Compliance Foundation | None — woven into all features | Cross-cutting |

Feature 9 (Integrations) and Feature 3 (Ontology) must start first and in parallel — they are the foundation everything else builds on. Feature 2 (Model Abstraction), Feature 11 (Dual Deploy), and Feature 13 (Website) can progress independently without blocking or being blocked by the critical path. Feature 12 (Compliance) is a continuous requirement enforced across every feature as it is built.

### Post-MVP Features

**Phase 2 — Growth:**
- Government contractor deployment — first external customer, Axis team multi-org deployment, IL5-ready
- SaaS licensing model launched — first external organizations on the WisdomWorks platform
- Self-improving agent system (agents detecting inefficiencies, recommending changes — human-approved)
- Executive dashboards (Tier 4-5)
- 3D visualization real-time streaming
- Inter-agent ticketing (IT helpdesk, HR, secondary agents)
- Multi-organization bootstrapping templates
- IL5 formal certification and ATO completion
- FedRAMP formal certification
- Budget analyst specialized features (advanced workflows)
- Enterprise ontology governance and KM dashboards
- Expanded integration targets for commercial customers

**Phase 3 — Vision:**
- IL6 (classified SECRET) deployment on Azure Government Secret
- Cross-domain solution (IL6 → IL5) with agent evaluation team + human-in-the-loop
- Marketplace of agent workflow templates
- Cross-organization signal exchange (multi-party engagement coordination, prime/sub-contractor coordination)
- AI model marketplace
- Cross-instance federation beyond email (direct API if governance permits)

### Risk Mitigation Strategy

**Technical Risk — Ontology Construction (CRITICAL PATH):**
The Axis team + ontology is the single highest-risk element. If it doesn't capture the organization correctly, the entire foundation fails — every downstream capability (classification, signals, agent communication, reporting) depends on a correct ontology.

*Mitigation:*
- Axis agents cross-validate each other's work (peer-review)
- Data engineer human review before any agent deployment
- Iterative refinement capability — ontology can be extended and corrected post-deployment
- Devon's own organization is the first deployment — deep domain knowledge available to validate
- Confidence scoring surfaces ontology gaps early (misclassifications indicate model problems)

**Market Risk — Category Creation:**
WisdomWorks is creating a new market category (organizational intelligence for knowledge-intensive firms). No existing demand signal to validate against.

*Mitigation:*
- Deploy on Devon's own consulting firm first — internal proof before external market
- Build complete MVP internally, demonstrate full capability as unified showcase
- First external customer demonstration becomes the market validation event
- First-mover advantage means competition can't invalidate the approach before it's proven

**Resource Risk — No Acceptable Cuts:**
The full MVP feature set is the minimum viable proof. Scope reduction is not an acceptable response to resource constraints.

*Mitigation:*
- Build priority sequence ensures highest-value work completes first — if timeline pressure hits, the foundation and user value are already built
- Parallel track (website) can absorb timeline delays without blocking core platform
- Pre-computed 3D snapshots (vs. real-time streaming) already represents a scope-conscious design choice
- Integration POC scope (email platform, organizational directory, project tracking) is already minimal

---

## Functional Requirements

*WisdomWorks capabilities are organized into three architectural layers plus cross-cutting concerns that span all layers.*

### Layer 1: Email Intelligence & Organizational Knowledge

*The core intelligence engine — email classification, signal extraction, ontology management, and the data model that powers every downstream capability. Nothing works without this layer.*

#### Email Intelligence & Classification

- FR1: Employee agents can classify incoming emails as business, personal, or uncertain
- FR2: Employee agents can filter personal correspondence from entering the business signal layer
- FR3: Employee agents can assign confidence scores to each email classification
- FR4: Employee agents can hold uncertain classifications and surface them in the user's morning briefing for clarification
- FR5: Employee agents can learn from user corrections to improve classification accuracy over time
- FR6: A monitoring/QA agent team can detect systemic classification patterns (misclassification trends, edge cases)
- FR7: The platform can purge extracted data when an email is reclassified (e.g., business to personal), ensuring no residual parsed data from personal correspondence persists in the ontology or dashboards

#### Signal-Based Communication & Agent Network

- FR21: Agents can communicate with other agents via structured metadata signals (never raw email content)
- FR22: Agents can coordinate cross-agent tasks (report collection, information requests, task handoffs, deadline management)
- FR23: Agents can fall back to drafting email for user review when a counterpart agent doesn't exist
- FR24: Agents can discover cross-agent connections (people, capabilities, solutions) that users didn't know existed
- FR25: Agents can require user consent before executing any cross-agent action
- FR26: Agents in authorized deployment environments at the same security classification level can communicate via signals across those environments
- FR27: The platform can enforce signal routing governance rules defining which signal types can cross between authorized deployment environments

#### Organization Data Model & Ontology

- FR28: The Axis team can construct an enterprise ontology from organizational data sources (AD/GAL, Workday, policies)
- FR29: Axis agents can cross-validate each other's ontology work (peer-review)
- FR30: A data engineer can review and approve the completed ontology before agent deployment
- FR31: The ontology can be extended and refined post-deployment without disrupting active agents
- FR32: The ontology can represent employees, roles, contracts, projects, clients, capabilities, risks, decisions, tasks, and innovations with referential integrity
- FR91: The Axis team can produce an organizational deployment specification defining interaction model selection, integration configuration, workflow templates, and agent deployment plan as a core deliverable alongside the ontology
- FR92: The Axis team can evaluate and recommend which interaction channels (email, desktop chat, terminal) are appropriate for each role category based on the organization's security posture, IT policies, and work patterns
- FR93: The Axis team can document the organization's mission, purpose, tool inventory, and operational patterns as a machine-readable organizational profile that informs agent behavior configuration
- FR164: The Axis team can derive role agent definitions from the organizational ontology — mapping organizational roles, responsibilities, and domain expertise to agent capabilities and access boundaries
- FR165: The Founder Agent can orchestrate role agents (CTO, Developer, Designer, Marketing, QA, Cybersecurity) by delegating tasks, coordinating deliverables, and tracking engagement progress across the consulting firm's operations
- FR166: Role agents can emerge from the organizational ontology for any organization type — the same bootstrapping process that creates role agents for WisdomWorks can create role agents for any client organization

#### Email Data Extraction & Ontology Mapping

- FR33: Employee agents can parse and extract structured data from emails (dates, deadlines, budget figures, project references, personnel, milestones, action items)
- FR34: A data relationship workflow can map extracted email data to existing ontology entities (connecting parsed data to the organizational model built by the Axis team)
- FR35: Dashboards can display ontology-mapped data extracted from the email stream
- FR36: The data relationship workflow can identify new entities or relationships not yet in the ontology and flag them for Axis team review

#### BMAD Innovation Engine

- FR58: Every agent can activate structured ideation capabilities (BMAD methodology) to help users create solution briefs
- FR59: Solution briefs can be routed to designated reviewers (role agents or human engineers) for feasibility review
- FR60: The platform can track innovation proposals across the organization (pipeline tracking)
- FR61: Agents can surface cross-agent solution discovery (reusable work from other teams)

#### Integration Layer

- FR51: The platform can integrate with directory services (Active Directory, LDAP, cloud identity providers) for identity and organizational structure
- FR52: The platform can integrate with HR management systems for organizational hierarchy, roles, and program tracking (read-only)
- FR53: The platform can integrate with project management and financial systems for timecard tracking and budget data
- FR54: The platform can integrate with email platforms (Exchange, M365, Gmail) for email processing
- FR55: The platform can integrate with organizational policy and knowledge repositories for knowledge base content
- FR56: The platform can integrate with document management and collaboration platforms (SharePoint, Google Workspace, Confluence)
- FR57: The Axis team can discover which integrations exist per deployment and configure accordingly

---

### Layer 2: Desktop Agent & Productivity Assistant

*The user's daily interaction surface — personal agent capabilities across email, desktop, and terminal. This is where the agent becomes tangible.*

#### Interaction Channels

- FR94: The platform can support three interaction channels for agent communication: email as correspondent, desktop chat window, and terminal
- FR95: The Axis team can select which interaction channels are active per deployment based on organizational requirements and security posture
- FR96: Users can switch between active interaction channels within a single session without losing conversation context or pending tasks
- FR97: Employee agents can maintain consistent behavior, personality, and capability set across all active interaction channels
- FR98: The email-as-correspondent channel can present the agent as a standard email correspondent requiring zero user behavior change (the agent appears as another person in the user's inbox)
- FR99: The desktop chat window channel can provide a persistent, always-available interface on the user's desktop for direct agent interaction
- FR100: The terminal channel can execute agent instructions in the user's local terminal environment for building solutions, code changes, and development tasks
- FR101: The platform can log all agent interactions uniformly across channels for audit compliance regardless of which channel originated the interaction

#### Personal Agent Capabilities

- FR8: Each employee can receive a personal AI agent that mirrors their organizational role
- FR9: Employee agents can generate a morning briefing summarizing actionable items, deadlines, and uncertain classifications
- FR10: Employee agents can draft email responses for user review and approval before sending
- FR11: Employee agents can correct grammar in user-composed content
- FR12: Employee agents can propose monthly report bullets based on the user's email activity and completed tasks
- FR13: Employee agents can carry forward incomplete tasks across sessions
- FR14: Employee agents can provide calendar awareness (conflict detection, scheduling suggestions)
- FR15: Employee agents can answer company policy questions from an ingested knowledge base
- FR16: Employee agents can prevent mistakes by flagging potential errors (wrong recipient, missing attachment, policy conflicts)
- FR17: Employee agents can support career development by surfacing relevant opportunities from organizational signals
- FR18: Users can name their personal agent
- FR19: Employee agents can deliver time-sensitive notifications for urgent items outside the morning briefing cycle (deadline conflicts, critical signals, escalations)
- FR20: Users can interact with their personal agent (communication channel for queries, approvals, and feedback)
- FR102: Employee agents can ingest the user's resume or professional profile to ground agent personalization in the user's actual role context, experience level, skills, and domain expertise
- FR103: Employee agents can learn and understand their user passively through email patterns, work habits, and tool usage — without requiring resume ingestion or explicit user interaction — to build a behavioral profile that improves agent assistance over time

#### Desktop Agent Runtime

- FR104: The platform can install and run a local agent runtime on the user's desktop machine with minimal configuration
- FR105: The desktop agent runtime can interact through the user's terminal to build solutions, execute commands, and perform development tasks
- FR106: The desktop agent runtime can operate within Microsoft Outlook as an embedded experience (reading, composing, classifying, and managing email without requiring the user to leave Outlook)
- FR107: The desktop agent runtime can provide a desktop chat window for interacting with all desktop tools and applications through a single conversational interface
- FR108: The desktop agent runtime can open and close applications on the user's desktop on behalf of the user
- FR109: The desktop agent runtime can control desktop tools and applications (navigating interfaces, entering data, extracting information, executing tool-specific operations) on behalf of the user
- FR110: The desktop agent runtime can assist with development tasks including VS Code project updates, file modifications, build execution, and test runs
- FR111: Users can grant, revoke, and scope permissions for which applications and operations the desktop agent runtime can control (per-application and per-action granularity)
- FR112: The desktop agent runtime can operate within the user's existing security context and credentials without requiring elevated privileges beyond what the user already possesses
- FR113: The desktop agent runtime can maintain a persistent connection to the WisdomWorks platform for signal exchange, state synchronization, and remote command reception while operating locally

#### Remote Agent Command

- FR114: Employee agents can recognize and authenticate commands received from a user's pre-registered external email addresses (e.g., personal Yahoo or Gmail account sending to the work agent)
- FR115: Users can register and manage a list of authorized external email addresses permitted to send commands to their agent
- FR116: Employee agents can parse natural language instructions from authenticated external emails into executable agent commands (e.g., "update the VS Code project," "run tests," "check build status")
- FR117: The desktop agent runtime can execute remotely commanded tasks locally on the user's machine upon receiving validated external commands
- FR118: Employee agents can report execution results back to the originating external email address (status, output, errors, completion confirmation)
- FR119: The platform can log all remote commands with originating address, timestamp, parsed intent, execution status, and result for audit compliance
- FR120: Employee agents can reject commands from unregistered or unrecognized external email addresses and log the rejected attempt
- FR121: Users can define which command categories are permitted via remote execution (e.g., allow read-only queries but block destructive operations) to limit remote command scope

#### Passive Agent Mode

- FR122: Employee agents can operate in a passive observation mode that monitors work patterns, tool usage, and workflow sequences without requiring user interaction
- FR123: Employee agents can generate efficiency suggestions derived from observed patterns, each accompanied by a concrete example from the user's own recent workflow
- FR124: Users can configure the maximum frequency of unsolicited suggestions (default: 3 per day) to prevent cognitive burden
- FR125: Users can disable passive agent mode entirely, halting all unsolicited observation and suggestion activity
- FR126: Employee agents can deliver passive suggestions through the user's active interaction channel at contextually appropriate times (not during meetings, focused work blocks, or configured quiet periods)
- FR127: Users can provide feedback on passive suggestions (helpful, not helpful, stop suggesting this type) to improve future suggestion relevance
- FR128: The platform can track passive suggestion acceptance rates per user to measure and improve suggestion quality over time

#### Agent State Persistence

- FR129: Employee agents can persist all learned preferences, accumulated context, schedule patterns, and interaction history across sessions and application restarts
- FR130: Employee agents can recover from an unexpected restart within 2 minutes with zero signal loss and full restoration of learned state
- FR131: Employee agents can accumulate contextual knowledge over time (user preferences, communication style, frequently referenced contacts, recurring task patterns) and apply it to improve agent behavior progressively
- FR132: The platform can version agent state snapshots to support rollback if a state corruption or undesirable learning drift is detected
- FR133: Agent state persistence can survive desktop agent runtime updates and platform upgrades without requiring users to re-teach preferences or rebuild context
- FR134: Users can inspect a summary of what their agent has learned (preferences, patterns, key context) and correct or delete specific learned items
- FR135: The platform can synchronize agent state to the cloud backend so that agent recovery does not depend solely on local storage integrity

#### Artifact Generation & Export

- FR45: Agents can generate PowerPoint presentations matching organizational formats
- FR46: Agents can generate Excel spreadsheets with budget data, burn rates, and projections
- FR47: Agents can generate Word documents for reports
- FR48: Agents can generate PDF documents for distribution
- FR49: Agents can collect and assemble monthly reports from team member agents via agent-to-agent communication
- FR50: Budget-responsible agents can aggregate budget data from multiple project agents and produce reconciled financial reports

#### Workflow & Agent Management

- FR62: Agents can execute defined workflows (email processing, report generation, deadline management, escalation patterns)
- FR63: Agents can build and execute custom workflows for organizational processes
- FR64: Agents can leverage other users' agents for routing and cross-functional collaboration
- FR65: Agents can send timecard reminders and track submission status
- FR66: Agents can track travel authorizations and surface travel-related information
- FR67: Agents can adapt to software upgrades without rebuilding agent architecture

#### Schedule Awareness & Accountability

- FR87: Employee agents can learn and track their user's daily schedule patterns (lunch breaks, gym time, personal routines) to optimize timing of notifications, tasks, and scheduling suggestions
- FR88: Employee agents can report on accountability metrics for their user (deadline adherence, task completion rates, commitment follow-through, hour schedule compliance) to support personal productivity awareness

---

### Layer 3: WisdomWorks Operations Console

*Deployment management, monitoring, and organizational intelligence visualization — how WisdomWorks is operated and how intelligence is surfaced.*

#### WisdomWorks Admin Portal

- FR136: Instance administrators can view a per-instance environment overview displaying organization name, deployment type (internal/client/government), active agent count, ontology health, and integration connectivity status on a single pane
- FR137: Instance administrators can view Axis team progress metrics showing percentage of organizational structure mapped, entity coverage by category (employees, roles, contracts, projects, capabilities), and per-entity confidence scores
- FR138: Instance administrators can view the organization's mission and purpose statement as understood and synthesized by the Axis team, with version history tracking refinements over time
- FR139: Instance administrators can view the full inventory of tools and integrations discovered by the Axis team during bootstrapping, including connection status, last sync timestamp, and data freshness indicators per integration
- FR140: Instance administrators can interact with ontology confidence scores to refine classifications — accepting, rejecting, or correcting Axis team assessments — with changes propagating to affected entities and downstream agent behavior
- FR141: Instance administrators can browse and inspect all database tables and entity structures created from the Axis team's organizational evaluation, including row counts, relationship maps, and schema definitions
- FR142: Instance administrators can view agent deployment count segmented by status (active, degraded, provisioning, decommissioned) with drill-down to individual agent health metrics
- FR143: Instance administrators can view an agent interconnectivity visualization displaying the organizational hierarchy of agents, their reporting relationships, and active communication channels between them
- FR144: Instance administrators can view a data flow visualization showing how information routes through the agent network — signal paths, aggregation points, reporting chains, and cross-team data exchange patterns
- FR145: The operations console can surface alerts when confidence scores drop below configurable thresholds, when agent connectivity degrades, or when ontology inconsistencies are detected
- FR146: Instance administrators can export operations console data (agent metrics, ontology status, data flow snapshots) for compliance reporting and stakeholder briefings

#### WisdomWorks Public Website

- FR147: The WisdomWorks public website can present product information, capability descriptions, deployment model overview, and differentiation messaging to prospective customers without requiring authentication
- FR148: The WisdomWorks public website can provide customer onboarding entry points (contact, demo requests, government procurement pathway information) that route to the appropriate sales or deployment workflow
- FR149: The WisdomWorks public website can display pricing structure information (consulting engagement model, SaaS licensing tiers, government contract model) appropriate to the current phase of the business

#### Dashboards & Visualization

- FR37: All users can access all dashboard perspective views (individual, team, functional group, program, enterprise)
- FR38: Users can see how their information flows throughout the organization from any dashboard view
- FR39: The manager dashboard can display aggregated business signals (privacy-respecting, non-punitive)
- FR40: The manager dashboard can detect cross-team overlap and surface it
- FR41: Users can explore a 3D interactive visualization of organizational intelligence (pre-computed snapshots at MVP)
- FR42: The 3D visualization can show how information, teams, contracts, capabilities, and risks interconnect
- FR43: The 3D visualization can support "explode" animations to reveal relationship depth
- FR44: Dashboards can display historical data trends and comparisons over time (budget burn rates, signal volumes, team performance trajectories)

#### Platform Administration (BMAD-Driven)

- FR68: Platform updates and administrative changes can be executed through BMAD methodology
- FR69: A data engineer can initiate AI model swaps through configuration without code changes
- FR70: A data engineer can extend the ontology with new entity types
- FR71: The platform can support multiple AI models simultaneously (different models for different task types)
- FR72: The monitoring/QA agent team can flag privacy boundary issues, misclassifications, and signal failures to the data engineer
- FR73: A data engineer can validate new AI model performance against the current model before committing a model swap
- FR74: The Axis team can provision and deploy individual employee agents after ontology approval
- FR75: The platform can handle agent lifecycle events when personnel changes occur (role transfers, departures, onboarding — including agent reassignment, archival, or knowledge transfer)

#### Deployment & Multi-Instance

- FR81: Each customer organization can operate a fully isolated WisdomWorks instance
- FR82: Cross-instance agent interaction can occur via email between instances at the same security classification level
- FR83: A canonical identity can link a person across multiple environment-scoped profiles (e.g., internal deployment, client deployment, government deployment)
- FR84: The Axis team can deploy per environment with independent ontology construction
- FR167: Each consulting client engagement can operate with fully isolated data boundaries — separate ontology, signal layer, and agent population per client, with no cross-client data visibility
- FR168: The platform can track consulting engagement lifecycle (discovery, ontology construction, agent deployment, active operations, handoff) with status visibility for the Founder Agent and designated administrators

#### Agent Deployment Model

- FR150: A deployment authority (Devon during MVP; organizational designee at scale) can authorize the provisioning of new employee agents for a specific WisdomWorks instance
- FR151: The platform can execute a repeatable agent provisioning workflow: ontology readiness verification, role-to-agent mapping confirmation, integration connectivity check, agent instantiation, and health validation — with each step gated on the prior step's success
- FR152: The platform can enforce a deployment approval chain where agent deployment requests are submitted, reviewed, and approved before provisioning executes — with the chain configurable per instance (single-approver for MVP, multi-level for enterprise scale)
- FR153: The platform can track deployment status for every agent from request through provisioning through active operation, providing audit trail visibility to deployment authorities

---

### Cross-Cutting Concerns

*Capabilities that span all three layers.*

#### Agent Governance Framework

- FR154: Instance administrators can define governance rules specifying which agent actions require user approval and which are permitted autonomously, expressed as configurable allow/deny policies per action category
- FR155: The platform can enforce governance rules at runtime — blocking or gating agent actions in real time before execution, not as post-hoc policy audit
- FR156: Instance administrators can configure governance rules per instance, allowing different organizations to define different autonomy boundaries based on their risk tolerance and compliance requirements
- FR157: Agents can classify each prospective action as autonomous-permitted or approval-required based on the active governance ruleset before attempting execution
- FR158: The platform can detect and handle governance boundary violations — logging the violation, blocking the action, notifying the affected user, and alerting the instance administrator
- FR159: Governance rules can restrict agents from sending external communications (emails, messages) without explicit user approval
- FR160: Governance rules can restrict agents from modifying, creating, or deleting files and artifacts without explicit user approval, unless the agent is operating in an explicitly activated autonomous mode
- FR161: Governance rules can restrict agents from accessing applications, APIs, or data sources not explicitly authorized in the instance's integration configuration
- FR162: The platform can maintain a complete audit log of all governance rule evaluations — recording the action attempted, the rule matched, the decision (permitted/blocked/escalated), and the timestamp — for compliance and forensic review
- FR163: Instance administrators can update governance rules on a running instance with changes taking effect immediately — no agent restart or redeployment required
- FR169: The Founder Agent can define and adjust autonomy boundaries per role agent — specifying which actions each role agent can take autonomously and which require Founder Agent or human approval
- FR170: Role agents can escalate decisions that exceed their configured autonomy boundaries to the Founder Agent, providing context, options, and recommended actions

#### Compliance & Security

- FR76: The platform can enforce privacy-first filtering at the classification boundary (personal content never enters business signal layer)
- FR77: The platform can maintain comprehensive audit logging for all agent actions and signal processing
- FR78: The platform can operate on government cloud (Azure Government IL5) and standard cloud infrastructure from the same codebase
- FR79: All user-facing interfaces can meet Section 508 accessibility standards
- FR80: The platform can support FIPS 140-2/140-3 validated encryption at rest and in transit

#### Error Handling & Recovery

- FR89: The data extraction workflow can handle extraction failures gracefully (malformed data, ambiguous references, low-confidence extractions) by logging the failure, preserving the source email reference, and surfacing unresolvable items for human review
- FR90: Agents can detect and recover from failed cross-agent communications (retry, notify user, or escalate) without silent data loss

#### Showcase & Demonstration

- FR85: The platform can operate in a showcase/demonstration mode that presents WisdomWorks' full capability loop across all three layers (ontology → classification → signals → agent communication → desktop agent → dashboards → visualization) as a cohesive proof of concept for stakeholders, investors, and prospective clients

---

## Non-Functional Requirements

### Performance

- **Email classification decision:** Individual email classified within 5 seconds of receipt; full pipeline processing (classification + signal extraction + ontology mapping + dashboard update) within 30 seconds. Measured by automated pipeline instrumentation logging timestamp at receipt and at dashboard update completion
- **Email batch processing:** Overnight backlog of up to 500 emails processed within 15 minutes. Measured by batch job completion timestamp against batch start time
- **Morning briefing generation:** Assembled and delivered within 5 minutes of configured delivery time. Measured by comparing briefing delivery timestamp to configured schedule
- **Dashboard load time:** Standard dashboard views render within 3 seconds; complex aggregated views (multi-project, enterprise) within 5 seconds. Measured by browser performance timing API from navigation start to DOM content loaded
- **Dashboard data accuracy:** 95%+ accuracy of dashboard data against source email data within 30 days of deployment, validated by user correction feedback
- **3D visualization initial load:** Pre-computed snapshot loads within 5 seconds; "explode" animations render within 2 seconds. Measured by render completion callback timestamp
- **Artifact generation:** PowerPoint, Excel, Word, PDF documents generated within 2 minutes for standard report sizes. Measured by generation request timestamp to file-ready notification
- **Agent-to-agent signal processing:** End-to-end signal delivery between agents within 60 seconds under normal conditions. Measured by signal send timestamp to recipient agent acknowledgment
- **Classification accuracy:** 90% email classification accuracy within first 30 days (measured by user correction rate in morning briefings), improving to 95%+ within 90 days
- **Showcase/demo responsiveness:** All user-facing operations in showcase mode perform at or better than standard targets — the demo IS the product, not a separate lighter-weight experience
- **Concurrent users per instance (MVP):** 13 simultaneous users with no performance degradation. Validated by load testing with simulated concurrent sessions

### Security

- **Encryption:** FIPS 140-2/140-3 validated cryptographic modules for all data at rest and in transit — no exceptions. Validated by cryptographic module certification documentation and automated configuration scanning
- **Privacy boundary enforcement (defense-in-depth SLA):** No personal content persists in the business signal layer beyond one classification cycle. The combined system — automated classification + confidence scoring + monitoring/QA agent team + purge capability — achieves an effective 100% privacy rate as measured by monthly audit. Misclassifications detected by the monitoring/QA agent team are purged within 5 minutes of detection. Individual classifier accuracy targets (90% at 30 days, 95% at 90 days) are supplemented by the monitoring layer to close the gap. The privacy guarantee is a system-level SLA, not a single-classifier claim
- **Audit coverage:** 100% of agent actions, signal processing events, cross-agent communications, and administrative operations logged with timestamps, actor identification, and action type. Validated by weekly automated audit log completeness checks comparing agent action counts to log entry counts
- **Access control:** Role-based access to platform administration functions (data engineer, Axis team operations) with least-privilege enforcement; dashboard views unrestricted per "the organization is flat" philosophy. Validated by automated RBAC policy enforcement tests and quarterly access review audits
- **Session security:** Aligned with NIST SP 800-53 IA control family — session timeouts, re-authentication requirements, multi-factor authentication for administrative access. Validated by automated session management tests and penetration testing
- **Data minimization:** Platform stores only business-relevant signal metadata — no raw email content, no personal correspondence data. Validated by quarterly data store audit confirming zero raw email content and zero personal content beyond one classification cycle
- **Credential management:** No plaintext credentials stored; integration credentials (email platform, directory services, HR systems, financial systems) managed via secure vault with rotation support. Validated by automated vault configuration scanning and credential rotation monitoring
- **Client data isolation:** Zero cross-client data visibility — consulting client A cannot access, query, or infer any data from client B's instance or partition. Validated by automated cross-tenant access testing and penetration testing of isolation boundaries

### Scalability

- **Proof-of-concept (1 user):** Devon testing personally with Outlook — validates full capability loop (ontology → classification → signals → dashboards → visualization) end-to-end before team deployment
- **MVP instance (13 users):** Devon's team, single instance — all performance targets met and proven through showcase testing
- **Growth architecture readiness:** Architecture supports scaling to 500+ users per instance without re-architecture; horizontal scaling for agent processing, vertical scaling for ontology operations. Growth targets are architectural design requirements, not MVP-validated metrics
- **Multi-instance independence:** No performance degradation from other running instances — each instance operates on isolated infrastructure. Validated by multi-instance load testing with concurrent operational instances
- **Ontology capacity:** Supports 10,000+ entities with maintained referential integrity (employees, roles, contracts, projects, clients, capabilities, risks, decisions, tasks, innovations). Validated by load testing with synthetic ontology datasets at target entity counts
- **Email throughput (Growth architecture):** Designed to process 1,000+ emails per hour per instance without queue saturation
- **Signal layer throughput (Growth architecture):** Designed to handle 10,000+ signals per day per instance with consistent delivery latency

### Accessibility

- **Standard compliance:** All dashboard and agent interaction interfaces meet WCAG 2.1 AA and Section 508 accessibility standards at MVP. Validated by automated accessibility scanning (axe-core) and manual WCAG audit
- **3D visualization accessibility:** 3D visualization provides alternative accessible views (tabular data, text descriptions of relationships) for non-visual exploration. Full WCAG compliance on WebGL deferred to Growth
- **Keyboard navigation:** All dashboard views and agent interaction interfaces fully navigable via keyboard. Validated by manual keyboard-only testing of all interactive elements
- **Screen reader compatibility:** Dashboard content, morning briefings, and agent responses structured for screen reader consumption. Validated by testing with NVDA and VoiceOver screen readers
- **Color and contrast:** All standard interfaces provide sufficient color contrast ratios and alternative visual indicators beyond color alone. Validated by automated contrast ratio analysis against WCAG 2.1 AA thresholds (4.5:1 normal text, 3:1 large text)
- **Responsive design:** Website and dashboard interfaces functional across standard desktop screen sizes (1280px+ width); mobile optimization deferred to Growth

### Reliability

- **Platform uptime:** 99.5% monthly average at MVP (scheduled maintenance windows excluded from availability calculations); no single unplanned outage exceeding 30 minutes. Target 99.9% for high-compliance production deployments at Growth
- **Agent self-monitoring:** Each agent reports health status; unhealthy agents automatically restart with state recovery within 2 minutes, with no loss of queued signals or pending tasks
- **Signal delivery guarantee:** At-least-once delivery for all agent-to-agent signals — no dropped signals; duplicate detection prevents double-processing. Measured by signal send/receive reconciliation logs; validated by chaos testing with simulated failures
- **Ontology write consistency:** All ontology modifications (entity creation, relationship mapping, email data extraction commits) are atomic — the full relationship chain commits or none of it does. Eventual consistency acceptable for signal propagation; strong consistency required for ontology writes
- **Graceful degradation tiers:** Agents operate at defined degradation levels during partial outages:
  - *Tier 1 (Core available):* Email classification, morning briefing generation, personal agent queries functional
  - *Tier 2 (Reduced):* Agent-to-agent communication delayed/queued, dashboards serve cached data, artifact generation paused
  - *Tier 3 (Minimal):* Read-only access to cached dashboard data and previous briefings, no new processing until services recover
- **Data durability:** Zero data loss for ontology, signals, and agent state — backed by cloud-native redundancy per cloud provider SLAs. Validated by disaster recovery drills and backup restoration tests quarterly
- **Backup and recovery:** Full instance backup daily; point-in-time recovery within 24 hours; Axis team ontology snapshot preserved as baseline for disaster recovery. Validated by monthly backup restoration tests with measured recovery time

### Integration

- **Email platform connectivity:** Near-real-time email event processing (webhook or polling at < 1 minute intervals); graceful handling of email platform throttling limits
  - *Failure behavior:* If email platform unavailable — agents queue locally, process backlog on reconnection, morning briefing notes data gap
- **Directory/HR systems sync:** Organizational structure synchronized at minimum daily; delta sync for personnel changes within 4 hours
  - *Failure behavior:* If directory/HR systems unavailable — agents operate with last-known organizational data, flag stale data to data engineer
- **Financial/project management systems integration:** Timecard and budget data synchronized daily; manual refresh capability for month-end reconciliation
  - *Failure behavior:* If financial/project management systems unavailable — budget dashboards display last-known data with staleness indicator, timecard reminders continue from cached schedule
- **Webhook/API resilience:** Integration adapters handle transient failures (timeouts, rate limits, temporary unavailability) with automatic reconnection using exponential backoff — no data loss or duplicate processing
- **Showcase integration requirements:** MVP showcase requires only email platform connectivity + website hosting — other integrations (directory services, HR systems, financial systems) enhanceable but not blocking for initial demonstration

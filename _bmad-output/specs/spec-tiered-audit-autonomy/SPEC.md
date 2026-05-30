---
id: SPEC-tiered-audit-autonomy
companions:
  - audit-tiers.md
  - autonomy-levels.md
  - architecture-diagrams.md
  - brownfield.md
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability only.

# Cost-Tiered Auditing + Earned Autonomy

## Why

WisdomWorks runs a multi-agent team under Iris. Single-agent decisions on high-stakes actions (sending, charging, deleting, persisting state, consequential delegation) need an independent check — and production transcripts show the real failure shapes: Iris doing a sub-agent's job herself, presenting an agent's work the agent never produced, fabricating completed state. An audit layer is the fix. But the naive version of that fix — an expensive model auditing every turn — inverts the cost structure and risks a $300–$3000/month bill, which is an existential cost problem for a solo operator already watching every dollar of API spend. This spec defines an audit layer that is **cheap by default and expensive only where stakes justify it**, that **gets cheaper as agents learn**, and that **cannot run away** thanks to a hard per-tenant spend cap. It matters now because delegation was just made to actually work (workers run role-complete), so the audit can finally be built on a foundation that executes. Affected: Devon today; every future tenant who spins up their own agents.

## Capabilities

- id: CAP-1
  intent: The platform detects role/fabrication violations from the turn's tool log alone — delegation-miss (domain owned by an agent, no delegate_to_agent), persistence claimed with no persisting tool, and agent-work-substitution (a worker's output presented with no delegate_to_agent) — with no model call.
  success: A reply that presents "Coach's" workout while delegate_to_agent is absent from the turn's tools is flagged at zero LLM cost; covered by unit tests over tool-log fixtures.

- id: CAP-2
  intent: The platform flags response-quality violations that require language judgment (question answered, on-topic, tone, no volunteered topics) on every owner-facing reply.
  success: Runs on the cheap audit model at ≈$0.002/turn and writes one row to axis_critiques per audited reply.

- id: CAP-3
  intent: For high-stakes actions, or when a lower tier flags ambiguity, the platform runs a stronger-model adversarial critique plus a behavioral-RAG-informed verifier (tone / intent / known frustrations) before the action commits.
  success: Tier-2 fires on a "charge the client $400" action and does NOT fire on "what's the weather"; the share of turns invoking Tier-2 is reportable and stays within the high-stakes set.

- id: CAP-4
  intent: When the audit flags a fixable violation, Iris revises once, the revision is re-audited once, and the system ships the safer of the two — never recursing.
  success: No turn issues more than draft + one revision generation call; demonstrable from logs. (Already implemented in commit 8d52aad; this capability ratifies and protects it.)

- id: CAP-5
  intent: Each action-class carries an autonomy level (L1–L4) that sets how much audit it requires and whether it needs human approval; the level is raised or lowered from that action-class's measured violation rate over a rolling window.
  success: An action-class whose measured violation rate stays below threshold for N turns graduates to a lower audit tier, and one that regresses is demoted — both decidable from axis_critiques aggregation. Autonomy never moves on owner sentiment or kudos.

- id: CAP-6
  intent: Each tenant has a daily LLM-spend ceiling; when it is reached, the expensive (Tier-2) audit disables and the system falls back to deterministic + cheap auditing, logging the trip.
  success: With the cap set to $C, a tenant's daily LLM spend cannot exceed $C plus at most one in-flight turn; every trip is logged and observable.

- id: CAP-7
  intent: Recurring owner patterns (schedule, routines) are distilled from behavioral memory into a slowly-changing routine profile carried in the cached prompt prefix, so agents predict from it instead of re-deriving via tool calls each turn.
  success: A recurring routine (e.g., usual training day/time) is captured as structured, queryable data and rendered into the cached prefix; an agent answers a routine-dependent question without re-issuing the tool calls it previously needed.

- id: CAP-8
  intent: Every agent-originated message to the owner passes at least the deterministic + cheap audit before delivery; no surface sends agent output unaudited.
  success: The team-digest path (pushDigestToOwner → sendOwnerMessage) and any other agent→owner sender route through the audit before delivery; no unaudited agent→owner send paths remain.

## Constraints

- Iris, the decision-making orchestrator, stays on the stronger model (Sonnet 4.6 today). Never downgrade the generator to fund the auditor — prevention at generation is cheaper and more reliable than detect-and-repair.
- The expensive (Opus-class) audit must never run on every turn; it is reserved for high-stakes actions or lower-tier-flagged ambiguity.
- Auditing is non-recursive: at most one revision plus one re-audit, then fallback. No critique↔revise loops.
- Autonomy elevation and demotion are driven only by measured violation rates, never by owner kudos or sentiment (kudos can reward a response that sounded right but fabricated).
- A per-tenant daily spend cap is mandatory; runaway cost must be structurally impossible, not merely unlikely.
- Where a violation is decidable from the tool log, it is checked deterministically in code, not by a model.
- Audit failure is non-blocking: if an auditor errors, ship the draft and log — never block owner delivery on an audit failure.

## Non-goals

- Not flipping Iris to a weaker model, and not putting the expensive model on an every-turn audit.
- Not a recursive critique-revise loop.
- Not running the expensive tier on trivial / chitchat turns.
- Not autonomy driven by owner kudos or sentiment.
- Not building the temporal/recurrence layer (CAP-7) in the first increment — the spec defines it but does not require it before CAP-6 and CAP-1 ship (see brownfield.md rollout).
- Not removing Iris's existing regex pre-filters or the worker-boundary gate — those stay as cheap pre-filters beneath the tiers.

## Success signal

Iris reliably delegates domain work to the right agent, never presents an agent's output the agent didn't produce, and genuinely risky actions get an independent adversarial + verifier check — while audit cost per active tenant stays in low single-dollar-per-month territory and cannot exceed the configured daily cap. Over weeks, the audit frequency for proven action-classes visibly declines as autonomy is earned: the system gets cheaper as it learns.

## Assumptions

- Iris stays on Sonnet 4.6 and the Tier-1 critic on Haiku 4.5 as the cost baseline (per Devon: no Haiku-Iris flip).
- "High-stakes" means actions that send externally, move money, delete/overwrite, persist durable state, or delegate consequential work — the exact set is enumerated in audit-tiers.md.
- axis_critiques is the system of record for the violation-rate measurement that drives autonomy.

## Decisions (resolved)

- **Tier-0 gates are BLOCKING** — a Tier-0 violation forces a bounded revision (not advisory/log-only), subject to the CAP-4 loop guard (one revision, re-audit once, fallback).

## Open Questions

- Daily spend-cap exact value per plan tier. **Proposed default (2026-05-30, grounded in chat_runs: lifetime $23.25 / 280 runs; busiest real day $2.67; typical $1–2.50/day): $5 per tenant per day** (~2× the busiest observed day; ~$150/mo hard ceiling). When hit: Tier-2 disables first; core owner-facing Iris replies are never hard-blocked (degrade audit/delegation + warn the owner). Confirm the value and the per-plan ladder. (Note: debug-tool runs use persist=false and are NOT recorded to chat_runs, so the cap meters real owner traffic only — intended.)
- The rolling window length and violation-rate threshold that govern autonomy elevation/demotion per action-class.
- Tier-2 shape: two separate model calls (adversarial + verifier) for separation-of-duties, or one call carrying both lenses for cost — which wins.

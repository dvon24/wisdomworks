# Brownfield — current state, gaps, rollout

What exists today (verified 2026-05-29/30) so downstream knows what to extend vs. build.

## Already built (extend these, don't rebuild)

- **Axis critic** — `apps/web/app/api/_lib/axis-critic.ts`, `critiqueResponse()`. Haiku 4.5, stateless, per-surface rule sheets. This IS Tier-1 (CAP-2).
- **Wired surfaces** — iris-chat (`iris-brain.ts`), daily-briefing, digest, email-sift, workflow-dispatcher each call `critiqueResponse`.
- **Bounded revision + re-audit + fallback** — `iris-brain.ts` Axis section (commit 8d52aad; repaired 2026-05-29 — it was silently dead on every PTC turn). This IS CAP-4.
- **Phase-1 delegation rules** — `should_have_delegated` (MEDIUM) + `presents_unproduced_agent_work` (HIGH) in the iris-chat rule sheet, with a deterministic `toolsUsedThisTurn` guard in `critiqueResponse`. These are currently MODEL rules; CAP-1 moves them to deterministic Tier-0 code.
- **Delegation works** — `delegate_to_agent` runs role-complete workers (config tools + preferred_model + behavioral-RAG seed) via the shared **`apps/web/app/api/_lib/anthropic-agent-loop.ts`** (`runAgentToolLoop` / `callAnthropicJSON`). All sub-agent calls route through it.
- **Cheap pre-filters** — regex recital/attribution/fabrication gates + `worker-boundary-gate.ts`. This is the "Pre" tier.
- **Destructive-tool set** — `DESTRUCTIVE_TOOLS` in `agent-tools.ts` — seed for the high-stakes set (audit-tiers.md).
- **Cost tracking** — `chat_runs` via `recordChatRun` / `recordLlmCall` (chat-cost-tracker.ts). Basis for the spend cap (CAP-6) and violation-rate/cost reporting.
- **Violation store** — `axis_critiques` (persistCritique). System of record for autonomy measurement (CAP-5).
- **Behavioral RAG** — `behavioral-rag-ingest.ts` + `recall_behavioral_rag` tool + per-agent role-seeded `loadRecentContextForAgent` (agent-behavioral-rag.ts). Pure semantic search — NO temporal aggregation.

## Gaps (what each capability adds)

- **CAP-1** — promote the two Phase-1 delegation checks from Haiku rules to free deterministic code; add persistence-without-tool as a deterministic gate (today it's a Haiku rule + a regex guard).
- **CAP-3** — Tier-2 Opus adversarial + verifier does NOT exist. New. Must be behavioral-RAG-informed (today's critic is stateless with no tools — feed RAG content in as text, don't give the critic tools).
- **CAP-5** — autonomy L1–L4 exists as a concept ([[project_unified_trust_model]]) but is NOT wired to control audit depth/approval from `axis_critiques` rates.
- **CAP-6** — no per-tenant daily spend cap exists. New. Reads `chat_runs`. **First to build.**
- **CAP-7** — no recurrence/temporal layer over behavioral RAG; no cached routine profile. Largest build. Last of the three.
- **CAP-8** — `pushDigestToOwner → sendOwnerMessage` (agent-runtime.ts) and lane-tick raw output reach the owner unaudited. Route them through the audit.

## Agreed rollout sequence

1. **CAP-6 — spend-cap circuit breaker.** Cheapest insurance; makes everything after it safe to experiment with. The hard "never a $3000 month" guarantee.
2. **CAP-1 — deterministic Tier-0 gates.** Convert the Phase-1 delegation rules to free tool-log checks; add persistence gate. Removes cost + improves reliability.
3. **CAP-7 — recurrence/distill layer → cached routine profile.** The Layer-B learning foundation that powers prediction and caching.

CAP-3 (Tier-2 Opus), CAP-5 (autonomy wiring), and CAP-8 (close the digest leak) follow once 1–3 are in and there is a live high-stakes action path to audit.

## Out-of-repo prerequisite

MS Calendar Graph token is 401'ing (owner action) — it fails the `coach-morning-workout-prompt` workflow and any calendar-dependent audit/test. Not blocking this spec, but flagged.

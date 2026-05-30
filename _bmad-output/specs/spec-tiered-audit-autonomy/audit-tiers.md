# Audit Tiers

The audit is tiered by stakes. Cheap checks run always; the expensive model runs rarely. Cost figures are per-turn order-of-magnitude at ~1500 owner turns/month.

| Tier | What it is | Model | Runs | Checks | ~Cost/turn | Blocking? |
|---|---|---|---|---|---|---|
| **Pre** | Existing regex pre-filters + worker-boundary gate | none | every turn | recital/attribution/fabrication regex; worker output boundary | $0 | strips/flags only |
| **0** | Deterministic tool-log gates | none | every turn | delegation-miss, persistence-without-tool, agent-work-substitution (all decidable from `toolsUsedThisTurn`) | $0 | **blocking — forces a bounded revision** |
| **1** | Language critic | Haiku 4.5 | every turn | answered the question, on-topic, tone, no volunteered topics, no resurrected history | ≈$0.002 | one bounded revision on HIGH |
| **2** | Adversarial + verifier | Opus 4.x | high-stakes OR Tier-0/1 flagged ambiguity | adversarial: attack the response/action vs. what behavioral RAG knows about the owner; verifier: does it meet intent + clear known frustration signals | ≈$0.10–0.20 | one bounded revision; on irreconcilable verdict, hold action / escalate to owner |

## Monthly cost shape (≈1500 turns)

- Iris generating (Sonnet): ~$150/mo — dominant, and it is generation not audit.
- Tier-1 every turn (Haiku): ~$3/mo — negligible.
- Tier-2 **every turn** (Opus): ~$225/mo — the blowup this design forbids.
- Tier-2 **high-stakes only** (~10% of turns): ~$22/mo — the target.

The lever that bends the curve over time is **autonomy** (autonomy-levels.md): proven action-classes stop invoking Tier-2 at all.

## High-stakes action set (triggers Tier-2)

An action is high-stakes if it does any of:
- **Sends externally** — email/WhatsApp/SMS to a non-owner, social post, anything that leaves the tenant.
- **Moves money** — invoice, charge, refund, payment, spend approval.
- **Deletes or overwrites** — destructive tools (the existing DESTRUCTIVE_TOOLS set is the seed list).
- **Persists durable state** — create_workflow, set_canonical_role, set_sender_rules, set_marketing_autonomy, add/remove/move agent, enable_mcp_server, connect_automation_webhook.
- **Delegates consequential work** — a delegation whose worker itself calls a high-stakes tool.

Everything else (read-only lookups, chat, status answers, a workout draft) is NOT high-stakes and never reaches Tier-2 unless Tier-0/1 explicitly flags ambiguity.

## Loop guard (CAP-4, already shipped)

flag → one revision → re-audit once → ship the safer of {original, revision} → never recurse. On Tier-2 high-stakes where the revision still fails verification, do not ship the action: hold and surface to the owner ("I'm not confident about X — confirm?").

## Spend-cap interaction (CAP-6)

Per-tenant daily LLM spend is already tracked (chat_runs). When the day's spend ≥ cap: Tier-2 disables (turns fall back to Pre+0+1), the trip is logged, and — if still climbing — delegation/proactive work degrades. **Core owner-facing Iris replies are never hard-blocked** (the owner always gets an answer, with a degraded-mode warning). The cap guarantees daily spend ≤ cap + one in-flight turn.

**Proposed default (2026-05-30, from real chat_runs):** lifetime spend $23.25 over 280 runs; daily range $0.37–$2.67; typical $1–2.50/day; busiest day $2.67. Default cap **$5/tenant/day** (~2× busiest observed; ~$150/mo hard ceiling), tunable per plan. Confirm before build. Caveat: debug-tool runs (`persist=false`) skip `recordChatRun`, so the cap meters real owner traffic only — intended.

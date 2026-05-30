# Autonomy Levels (L1 → L4)

Autonomy is a property of an **action-class** (e.g. "draft external email", "post to social", "create workflow", "answer coaching question"), not of an agent globally. It controls **how much audit that action requires** and **whether a human must approve**. It is **earned from measured violation rates**, never from owner sentiment.

| Level | Audit depth | Human approval | How it's earned |
|---|---|---|---|
| **L1** | Pre + Tier-0 + Tier-1 + Tier-2 always | Propose → owner approves before it commits | Default for any new or high-stakes action-class |
| **L2** | Pre + Tier-0 + Tier-1; Tier-2 on high-stakes | Auto-commit low-stakes; approve high-stakes | Violation rate below threshold for N turns at L1 |
| **L3** | Pre + Tier-0 + Tier-1; Tier-2 only on flagged ambiguity | Auto-commit; notify after | Sustained low violation rate at L2 |
| **L4** | Pre + Tier-0; Tier-1 sampled | Auto-commit; sampled review | Long clean track record at L3 |

## Earning and losing levels

- **Signal:** the per-action-class violation rate computed from `axis_critiques` over a rolling window of N turns (N and the pass/fail threshold are open questions in SPEC.md).
- **Elevate:** violation rate stays below threshold for the full window → action-class moves up one level.
- **Demote:** a HIGH violation, or violation rate crossing back above threshold → action-class drops at least one level immediately (fast demotion, slow promotion).
- **Never** moved by owner kudos, thumbs-up, or sentiment. Kudos can reward a fabrication that sounded right; only measured correctness counts.

## Why this is the cost lever

Tier-2 (Opus) is the expensive call. As an action-class earns L2→L3→L4, Tier-2 fires on fewer and fewer of its turns. Combined with the learning loop (CAP-7) lowering violation rates in the first place, the expensive audit asymptotes toward "only genuinely novel/risky moments," which is what keeps the bill bounded as volume grows.

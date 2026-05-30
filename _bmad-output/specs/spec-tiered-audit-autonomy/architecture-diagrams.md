# Architecture Diagrams

## Per-turn audit flow

```mermaid
flowchart TD
    U[Owner message] --> I[Iris generates draft + tool/agent calls<br/>Sonnet 4.6]
    I --> P[Pre: regex pre-filters + worker-boundary gate<br/>$0]
    P --> T0{Tier 0: deterministic<br/>tool-log gates · $0}
    T0 -->|clean| T1[Tier 1: Haiku language critic<br/>~$0.002 every turn]
    T0 -->|violation| T1
    T1 --> STK{High-stakes action<br/>OR Tier-0/1 flagged?}
    STK -->|no| SHIP[Deliver to owner]
    STK -->|yes, and autonomy level allows| T2[Tier 2: Opus adversarial + verifier<br/>behavioral-RAG-informed · ~$0.15]
    STK -->|cap tripped| SHIP
    T1 -->|HIGH violation| REV[Revise once]
    T2 -->|HIGH violation| REV
    REV --> RA[Re-audit once]
    RA -->|pass| SHIP
    RA -->|still bad| FB[Ship safer-of-two<br/>or hold high-stakes + ask owner]
    FB --> SHIP
```

Bounded: at most draft + one revision. No critique↔revise recursion.

## Cost-via-learning loop (the curve-bender over time)

```mermaid
flowchart LR
    BR[Behavioral RAG<br/>raw owner interactions] --> RX[Recurrence / distill layer<br/>NEW — temporal aggregation]
    RX --> RP[Cached routine profile<br/>in prompt prefix]
    RP --> PRED[Agents predict instead of re-deriving<br/>fewer tool calls / delegations]
    PRED --> LV[Lower violation rate]
    LV --> AUT[Autonomy rises<br/>per action-class]
    AUT --> LESS[Tier-2 fires less often]
    LESS --> COST[Audit cost falls as volume grows]
    CAP[Per-tenant daily spend cap] -. hard backstop .-> LESS
```

## Audit surface coverage (target)

```mermaid
flowchart TD
    subgraph audited[Through an audited surface]
      IC[iris-chat reply]
      DB[daily-briefing]
      DG[digest]
      ES[email-sift]
      WD[workflow-dispatcher]
      DEL[delegated worker output<br/>presented by Iris → audited as her reply]
      TD[team-digest — CAP-8: route through audit]
    end
    subgraph todo[Not yet audited]
      LT[lane-tick raw output]
    end
    audited --> OWNER[Owner]
    todo -. surfaces via .-> DB
```

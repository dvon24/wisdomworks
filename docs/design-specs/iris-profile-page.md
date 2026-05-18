# Design spec — "What Iris Has Learned About You" deck page

**For:** Claude Design (Devon will hand this spec over)
**Outputs:** a single React page component for the WisdomWorks deck — owner-facing, read-only-with-dismiss-actions, lives at a new route inside `apps/web/app/`.

This page is the **persistent, owner-facing** version of two existing on-demand Iris tools (`show_disposition_profile` + `show_agent_sop`). The owner needed something they can return to, screenshot, share — not just a chat reply that scrolls away.

---

## Why this page exists (one-paragraph background — context for Claude Design)

WisdomWorks AI agents silently learn how the owner works — from every WhatsApp turn, every email, every approval and correction. That learning becomes (a) **disposition rules** ("Devon prefers terse replies", "never email Ron after 7pm") that get injected into every agent's prompt, and (b) **per-agent operating manuals** (techniques each agent has proven, guardrails it's been corrected on, domain facts it knows). The owner needs to be able to *see* this — both for trust ("what does the system actually know about me?") and for control ("dismiss the rules that are wrong"). This page is that view.

---

## Data contract — the API the page renders

`GET /api/iris-profile?phone=<tenant_phone>`

Returns JSON shaped like this (every field is real, served by the endpoint shipped 2026-05-18):

```ts
{
  tenant_phone: "491703604562",
  computed_at: "2026-05-18T15:32:00Z",
  learning_stats: {
    total_rules: 17,
    rules_by_kind: {
      preference: 8,
      frustration_trigger: 3,
      correction: 4,
      communication_style: 2,
    },
    agents_with_skills: 4,
    total_skills: 23,
    earliest_rule_created_at: "2026-04-25T10:14:00Z",
    most_recent_rule_at: "2026-05-18T09:01:00Z",
  },
  disposition: [
    {
      kind: "preference",
      label: "How you like things done",
      rules: [
        {
          id: "uuid",
          rule_text: "Devon prefers terse, no-throat-clearing responses with concrete next steps.",
          why: "Owner has corrected verbose responses 4 times in the last week.",
          evidence: "‘just give me the answer’ — 2026-05-17",
          scope: "everywhere",
          confidence: 0.92,
          applied_count: 7,
          last_applied_at: "2026-05-18T08:11:00Z",
          created_at: "2026-05-11T14:00:00Z",
        },
        // ...
      ],
    },
    {
      kind: "frustration_trigger",
      label: "Things that frustrate you",
      rules: [/* ... */],
    },
    // groups appear in this order ONLY when they have rules:
    //   preference, frustration_trigger, communication_style, correction, approval
  ],
  agents: [
    {
      agent_name: "Marcus",
      agent_role: "Financial Advisor",
      lane: "finance",
      description: "Handles budgeting, expense tracking, invoicing...",
      recent_activity: {
        total_ticks: 47,
        by_outcome: { observed: 28, proposed: 15, acted: 3, escalated: 1 },
        last_acted_at: "2026-05-17T14:22:00Z",
        sample_outputs: [
          "[proposed] Q1 expense summary: $4,200 across 23 transactions...",
          "[acted] Reconciled 8 Stripe payouts to invoices.",
          "[escalated] Found a $1,250 charge from an unknown vendor.",
        ],
      },
      capabilities: ["whatsapp", "email", "create_document", "list_calendar_events"],
      proven_techniques: [
        { technique: "Batch similar expenses into a single weekly summary instead of pinging the owner per transaction.", success_rate: 0.94, uses: 17 },
        { technique: "When proposing a payment, include the vendor's prior payment history.", success_rate: 1.0, uses: 4 },
      ],
      guardrails: [
        { rule: "Never auto-approve charges over $500 — always propose for owner sign-off.", severity: "high", reason: "Owner reversed an auto-paid invoice on 2026-04-29." },
      ],
      domain_facts: [
        { kind: "preference", content: "Owner uses QuickBooks for the WisdomWorks side, Stripe for Au7o." },
        { kind: "constraint", content: "Don't categorize meals over $200 as business — those are personal." },
      ],
    },
    // ... one per active agent
  ],
}
```

---

## Page anatomy (top to bottom)

### 1. Page header

- Title: **"What Iris has learned about you"**
- Subtitle (small, dim): *"This is everything the system has picked up from your interactions. Keep what's right. Dismiss what's wrong."*
- A "Last updated" timestamp from `computed_at`, relative format ("3 minutes ago").
- A subtle refresh affordance (link or button, not a giant CTA).

### 2. Learning summary band

A horizontal band of 3-4 KPI tiles. Use the existing `.glass` or `.glass-strong` card style from the deck.

- **"X rules learned"** — `learning_stats.total_rules`
- **"Y agents on your team"** — `agents.length`
- **"Z proven techniques"** — `learning_stats.total_skills`
- **"Learning since DATE"** — formatted from `learning_stats.earliest_rule_created_at`, e.g. "April 25 (23 days ago)"

These tiles should feel like quiet stats, not flashy dashboard widgets. The owner should look at them once and think "huh, neat" — then move on to the meat below.

### 3. Disposition section — "Rules Iris is following"

For each group in `disposition` (the API only returns groups with rules — so an absent kind = empty, just skip its header):

- **Group header**: emoji + the `label` field + a count chip ("8 rules")
  - Suggested emojis per kind:
    - preference → 🎯
    - frustration_trigger → ⚠️
    - communication_style → 🗣️
    - correction → 🔧
    - approval → ✅
- **Rule cards** in the group, stacked vertically:
  - The `rule_text` as the primary line (medium weight, ~14px)
  - The `why` as a smaller dim line directly under it
  - The `evidence` (if present) in monospace, even dimmer, with a quote-mark prefix
  - **Confidence bar**: a thin horizontal bar showing `confidence * 100%` — colored by tier:
    - 0–60%: dim gray ("learning")
    - 60–85%: accent ("trusted")
    - 85–100%: accent-deep ("strong rule")
  - A tiny metadata row at the bottom: scope · applied N times · learned DATE
  - A **"Dismiss"** button (text-link style, low visual weight) — POSTs to `/api/iris-profile/dismiss-rule` with `{ rule_id }` (this endpoint doesn't exist yet; if Claude Design generates an `onClick` handler for it, that's fine — I'll wire the endpoint when the page lands).

### 4. Agents section — "Your team"

For each agent in `agents`:

- **Collapsible card**: closed by default, header shows agent name + role + a small activity summary ("47 ticks · 21 proposed · 3 acted")
- **Expanded card** reveals an "operating manual" view with these subsections:
  - **What they do (lane + description)** — one paragraph
  - **Recent activity** — the `sample_outputs` array as a stack of short tags (each one shows the outcome chip + the truncated summary)
  - **Proven techniques** — a list of `proven_techniques`, each one with the technique text + a small "X uses · Y% success" pill
  - **Guardrails** — a list of `guardrails`, each with the rule + severity pill + (collapsed-by-default) reason
  - **Domain knowledge** — the `domain_facts` as compact bullets grouped by `kind`

The agent cards should feel calm — these are operating manuals, not status dashboards. Reading should feel like opening a coworker's personal-doc page, not a Datadog board.

### 5. Empty states (these matter)

- **No disposition rules yet**: instead of an empty section, show a single gentle card: "I'm still learning. Once we've had a few back-and-forths, I'll start picking up your preferences and surfacing them here."
- **No agents yet**: shouldn't happen (agents are provisioned at onboarding), but if it does: "Your team hasn't been provisioned yet. Talk to Iris to get started."
- **An agent with zero recent activity**: show the card but with a muted "Idle this week — nothing to report" footer.

---

## Interaction notes

- **Dismiss rule**: optimistic UI. Click → card animates out → POST in the background. On error, animate it back in with a small error toast. This pattern matches the approvals tab.
- **Expand agent**: smooth height transition; the operating manual content is somewhat tall, so animate, don't snap.
- **No bulk actions** in v1 — owner dismisses one rule at a time on purpose. Bulk-clear is a footgun.

---

## Visual language — pull from the existing deck

The deck uses:

- A glass/frosted card system (`.glass`, `.glass-strong` in the existing CSS)
- Color tokens: `var(--text)`, `var(--text-dim)`, `var(--text-faint)`, `var(--accent)`, `var(--accent-deep)`, `var(--glass-border)`, `var(--bad-text)`
- Monospace `.mono` for IDs and evidence quotes
- A `pop-in` and `breathe` animation library for first-load entrances
- Generally: thin borders, restrained color, lots of whitespace, low-key elegance

This page should feel **continuous** with the rest of the deck — same family. Not a "settings page" treatment, not a "table-of-records" treatment. More like opening a journal.

Reference for tone: see `apps/web/app/page.tsx` for how the existing deck handles glass cards, sidebar sections, and "soft tech" presentation.

---

## What this page is NOT

- **NOT** an admin panel — there are no toggles, no settings, no destructive actions beyond dismissing individual rules
- **NOT** a real-time dashboard — content refreshes when the user reloads or hits the refresh affordance, not via websockets
- **NOT** the place to BUILD agents or RULES — that happens in chat with Iris. This page only shows what she's already built.
- **NOT** a Word/PDF export surface (Devon explicitly opted out of that)

---

## What I'm building on my side (the parts Claude Design does NOT do)

- ✅ `GET /api/iris-profile?phone=<tenant>` — already shipped (this is the data source)
- ⏳ `POST /api/iris-profile/dismiss-rule` — small endpoint that wraps the existing `dismissDispositionRule` helper; will ship the same day the deck page lands
- ⏳ The page route registration in the Next.js app (whatever path Claude Design generates the component for, I'll add to the dashboard nav)

If Claude Design wants to suggest a sensible URL path (e.g. `/dashboard/iris-profile` or `/what-iris-knows`), great — I'll register whatever it picks.

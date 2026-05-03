# Handoff: WisdomWorks — Command Deck & Onboarding

## Overview
WisdomWorks is an AI agent operations platform. Users get a personal coordinator (**Iris**) plus a team of specialist agents (Atlas, Sable, Juno, Vega, etc.) that handle work autonomously and report back through a single chat channel (WhatsApp). The two designs in this package are:

1. **Onboarding** — first-run experience that introduces the brand, picks an industry, then reveals a tailored AI team in a hierarchy diagram.
2. **Command Deck** — main dashboard. Live agent hierarchy, chat with Iris, agent detail view (incl. model/tier picker with pricing), team-management side panel, approvals stack, activity feed.

Brand wordmark: **WisdomWorks** + italic tagline *because it does.*

## About the Design Files
The HTML/JSX files in this bundle are **design references**, not production code. They render via in-browser Babel + UMD React pinned through `<script>` tags — fine for prototype review, not for shipping. Treat them as the source of truth for **visuals, copy, layout, and interaction**, and recreate them in the target codebase using its existing framework, design system, and conventions. If no codebase exists yet, React + Vite + Tailwind/CSS-modules is a sensible default; the structure of `src/` here ports cleanly.

## Fidelity
**High-fidelity.** All colors, type, spacing, radii, animations, and copy are intentional and final. Recreate pixel-faithfully where possible. The only thing held loose is the Three.js globe in the Command Deck Overview (works as drawn but feel free to substitute a Canvas/WebGL primitive that fits your stack).

## Files

### Top-level entry HTMLs
- `Command Deck.html` — dashboard. Hosts `<div id="root">`, loads React + Babel CDN, then loads each JSX file in order: `tweaks-panel`, `data`, `logo`, `hierarchy`, `chat`, `agent-panel`, `agent-detail`, `price-diff`, `app`.
- `Onboarding.html` — onboarding flow. Same shape; loads `tweaks-panel`, `data`, `logo`, `background`, `hierarchy`, then its inline `app` script.

### `src/` — JSX components
| File | Purpose |
|---|---|
| `data.jsx` | Single source of truth: tenant info, user, agent catalog, pricing tiers, externals, proposals, helpers. **Start here.** |
| `logo.jsx` | `<Wordmark>` ("WisdomWorks" + italic *because it does.*) and `<WisdomMark>` / `<WisdomMarkInline>` — the orbital atom mark used in the nav and as Iris's avatar. |
| `hierarchy.jsx` | The team hierarchy SVG diagram (You → Iris → specialists, with tools row + animated comm arc). |
| `chat.jsx` | Iris chat UI — message stream, input, typing indicator, expanding panel. |
| `agent-panel.jsx` | Right-side team management drawer — list of active agents with add/remove/swap-tier controls, agent catalog with costs. |
| `agent-detail.jsx` | Full-screen agent detail view: stats, activity feed, direct chat, model/tier picker with prices. |
| `price-diff.jsx` | Floating "+€39/mo" diff card that animates in when team composition changes. |
| `tweaks-panel.jsx` | Toolbar-driven tweaks panel (palette, density, demo flows). Standard host-protocol wrapper — fine to drop in dev tooling, omit in production. |
| `background.jsx` | Aurora gradient background (CSS blobs, no video). |
| `shared.jsx` | Tiny shared utilities/styles. |
| `design-canvas.jsx`, `variants.jsx` | Earlier exploration artifacts. **Not used by the live screens** — safe to ignore. |
| `app.jsx` | Command Deck root: nav, KPI strip, view tabs (Overview/Individual/Team/Enterprise/Activity), right sidebar (Briefing/Approvals/Activity). |

## Design Tokens

### Colors
```
--accent:              #7c3aed   /* Violet — primary brand */
--accent-deep:         #5b21b6   /* Hover / pressed */
--accent-soft:         rgba(124,58,237,0.16)
--accent-line:         rgba(124,58,237,0.45)

--text:                #1a1a22
--text-dim:            rgba(26,26,34,0.70)
--text-faint:          rgba(26,26,34,0.50)

--glass-bg:            rgba(255,255,255,0.55)
--glass-bg-strong:     rgba(255,255,255,0.74)
--glass-border:        rgba(20,20,30,0.08)
--glass-border-strong: rgba(20,20,30,0.14)

Status:
  ok:    #2cb070
  warn:  #d99b3b   (text on warn pill: #8a4f10)
  bad:   #c84545   (text on bad pill:  #8a2a2a)
```
Background: aurora gradient — soft violet/blue/pink CSS blobs that drift slowly behind glass surfaces.

### Typography
- **Sans**: `Geist`, weights 250 / 300 / 400 / 500 / 600 / 700. Loaded from Google Fonts.
- **Mono**: `Geist Mono`, weights 400 / 500. Used for eyebrows, tier labels, pricing, status text.
- **Wordmark / tagline**: italic serif (system serif italic) for *because it does.*

Display scale (used by the deck):
```
.num-xxl  { weight: 250; size: 76px; tracking: -0.04em; }
.num-lg   { /* large headline, see Command Deck.html */ }
.num-md   { /* card numbers */ }
.eyebrow  { mono, 10px, 0.18em tracking, uppercase, color: --text-faint }
```

### Surfaces
- `.glass`        — `backdrop-filter: blur(20px) saturate(140%)`, `bg: --glass-bg`,        `border: 1px solid --glass-border`,        `radius: 16px`
- `.glass-strong` — `backdrop-filter: blur(28px) saturate(140%)`, `bg: --glass-bg-strong`, `border: 1px solid --glass-border-strong`, `radius: 16px`

### Shadows
Primary CTA: `0 6px 20px rgba(124,58,237,0.32)`. Strong card: `0 24px 60px rgba(20,20,40,0.16)`.

### Radii
Pills `999px`. Buttons/inputs `10px`. Cards `16px`. Avatar tiles `11–12px`.

## Domain Model (in `data.jsx`)

### Tier pricing (€/mo per agent)
```
Haiku  €19   "Routine work · fastest, lowest cost"
Sonnet €39   "Writing, coaching, day-to-day reasoning"
Opus   €79   "Complex strategy, multi-step planning"
```

### Initial team
- **Iris** — Personal assistant, Opus, **required** (cannot be removed).
- **Atlas** — Client manager, Opus.
- **Sable** — Brand & content, Sonnet.
- **Juno** — Sales pipeline, Sonnet.
- **Vega** — Operations & finance, Sonnet.

### Agent catalog (addable)
Rook (Recruiter, Sonnet), Lyra (Customer success, Sonnet), Onyx (Legal & compliance, Opus), Pax (PR & comms, Sonnet), Mira (Data analyst, Opus), Echo (Personal scheduler, Haiku).

### Externals
ACME, Patagonia (clients) — linked to specific agents. Plus tool integrations (Slack, Gmail, Notion, etc.) shown in the tools row of the hierarchy.

## Screens

### 1. Onboarding (`Onboarding.html`)
**Purpose**: First-run. Set tone, pick a business profile, reveal the suggested AI team.

**Layout**: Centered single-column flow on aurora background.
- **Top nav**: orbital `<WisdomMark>` + "WisdomWorks" + italic *because it does.*
- **Step 1 — Industry picker**: glass cards (auto-repair shop, agency, etc.). Selecting one sets the team composition.
- **Step 2 — Team reveal** (`TeamSection` in the inline app script): the hierarchy diagram, **940×520 SVG**, identical metaphor to the Command Deck.
  - **You** (initials avatar) at top.
  - **Iris** at center, animated halo (`breathe` keyframe), violet accent ring when selected.
  - **Specialists** in a row (positions distributed across `span = W - 100`). Each has: 14px circle, status dot (top-right), label, role (mono, uppercase), tier pill (`Haiku`/`Sonnet`/`Opus` in violet).
  - **Tools row** below, dashed lines to Iris, soft pill rectangles.
  - **Live arc**: cycles through specialists every 2s — `<animateMotion>` violet dot riding a quadratic Bézier from Iris.
- **Right detail panel** (1.6fr / 1fr split): clicking any agent fills it with avatar + name + role + description + channel pills + skills (✓) + needs (⚠) + Model card (tier name in `--accent-deep` 18px + price mono 11px).
- **Footer stats row** (3 columns): Team total (€/mo sum), Coverage (24/7 · WhatsApp), Setup time (~2 minutes).

**Interactions**: click an agent (Iris or a specialist) to select it; the detail panel and the live arc both update. Industry selection cards have hover lift.

### 2. Command Deck (`Command Deck.html`)
**Purpose**: Daily ops. See the team, get briefed by Iris, approve proposals, drill into any agent.

**Layout** (≥1280px):
- **Top nav**: Wordmark (left), view tabs (center): Overview · Individual · Team · Enterprise · Activity, user avatar + status (right).
- **KPI strip**: e.g. "Decisions handled · 1,284" — `.num-xxl` weight-250.
- **Main pane** (flex): live area (Three.js globe in Overview, or the hierarchy SVG in Team) + **right sidebar 380px** with three modes:
  - **Briefing** — chat with Iris (`<Chat>`), morning summary.
  - **Approvals** — proposal stack (severity dot, agent, title, impact, confidence). Approve / Modify / Dismiss buttons.
  - **Activity** — live feed of agent events.
- **Agent roster, governance card, cross-agent discoveries** below — all `.glass` panels.

**Tweaks panel** (toolbar toggle): switch view, swap Connected/Fractured globe state, switch tenant scale (solo / 62 / 1240), toggle light glass, dial accent hue, glass blur, density, aurora intensity, collapse sidebar.

**Agent detail screen** (`agent-detail.jsx`): clicking an agent in the roster or on the hierarchy navigates to a full-screen detail. Includes:
- Header avatar + name + role + status dot.
- **Activity feed** for that agent.
- **Direct chat** wired back to global context so Iris/other agents see it.
- **Model/tier picker** — three radios (Haiku / Sonnet / Opus) with descriptions and €19 / €39 / €79 pricing. Selecting another tier fires the `<PriceDiff>` floating card showing `+€X/mo` or `−€X/mo` against current plan.

**Team management drawer** (`agent-panel.jsx`): right-side overlay listing active agents (with remove buttons; Iris is non-removable) and the catalog (with add buttons + cost). Triggered from the chat ("add a recruiter") or directly.

## Interactions & Behavior

- **Hierarchy live arc**: `setInterval(2000ms)` cycles `activeIdx`; `<animateMotion>` gives the traveling dot 1.4s loop.
- **Iris breathe**: `breathe` keyframe (2.4s ease-in-out infinite) on the halo circle's opacity/scale.
- **Chat typing indicator**: 3 dots, staggered fade.
- **Pop-in**: cards animate in with `pop-in` (subtle scale + opacity, ~240ms ease-out).
- **Globe (Overview)**: Three.js wireframe sphere + glowing entity nodes + animated arcs between agents and externals. Has Connected ↔ Fractured visual states (more vs fewer arcs, color shift).
- **Price diff card**: appears for ~3s after team composition change, then fades.
- **Tweaks**: standard host protocol — listen for `__activate_edit_mode`, post `__edit_mode_available` and `__edit_mode_set_keys`. The `tweaks-panel.jsx` wrapper handles this; in production you'd remove the panel entirely.

## State Management

For Command Deck, the minimum state needed:
```ts
team:           Agent[]                    // active team, persisted
selectedAgent:  string | null              // for agent-detail screen
view:           "overview" | "individual" | "team" | "enterprise" | "activity"
sidebar:        "briefing" | "approvals" | "activity"
chatThreads:    Record<agentId, Message[]> // including 'iris'
proposals:      Proposal[]
priceDiff:      { delta: number, ts: number } | null
tweaks:         { ...TWEAK_DEFAULS }
```
For Onboarding: `industry`, `selected` (currently selected agent in Step 2), `activeIdx` (live arc cycling).

## Assets

- **Fonts**: Geist + Geist Mono via Google Fonts. Self-host if your stack prefers.
- **Background imagery** (referenced in `data.jsx` `BG_IMAGES` for the cinematic Overview): three Unsplash photos by id — `1505144808419-1957a94ca61e`, `1464822759023-fed622ff2c3b`, plus one more. Replace with licensed art for production.
- **No raster icons** — everything is inline SVG (the orbital mark, status dots, tool pills).
- **Three.js**: loaded via CDN in Command Deck for the Overview globe.

## Notes for Implementation

- The aurora background is pure CSS — three large blurred radial gradients with slow `transform` animations. Cheap and looks great; keep it.
- The orbital `<WisdomMark>` is the brand. Three nested ellipses rotated 0/60/-60° + a center dot with breathing halo. Reuse it as Iris's avatar everywhere — it ties the brand to the personal agent.
- Italic serif tagline *because it does.* should always sit close to the wordmark, half a line below or trailing on the right.
- The hierarchy diagram appears in **both** screens (Onboarding Step 2 and Command Deck → Team view). Build it once, parameterize the data, reuse.
- Mono type carries a lot of weight visually — use it consistently for eyebrows, tier labels, pricing, role labels, and timestamps.
- Don't introduce new accent colors. Violet `#7c3aed` does everything; use opacity to step.

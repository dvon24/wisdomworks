// Mock data + agent catalog with pricing.

const TENANT = {
  name: "Lumen & Co.",
  size: "Brand & product studio · 62 people · Berlin",
  user: { first: "Maya", last: "Okafor", role: "COO", initials: "MO" },
  time: "Tuesday, 6:42 AM",
  whatsapp: "+49 30 ••• 4421",
};

// Tier pricing per agent per month (€)
const TIER_PRICE = { Haiku: 19, Sonnet: 39, Opus: 79 };
const TIER_DESC  = {
  Haiku:  "Routine work · fastest, lowest cost",
  Sonnet: "Writing, coaching, day-to-day reasoning",
  Opus:   "Critical reasoning, multi-step planning",
};

// Active team. Iris (personal) is required and not removable.
const INITIAL_TEAM = [
  { id: "iris",  label: "Iris",  role: "Personal assistant", tier: "Opus",   status: "ok",   required: true,  emoji: "✦" },
  { id: "atlas", label: "Atlas", role: "Client manager",     tier: "Opus",   status: "ok",   handled: 412 },
  { id: "vega",  label: "Vega",  role: "Operations",         tier: "Sonnet", status: "warn", handled: 287 },
  { id: "juno",  label: "Juno",  role: "Marketing",          tier: "Sonnet", status: "ok",   handled: 198 },
  { id: "sable", label: "Sable", role: "Finance",            tier: "Opus",   status: "ok",   handled: 156, savings: "47h" },
  { id: "wren",  label: "Wren",  role: "Research",           tier: "Sonnet", status: "ok",   handled: 89 },
  { id: "cedar", label: "Cedar", role: "Legal",              tier: "Opus",   status: "ok",   handled: 64 },
  { id: "orin",  label: "Orin",  role: "People",             tier: "Sonnet", status: "bad",  handled: 38 },
  { id: "mira",  label: "Mira",  role: "Design ops",         tier: "Haiku",  status: "ok",   handled: 142 },
];

// Agents available to add.
const AGENT_CATALOG = [
  { id: "rook",   label: "Rook",   role: "Recruiter",          tier: "Sonnet", desc: "Sources candidates, screens applications, schedules first-rounds." },
  { id: "lyra",   label: "Lyra",   role: "Customer success",   tier: "Sonnet", desc: "Health checks, NPS follow-ups, churn early-warnings." },
  { id: "nox",    label: "Nox",    role: "Security",           tier: "Opus",   desc: "Audit logs, anomaly detection, access reviews." },
  { id: "kit",    label: "Kit",    role: "Sales SDR",          tier: "Sonnet", desc: "Outbound sequencing, intro emails, meeting booking." },
  { id: "fern",   label: "Fern",   role: "Knowledge curator",  tier: "Haiku",  desc: "Tags docs, builds wikis, surfaces stale content." },
  { id: "halo",   label: "Halo",   role: "Brand voice",        tier: "Opus",   desc: "Reviews everything outbound for tone consistency." },
];

// External entities (clients/tools) with which agents talk to which.
const EXTERNALS = [
  { id: "acme",   label: "ACME",      kind: "client", links: ["atlas","sable"] },
  { id: "pat",    label: "Patagonia", kind: "client", links: ["atlas","juno"] },
  { id: "hin",    label: "Hinrich",   kind: "client", links: ["atlas","cedar"] },
  { id: "stripe", label: "Stripe",    kind: "tool",   links: ["sable"] },
  { id: "slack",  label: "Slack",     kind: "tool",   links: ["orin","vega"] },
  { id: "figma",  label: "Figma",     kind: "tool",   links: ["mira"] },
  { id: "wapp",   label: "WhatsApp",  kind: "tool",   links: ["iris"] },
];

const PROPOSALS = [
  { id: "p1", agent: "Vega",         sev: "high", title: "Reduce Tuesday wasted capacity by 31%",  impact: "+€7,200/mo", confidence: 0.86 },
  { id: "p2", agent: "Juno + Atlas", sev: "med",  title: "Re-warm 12 dormant accounts before Q3",  impact: "+€34k pipe", confidence: 0.74 },
  { id: "p3", agent: "Cedar",        sev: "low",  title: "Standardise contractor MSAs on v4",      impact: "Risk ↓",      confidence: 0.93 },
];

// Cinematic photography
const BG_IMAGES = [
  "https://images.unsplash.com/photo-1505144808419-1957a94ca61e?auto=format&fit=crop&w=2400&q=80",
  "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=2400&q=80",
  "https://images.unsplash.com/photo-1419242902214-272b3f66ee7a?auto=format&fit=crop&w=2400&q=80",
  "https://images.unsplash.com/photo-1472213984618-c79aaec7fef0?auto=format&fit=crop&w=2400&q=80",
];

function priceForTeam(team) {
  return team.reduce((sum, a) => sum + (TIER_PRICE[a.tier] || 0), 0);
}

Object.assign(window, { TENANT, TIER_PRICE, TIER_DESC, INITIAL_TEAM, AGENT_CATALOG, EXTERNALS, PROPOSALS, BG_IMAGES, priceForTeam });

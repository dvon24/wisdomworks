/**
 * Intent Parser — detects team-modification commands in natural language.
 *
 * Used by both the onboarding refine chat and the Command Deck sidebar chat.
 * Local parsing (no API call) for instant response to common commands.
 *
 * Returns a structured Intent that the UI converts to an action card with
 * approve/reject buttons. If no intent matches, returns null and the message
 * goes to the AI for free-form response.
 */

export type AgentTier = 'Haiku' | 'Sonnet' | 'Opus';

/** Catalog entry — agent that can be added */
export interface CatalogAgent {
  id: string;
  label: string;
  role: string;
  tier: AgentTier;
  desc: string;
}

/** Active team agent — already on the team */
export interface ActiveAgent {
  id: string;
  label: string;
  role: string;
  tier?: AgentTier;
  required?: boolean;
  /** What this agent has done — used to soften removal proposals */
  handled?: number;
  savings?: string;
}

/** Default catalog of agents that can be added on demand */
export const DEFAULT_AGENT_CATALOG: CatalogAgent[] = [
  { id: 'rook', label: 'Rook', role: 'Recruiter', tier: 'Sonnet', desc: 'Sources candidates, screens applications, schedules first-rounds.' },
  { id: 'lyra', label: 'Lyra', role: 'Customer success', tier: 'Sonnet', desc: 'Health checks, NPS follow-ups, churn early-warnings.' },
  { id: 'nox', label: 'Nox', role: 'Security', tier: 'Opus', desc: 'Audit logs, anomaly detection, access reviews.' },
  { id: 'kit', label: 'Kit', role: 'Sales SDR', tier: 'Sonnet', desc: 'Outbound sequencing, intro emails, meeting booking.' },
  { id: 'fern', label: 'Fern', role: 'Knowledge curator', tier: 'Haiku', desc: 'Tags docs, builds wikis, surfaces stale content.' },
  { id: 'halo', label: 'Halo', role: 'Brand voice', tier: 'Opus', desc: 'Reviews everything outbound for tone consistency.' },
  { id: 'pax', label: 'Pax', role: 'PR & comms', tier: 'Sonnet', desc: 'Press outreach, crisis comms, executive announcements.' },
  { id: 'mira', label: 'Mira', role: 'Data analyst', tier: 'Opus', desc: 'Dashboards, reports, anomaly detection across data sources.' },
  { id: 'echo', label: 'Echo', role: 'Personal scheduler', tier: 'Haiku', desc: 'Inbox sweep, calendar deconfliction, daily prep.' },
];

export const TIER_PRICE = { Haiku: 19, Sonnet: 39, Opus: 79 } as const;
export const TIER_DESC = {
  Haiku: 'Cheaper, faster, less depth',
  Sonnet: 'Solid middle ground',
  Opus: 'Smarter — better for hard calls',
} as const;

// ─── Intent Types ───

export type Intent =
  | { kind: 'add'; agent: CatalogAgent; count?: number; targetParentId?: string }
  | { kind: 'remove'; agent: ActiveAgent }
  | { kind: 'tier'; agent: ActiveAgent; fromTier: AgentTier; toTier: AgentTier }
  | { kind: 'rename'; agent: ActiveAgent; newName: string }
  | { kind: 'question' }
  | null;

// ─── Parser ───

/**
 * Parse a free-text user message into an intent.
 * Returns null if no command is detected.
 */
export function parseIntent(
  text: string,
  team: ActiveAgent[],
  catalog: CatalogAgent[] = DEFAULT_AGENT_CATALOG,
): Intent {
  const t = text.toLowerCase().trim();
  if (!t) return null;

  // ─── ADD ───
  if (/\b(add|hire|bring on|i need|get me|deploy|create)\b/.test(t)) {
    // Detect a count: "add 5 agents", "add 3 recruiters"
    const countMatch = t.match(/\b(\d+)\s+(?:agents?|specialists?|people|reps?|managers?)\b/);
    const count = countMatch ? parseInt(countMatch[1]!, 10) : undefined;

    // Detect a target department: "to the patient experience team", "under atlas"
    const targetMatch = t.match(/(?:to|under|in|for)\s+(?:the\s+)?([a-z\s]+?)(?:\s+(?:team|department|coordinator|manager))?$/);
    let targetParentId: string | undefined;
    if (targetMatch) {
      const targetName = targetMatch[1]!.trim();
      const parent = team.find(
        (a) => a.label.toLowerCase().includes(targetName) || a.role.toLowerCase().includes(targetName),
      );
      if (parent) targetParentId = parent.id;
    }

    // Find a matching catalog agent — try role keyword first
    for (const c of catalog) {
      if (team.find((x) => x.id === c.id)) continue; // already on team
      const keys = [c.label.toLowerCase(), c.role.toLowerCase(), ...c.role.toLowerCase().split(' ')];
      if (keys.some((k) => k && t.includes(k))) {
        return { kind: 'add', agent: c, count, targetParentId };
      }
    }

    // Fallback: first available catalog agent (used when count is specified but role isn't)
    if (count || targetParentId) {
      const first = catalog.find((c) => !team.find((x) => x.id === c.id));
      if (first) return { kind: 'add', agent: first, count, targetParentId };
    }
  }

  // ─── RENAME ───
  // Patterns: "rename atlas to maya", "call sage maya", "change atlas's name to maya", "name atlas maya"
  const renameMatch =
    text.match(/\b(?:rename|call|change\s+(?:the\s+name\s+of\s+)?|change)\s+([a-zA-Z0-9_\-\s]+?)(?:'s\s+name)?\s+(?:to|as)\s+([a-zA-Z0-9_\-]+)/i) ||
    text.match(/\bname\s+([a-zA-Z0-9_\-\s]+?)\s+([a-zA-Z0-9_\-]+)\s*$/i);
  if (renameMatch) {
    const oldName = renameMatch[1]!.trim().toLowerCase();
    const newName = renameMatch[2]!.trim();
    // Match the agent in the team
    const target = team.find(
      (a) =>
        a.label.toLowerCase() === oldName ||
        a.label.toLowerCase().includes(oldName) ||
        oldName.includes(a.label.toLowerCase()),
    );
    if (target && newName.length >= 2 && newName.length <= 30) {
      // Capitalize first letter
      const formatted = newName[0]!.toUpperCase() + newName.slice(1);
      return { kind: 'rename', agent: target, newName: formatted };
    }
  }

  // ─── REMOVE ───
  if (/\b(remove|delete|drop|fire|let go|don't need|get rid of)\b/.test(t)) {
    for (const a of team) {
      if (a.required) continue;
      if (t.includes(a.label.toLowerCase()) || t.includes(a.role.toLowerCase())) {
        return { kind: 'remove', agent: a };
      }
    }
  }

  // ─── TIER CHANGE ───
  const tierMatch = t.match(/\b(haiku|sonnet|opus)\b/);
  if (tierMatch && /\b(move|switch|change|upgrade|downgrade|use)\b/.test(t)) {
    const toTier = (tierMatch[1]![0]!.toUpperCase() + tierMatch[1]!.slice(1)) as AgentTier;
    for (const a of team) {
      if (a.required) continue;
      if (t.includes(a.label.toLowerCase()) || t.includes(a.role.toLowerCase())) {
        if (a.tier === toTier) return null;
        return { kind: 'tier', agent: a, fromTier: a.tier ?? 'Sonnet', toTier };
      }
    }
  }

  // ─── QUESTION ───
  if (/^(what|why|how|who|when|where|does|is|can|tell me|explain|show me)/.test(t) || t.endsWith('?')) {
    return { kind: 'question' };
  }

  return null;
}

// ─── Iris Reply Generators ───

/**
 * Generate Iris's reply text for a given intent.
 * For known commands, returns a deterministic reply. For questions/unknown, returns null.
 */
export function generateIntentReply(intent: Intent): string | null {
  if (!intent || intent.kind === 'question') return null;

  if (intent.kind === 'add') {
    const a = intent.agent;
    const count = intent.count && intent.count > 1 ? ` (${intent.count} of them)` : '';
    return `Got it — adding ${a.label}${count} (${a.role}). ${a.desc}`;
  }

  if (intent.kind === 'remove') {
    const a = intent.agent;
    const note = a.savings
      ? `${a.label} saved you ${a.savings} this month — are you sure?`
      : `${a.label} handled ${a.handled ?? 0} decisions recently.`;
    return `Heads up — ${note} Confirm and I'll pause them.`;
  }

  if (intent.kind === 'tier') {
    const tierBlurb = TIER_DESC[intent.toTier];
    return `${tierBlurb}. Switch ${intent.agent.label} from ${intent.fromTier} to ${intent.toTier}?`;
  }

  if (intent.kind === 'rename') {
    return `Renaming ${intent.agent.label} to ${intent.newName}. They'll keep all their context and history.`;
  }

  return null;
}

// ─── Helpers ───

/** Calculate the price delta (in dollars/euros per month) for an intent */
export function intentPriceDelta(intent: Intent): number {
  if (!intent) return 0;
  if (intent.kind === 'add') {
    const count = intent.count ?? 1;
    return TIER_PRICE[intent.agent.tier] * count;
  }
  if (intent.kind === 'remove') {
    return -TIER_PRICE[intent.agent.tier ?? 'Sonnet'];
  }
  if (intent.kind === 'tier') {
    return TIER_PRICE[intent.toTier] - TIER_PRICE[intent.fromTier];
  }
  return 0;
}

/** Format the price delta for display: "+€39/mo" or "−€20/mo" */
export function formatPriceDelta(delta: number, currencySymbol: string = '$'): string {
  if (delta === 0) return '';
  const sign = delta > 0 ? '+' : '−';
  return `${sign}${currencySymbol}${Math.abs(delta)}/mo`;
}

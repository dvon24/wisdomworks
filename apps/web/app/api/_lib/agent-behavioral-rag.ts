/**
 * Per-agent recent-context loader — the Layer-1 piece of "agents are
 * proactively aware of you, not just responsive to you."
 *
 * Uses the behavioral RAG (chat_runs, atoms, sent+received emails,
 * insights) shipped in Story 2.9 Phase 2. For each agent we query
 * with the agent's role + description as the semantic seed, so each
 * agent receives a TARGETED slice of recent owner activity — not a
 * one-size-fits-all global block.
 *
 *   Marcus (Financial) → recent finance-tagged atoms + insights +
 *                        emails mentioning money/invoices
 *   Riley (Scheduling) → recent calendar discussions, client emails,
 *                        scheduling atoms
 *   Iris (Personal)    → broad cross-section, lowest similarity floor
 *
 * Result is a stable, prompt-cacheable block (rotates ~hourly with
 * the cron) injected into every agent tick's system prompt AND
 * available to the dispatch_to_agents tool for fan-out briefing.
 *
 * Token budget: ~500-800 tokens per agent. Net cost at typical
 * tenant volume: a few $ per month total. See conversation
 * 2026-05-18 for the cost math.
 */

import { queryKnowledge } from './knowledge-base';

export interface AgentContextRequest {
  tenantPhone: string;
  agentName: string;
  agentRole: string;
  /** Optional richer prose describing what the agent focuses on —
   *  used as part of the semantic query seed when present. */
  agentDescription?: string;
  /** Higher = more chunks. Default 10. */
  limit?: number;
  /** Below this similarity, chunks are dropped as noise. Default 0.3. */
  minSimilarity?: number;
  /** Restrict to specific behavioral sources. Defaults to ALL behavioral
   *  kinds (atom, conversation, email, insight, document, visit). */
  sourceKinds?: Array<'atom' | 'conversation' | 'email' | 'insight' | 'document' | 'visit'>;
}

export interface AgentContextBlock {
  /** Formatted block ready to drop into a system prompt. Empty string
   *  when nothing relevant was found — caller should treat absence as
   *  "no signal," not "missing data." */
  text: string;
  /** Top-N matches that contributed to the block (id + kind + snippet
   *  + similarity). Useful for audit logging and for the dispatch tool
   *  when it surfaces "Iris briefed Marcus with these recent items." */
  matches: Array<{
    sourceKind: string;
    sourceName: string;
    similarity: number;
    preview: string;
  }>;
  /** Tokens spent on the embed call. Cheap (~10-30 per query) but
   *  worth aggregating in usage tracking. */
  embedTokens: number;
}

/**
 * Build the semantic query seed from an agent's identity. We blend
 * name + role + description so the embedding captures what the agent
 * is FOR. Concrete examples make for better retrieval than abstract
 * role labels alone.
 */
function buildQuerySeed(req: AgentContextRequest): string {
  const parts: string[] = [
    `Recent owner activity relevant to ${req.agentName}, ${req.agentRole}.`,
  ];
  if (req.agentDescription) {
    parts.push(`Focus area: ${req.agentDescription}.`);
  }
  // Role-derived hints to broaden the semantic net — the role string
  // alone is often too narrow ("Financial Advisor" misses "expenses")
  // so we append related concepts based on common patterns.
  const role = req.agentRole.toLowerCase();
  if (/financ|account|bookkeep|treasur|cfo/.test(role)) {
    parts.push('Topics: invoices, expenses, payments, revenue, taxes, budget, payroll.');
  } else if (/market|brand|content|seo|social/.test(role)) {
    parts.push('Topics: campaigns, posts, engagement, brand voice, audience, growth.');
  } else if (/schedul|book|appoint|operat/.test(role)) {
    parts.push('Topics: appointments, calendar, availability, no-shows, bookings.');
  } else if (/sales|business develop|partnership|outreach/.test(role)) {
    parts.push('Topics: leads, prospects, pipeline, deals, partnerships.');
  } else if (/customer|client|support|service/.test(role)) {
    parts.push('Topics: client requests, complaints, follow-ups, retention.');
  } else if (/legal|compliance|risk/.test(role)) {
    parts.push('Topics: contracts, agreements, deadlines, regulatory, disclosures.');
  } else if (/analyt|data|metric|insight/.test(role)) {
    parts.push('Topics: trends, performance, conversions, traffic, key metrics.');
  } else if (/web|develop|engineer|code/.test(role)) {
    parts.push('Topics: bugs, features, deployments, site changes, audits.');
  } else if (/coach|fitness|train|health|wellness|nutrition/.test(role)) {
    parts.push('Topics: workouts, training split, exercises, injuries, recovery, diet, sleep, races.');
  }
  return parts.join(' ');
}

/**
 * Load a per-agent recent-context block. Safe to call in hot tick paths —
 * never throws, always returns a block (possibly empty).
 */
export async function loadRecentContextForAgent(
  req: AgentContextRequest,
): Promise<AgentContextBlock> {
  const empty: AgentContextBlock = { text: '', matches: [], embedTokens: 0 };
  try {
    const seed = buildQuerySeed(req);
    const sourceKinds = req.sourceKinds ?? ['atom', 'conversation', 'email', 'insight', 'document', 'visit'];
    const result = await queryKnowledge(req.tenantPhone, seed, {
      limit: req.limit ?? 10,
      minSimilarity: req.minSimilarity ?? 0.3,
      sourceKinds,
      // Don't pollute the activity feed with internal tick-time queries —
      // each agent ticking would otherwise create dozens of audit rows.
      audit: false,
      source: `agent_context:${req.agentName}`,
    });
    if (result.matches.length === 0) return empty;

    const lines: string[] = [];
    const matchSummary: AgentContextBlock['matches'] = [];
    for (const m of result.matches) {
      const kind = ((m as any).source_kind ?? m.source_entity_type) as string;
      const name = m.source_entity_name || '(unnamed)';
      const snippet = m.content.length > 180 ? m.content.slice(0, 180) + '…' : m.content;
      lines.push(`- [${kind}] ${name}: ${snippet}`);
      matchSummary.push({
        sourceKind: kind,
        sourceName: name,
        similarity: m.similarity,
        preview: snippet,
      });
    }

    const text = [
      `RECENT OWNER CONTEXT RELEVANT TO YOUR ROLE (${req.agentName} — ${req.agentRole}):`,
      `Top ${result.matches.length} items from the owner's recent activity that match your domain.`,
      'Use these as background when making decisions — they reflect what the owner has been doing, saying, and being asked about. If something is materially relevant, reference it explicitly; if nothing here applies, ignore it and proceed normally.',
      '',
      ...lines,
    ].join('\n');

    return { text, matches: matchSummary, embedTokens: result.embedTokens };
  } catch (err) {
    console.warn('[agent-behavioral-rag] loadRecentContextForAgent failed:', err);
    return empty;
  }
}

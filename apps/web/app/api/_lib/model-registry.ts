/**
 * Single source of truth for Claude model IDs + tier mapping.
 *
 * Model strings were inline-literal across 20+ files, which is how deprecated
 * 2025-05-14 IDs (claude-opus-4-20250514 / claude-sonnet-4-20250514) drifted
 * into agent_configs at onboarding and kept getting read verbatim on every
 * 5-minute agent tick — the confirmed root of the Opus-4 cache-write cost line
 * AND the silent tool-call failures (newer agents fell through to Haiku, which
 * can't tool-call). Resolve through here instead of hardcoding IDs.
 */

export type Tier = 'Opus' | 'Sonnet' | 'Haiku';

/** Current canonical model IDs. */
export const MODELS = {
  opus: 'claude-opus-4-8',
  sonnet: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5-20251001',
} as const;

/** Tier name (case-insensitive) → current model ID. */
export const TIER_TO_MODEL: Record<string, string> = {
  opus: MODELS.opus,
  sonnet: MODELS.sonnet,
  haiku: MODELS.haiku,
};

/** Deprecated / superseded IDs → current same-tier equivalent. */
const ID_UPGRADES: Record<string, string> = {
  'claude-opus-4-20250514': MODELS.opus,
  'claude-opus-4-7': MODELS.opus,
  'claude-opus-4-7-20260420': MODELS.opus,
  'claude-sonnet-4-20250514': MODELS.sonnet,
  'claude-sonnet-4-5-20250929': MODELS.sonnet,
};

/** Haiku 4.5 does NOT support tool calling — a tool-using call on Haiku fails,
 *  so the agent tick loop (which always passes tools) must never resolve to it. */
export function supportsToolCalling(modelId: string): boolean {
  return !/haiku/i.test(modelId);
}

/** Upgrade a stored model ID to its current equivalent (no-op if already current). */
export function upgradeModelId(modelId: string): string {
  return ID_UPGRADES[modelId] ?? modelId;
}

/**
 * Resolve an agent's tick model from its (possibly malformed) model_routing.
 * Handles BOTH shapes that exist in the live DB:
 *   - object: { primary: { model: 'claude-...' } }  (onboarding-era — may be a deprecated ID)
 *   - string: { primary: 'Sonnet' }                 (admin / add_agent_to_team / provision_axis)
 * Defaults to Sonnet 4.6 (NOT Haiku) — ticks run a tool-calling loop Haiku can't serve.
 */
export function resolveAgentModel(modelRouting: any): string {
  const primary = modelRouting?.primary;
  let resolved: string | null = null;
  if (primary && typeof primary === 'object' && typeof primary.model === 'string' && primary.model) {
    resolved = upgradeModelId(primary.model);
  } else if (typeof primary === 'string' && primary.trim()) {
    resolved = TIER_TO_MODEL[primary.trim().toLowerCase()] ?? null;
  }
  return resolved ?? MODELS.sonnet;
}

/** Tier label for display, from a stored model_routing (handles both shapes). */
export function tierFromModelRouting(modelRouting: any): Tier {
  const id = resolveAgentModel(modelRouting);
  if (/opus/i.test(id)) return 'Opus';
  if (/haiku/i.test(id)) return 'Haiku';
  return 'Sonnet';
}

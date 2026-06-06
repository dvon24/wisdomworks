/**
 * Deterministic anti-fabrication guard for owner-facing agent replies.
 *
 * Ground-truth gated: keyed on whether a tool actually fired this turn, NOT on
 * the model's prose or a prompt instruction — which the model can and does
 * override. The 2026-06-06 spend-cap incident proved this: when the owner blew
 * past the daily spend cap, delegate_to_agent was spliced out of Iris's tool
 * list and the lean-mode prompt note explicitly told her not to delegate — yet
 * she narrated "passing them to Coach now" / "*delegating to Coach…*" anyway,
 * generating a flood of claims_persistence_without_tool findings.
 *
 * When the reply CLAIMS a handoff/delegation but delegate_to_agent did not fire,
 * we strip the offending sentence(s) and append one honest line — with NO extra
 * model call, which is essential: the tenant may be over the spend cap, so we
 * must not spend another Anthropic call to repair a cost-driven failure.
 *
 * INVARIANT: cost/availability controls may reduce capability; they must NEVER
 * let an agent claim an action it did not take.
 */

/**
 * Phrasings that assert a delegation/handoff happened or is happening. High
 * precision: progressive/past/imperative-completion forms ("delegating",
 * "I've delegated", "delegate … now") and handoff verbs aimed at a named agent
 * or the team — NOT modal proposals ("I can delegate this — want me to?").
 * Must be NON-global (called repeatedly via .test).
 */
export const DELEGATION_CLAIM_PATTERNS: RegExp[] = [
  /<\s*\/?\s*delegat/i, // "<delegating to Coach>"
  /\*+\s*delegat\w*/i, // "*delegating to Coach…*"
  /\bdelegat(?:ing|ed)\b/i, // "Delegating to Coach now", "I've delegated"
  /\bdelegat(?:e|es)\b[^.?!\n]{0,30}\bnow\b/i, // "delegate this now"
  /\b(?:passing|hand(?:ing|ed)?|sending|routing|forwarding)\b[^.?!\n]{0,40}\b(?:to|over to)\b[^.?!\n]{0,20}\b(?:coach|marcus|mira|alex|riley|the team|[A-Z][a-z]+)\b/i,
  /\blooping\b[^.?!\n]{0,25}\bin\b/i, // "looping Coach in"
  /\bI'?ll\s+(?:loop|pass|hand|send|route|forward|bring)\b[^.?!\n]{0,35}\b(?:in|to|over)\b/i, // "I'll loop Coach in", "I'll pass that to Coach"
  /\b(?:noted|logged|flagged|captured)\b[^.?!\n]{0,25}\bfor\s+(?:coach|marcus|mira|alex|riley|[A-Z][a-z]+)\b/i, // "noted for Coach"
];

/**
 * Drop whole sentences/lines that match any pattern; return the cleaned text +
 * what was removed (for logging / gate_fired instrumentation). Splits on
 * sentence terminators and newlines so a single fabricated clause takes its
 * whole sentence with it rather than leaving a fragment.
 */
export function stripClaimSentences(
  text: string,
  patterns: RegExp[],
): { cleaned: string; removed: string[] } {
  const removed: string[] = [];
  const kept = text.split(/(?<=[.!?])\s+|\n+/).filter((part) => {
    const hit = patterns.some((pat) => pat.test(part));
    if (hit && part.trim()) removed.push(part.trim().slice(0, 120));
    return !hit;
  });
  const cleaned = kept
    .join(' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { cleaned, removed };
}

/**
 * Guard a reply against fabricated delegation. No-op when delegate_to_agent
 * fired this turn (the claim is true) or when no delegation claim is present.
 * Otherwise strips the fabricated sentence(s) and appends one honest,
 * cap-aware line so the owner is told the truth about what did/didn't happen.
 */
export function guardDelegationClaim(args: {
  message: string;
  delegatedThisTurn: boolean;
  capped: boolean;
}): { message: string; removed: string[] } {
  if (args.delegatedThisTurn) return { message: args.message, removed: [] };
  const { cleaned, removed } = stripClaimSentences(args.message, DELEGATION_CLAIM_PATTERNS);
  if (removed.length === 0) return { message: args.message, removed: [] };
  const honest = args.capped
    ? "(Heads up — I've hit today's usage limit, so I haven't actually sent this to the team yet. It'll go through once the limit resets at midnight UTC, or you can raise the cap.)"
    : "(Heads up — I haven't actually handed this to the team yet. Want me to?)";
  return {
    message: cleaned.length > 0 ? `${cleaned}\n\n${honest}` : honest,
    removed,
  };
}

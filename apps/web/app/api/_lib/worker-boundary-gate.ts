/**
 * Worker boundary gate — runs on every delegated worker's output before
 * the text returns to Iris as a tool result.
 *
 * Why this exists: Iris's architecture treats tool results as ground
 * truth. An ungated Sonnet/Haiku worker (Coach, Marcus, Mira) can
 * fabricate just like Iris can — claim completed work without a
 * persisting tool, invent system capabilities, describe modes that
 * don't exist. Without a gate at the worker boundary, every worker
 * fabrication gets laundered into Iris's context as "verified tool
 * output," and Iris faithfully reports it to the owner.
 *
 * Spec from external review 2026-05-28 (the "fabrication laundering"
 * thread):
 *   - STRUCTURAL TOOL-LOG CHECK IS PRIMARY (we own the worker's tool
 *     log; this is enforceable, not best-effort).
 *   - REGEX IS PRE-FILTER (cheap; decides whether to even bother with
 *     the structural check on this output).
 *   - WORKER VOCABULARY DIFFERS FROM IRIS'S (Iris-tuned fabrication
 *     patterns will pass through worker fabrications — Coach says
 *     "I've scheduled" / "added to your plan", not "going forward").
 *   - CAPABILITY-INVENTION IS A SECOND FAILURE MODE the regex won't
 *     cover ("Critical-only mode" / "auto-progression mode" inventing
 *     features that don't exist).
 *   - STORE RAW IN agent_runs FOR DEBUGGING, RETURN GATED TO IRIS.
 *     The conversation record gets the gated version; the audit
 *     ledger keeps the truth.
 *   - DO NOT FIRE A MODEL CRITIC ON EVERY WORKER CALL — regex +
 *     structural check are deterministic and near-free; escalate
 *     to a Haiku audit only on ambiguous hits.
 *
 * This file is pure logic — no DB writes, no Anthropic calls. The
 * caller (delegate_to_agent handler) is responsible for persisting
 * to agent_runs and threading the gated text back to Iris.
 */

/** Persisting tools — calling one of these makes a "going forward"/
 *  state-change claim structurally true. Lifted from iris-brain's
 *  PERSISTING_TOOLS. */
const PERSISTING_TOOLS = new Set([
  'create_workflow',
  'approve_workflow',
  'set_sender_rules',
  'enable_mcp_server',
  'set_canonical_role',
  'remember_this',
  'add_agent_to_team',
  'update_agent',
  'move_agent_under_manager',
  'set_marketing_autonomy',
  'connect_automation_webhook',
  'add_tool_to_agent',
]);

/** Side-effect tools — calling one makes a past-tense "I did X this
 *  turn" claim grounded. */
const SIDE_EFFECT_TOOLS = new Set([
  'send_email',
  'create_calendar_event',
  'book_appointment',
  'admin_dedupe_agents',
  'admin_restore_agent',
  'publish_instagram_post',
  'publish_instagram_reel',
  'publish_facebook_post',
  'reply_to_instagram_comment',
  'approve_marketing_draft',
  'qbo_create_invoice',
  'create_payment_link',
  'schedule_event',
  'cancel_event',
]);

const GROUNDING_TOOLS = new Set([...PERSISTING_TOOLS, ...SIDE_EFFECT_TOOLS]);

/**
 * Per-CATEGORY grounding — a completion claim of a given KIND is only
 * supported if a tool of that kind fired. Prevents one real action from
 * whitelisting an unrelated fabrication: a worker that genuinely called
 * create_calendar_event shouldn't get a free pass on "and I emailed it to
 * your accountant" when no send tool ran. Patterns are claim-shaped (object
 * required), so domain prose ("sent your heart rate up") doesn't match.
 */
const CLAIM_CATEGORIES: Array<{ test: RegExp; tools: string[] }> = [
  { test: /\b(sent|emailed|e-?mailed|replied to)\b.{0,30}\b(it|that|the email|your email|them|the message)\b/i, tools: ['send_email', 'reply_to_instagram_comment'] },
  { test: /\b(scheduled|booked|added).{0,30}\b(appointment|calendar|meeting|event|time block|standing block)\b/i, tools: ['create_calendar_event', 'schedule_event', 'book_appointment', 'cancel_event'] },
  { test: /\b(saved|remembered|stored|noted).{0,30}\b(preference|note|fact|this for you|that for you)\b/i, tools: ['remember_this'] },
  { test: /\b(invoiced|charged|created (an? )?invoice|sent (an? )?invoice|payment link)\b/i, tools: ['qbo_create_invoice', 'create_payment_link'] },
  { test: /\b(posted|published)\b.{0,30}\b(reel|post|instagram|facebook|story)\b/i, tools: ['publish_instagram_post', 'publish_instagram_reel', 'publish_facebook_post', 'approve_marketing_draft'] },
];

/**
 * Pre-filter regex — does the worker output contain ANY completion /
 * persistence-shaped language at all? Worker-domain-aware (broader
 * than Iris's tuned patterns).
 *
 * If this is false, skip the structural check entirely — there's
 * nothing to gate. If true, run the tool-log verification.
 */
const COMPLETION_LANGUAGE = new RegExp(
  [
    // Iris-shaped (kept for coverage)
    /\bgoing forward\b/.source,
    /\bfrom now on\b/.source,
    /\bstarting (tomorrow|today)\b/.source,
    /\blocked in\b/.source,
    /\bbaked into\b/.source,
    // FIRST-PERSON completion claims (any verb) — "I've scheduled", "I have set".
    // The fabrication shape is the worker asserting IT did something. This is
    // intentionally first-person/perfective: a bare imperative cue like "Set the
    // incline to 30" or "Add 10 lbs" is an INSTRUCTION to the owner, not a
    // completion claim, and must NOT be stripped (it's the actual artifact —
    // 2026-06-10 review: workouts were being mangled here).
    /\bi(?:['’ ]?ve| have)\s+(scheduled|added|created|set|updated|filed|booked|sent|posted|published|saved|locked|registered|configured|installed|enabled|disabled)\b/.source,
    // BARE-verb completions — ONLY verbs that never appear as exercise/instruction
    // cues, so "set/added/updated" (common in domain content) are excluded here
    // and only caught via the first-person/passive forms.
    /\b(scheduled|booked|sent|posted|published|filed|registered|invoiced) (it|that|the|your|you)\b/.source,
    // PASSIVE / PERFECTIVE state assertions — "has been scheduled", "is now set".
    /\b(has|have|had) been (scheduled|added|created|set|booked|sent|posted|published|saved|registered|configured|enabled|disabled)\b/.source,
    /\byour [a-z]{2,30} (is|are) now (set|scheduled|added|active|live|ready|locked|configured|enabled|booked)\b/.source,
    /\b(added|put) (it|that|this) (to|on|in) your\b/.source,
    // Possessive-with-completion phrasings
    /\b(workout|plan|schedule|calendar|brief|note|reminder) (is now|has been|was) (set|added|scheduled|created|locked|saved|updated)\b/.source,
    // Strong standalone fabrication markers ONLY. "✓"/"done"/"completed" are
    // deliberately NOT here — they collide with workout checklists ("✓ Warm-up",
    // "Done: 3 sets") and the verb patterns above already catch real claims.
    /(^|\n)\s*(locked\s+in|all set)\b/i.source,
  ].join('|'),
  'i',
);

/**
 * Capability-invention pre-filter — worker is naming a system
 * mode/setting/feature/integration. Workers should produce *work
 * product* (the actual workout, the actual P&L summary), not
 * describe platform capabilities. If this fires, flag for review.
 *
 * Examples this catches:
 *   - "I'll set you to auto-progression mode"
 *   - "switching to critical-only mode"
 *   - "your light-mode preset"
 *   - "in your training-progression settings"
 *
 * False-positive avoidance: deliberately narrow. We want capability-
 * description language, not domain words. "Recovery mode" in workout
 * context is domain, not platform-capability.
 */
const CAPABILITY_INVENTION = new RegExp(
  [
    // "X mode" claims
    /\b(switch(ing)?|enable|enabled|disable|disabled|set|put|toggle|configure) (you|your|me|it|this|that) (to|into|in|on) [a-z-]{4,30} mode\b/.source,
    /\b[a-z-]{4,30} mode (is|will|has been) (set|enabled|active|on|engaged|locked)\b/.source,
    // "your X settings/preset/profile"
    /\byour ([a-z-]{2,20}-){1,3}(settings|preset|profile|preferences|configuration|mode|tier)\b/.source,
    // "the X feature" / "via the X integration"
    /\b(the|a|an|via) [a-z-]{4,30} (feature|integration|connector|adapter|plugin|webhook|automation)\b/.source,
  ].join('|'),
  'i',
);

export interface WorkerOutput {
  /** The worker's raw text response after its tool loop ended. */
  text: string;
  /** Names of tools the worker called THIS run, in order. */
  toolsUsed: string[];
}

export interface BoundaryGateResult {
  /** Text that's safe to return to Iris. May equal text if no flags. */
  gated_text: string;
  /** Raw worker text, for agent_runs.metadata + debugging. NEVER
   *  returned to Iris's conversation context. */
  raw_text: string;
  /** Sentences stripped due to unsupported completion claims. */
  stripped_sentences: string[];
  /** True if capability-invention language was detected. */
  capability_invention_flagged: boolean;
  /** Quick summary for logging — "ok" | "stripped:N" | "flagged" | "both" */
  verdict: 'ok' | 'stripped' | 'flagged' | 'both';
}

/**
 * Run the worker boundary gate.
 *
 * 1. PRE-FILTER: does the text contain completion language? If no, skip
 *    structural check.
 * 2. STRUCTURAL CHECK: if completion language present, did the worker
 *    actually call a grounding tool (persisting OR side-effect)? If
 *    not, the claim is unsupported.
 * 3. STRIP: remove sentences containing unsupported completion claims.
 *    Conservative — only strip sentences that BOTH (a) match the
 *    completion regex AND (b) appear in a worker that fired no
 *    grounding tools.
 * 4. CAPABILITY-INVENTION FLAG: separately scan for platform-
 *    capability description. Doesn't strip (often legitimate
 *    domain mention); flags for caller review + axis_critiques log.
 */
export function workerBoundaryGate(output: WorkerOutput): BoundaryGateResult {
  const raw_text = output.text;
  const firedTools = new Set(output.toolsUsed);
  const firedGroundingTool = output.toolsUsed.some((t) => GROUNDING_TOOLS.has(t));

  let gated_text = raw_text;
  const stripped_sentences: string[] = [];

  // A sentence is an UNSUPPORTED completion claim when:
  //  (a) it makes a CATEGORY-specific claim (emailed/scheduled/invoiced/…) and
  //      no tool of that category fired — even if some OTHER grounding tool did
  //      (so one real action can't whitelist an unrelated fabrication); OR
  //  (b) it's a generic persistence claim ("going forward", "locked in") and
  //      NO grounding tool fired at all.
  const isUnsupportedClaim = (s: string): boolean => {
    for (const cat of CLAIM_CATEGORIES) {
      if (cat.test.test(s)) return !cat.tools.some((t) => firedTools.has(t));
    }
    return !firedGroundingTool && COMPLETION_LANGUAGE.test(s);
  };

  // Pre-filter: only walk sentences if there's any claim-shaped language at all.
  const hasCategoryClaim = CLAIM_CATEGORIES.some((c) => c.test.test(raw_text));
  if ((!firedGroundingTool && COMPLETION_LANGUAGE.test(raw_text)) || hasCategoryClaim) {
    // Split into sentences. Conservative regex — splits on . ! ? and
    // newline boundaries; preserves bullets and short fragments.
    const sentences = raw_text
      .split(/(?<=[.!?])\s+|\n+/)
      .filter((s) => s.trim().length > 0);

    const keptSentences: string[] = [];
    for (const s of sentences) {
      if (isUnsupportedClaim(s)) {
        stripped_sentences.push(s.trim());
      } else {
        keptSentences.push(s);
      }
    }

    // Only rebuild the text if we actually removed something — otherwise leave
    // raw_text byte-for-byte so a clean output isn't reflowed (whitespace,
    // tables) by the sentence split/join.
    if (stripped_sentences.length > 0) {
      // Join with newlines (preserves readable structure even when
      // some sentences were removed).
      gated_text = keptSentences.join('\n').trim();
      // Edge case: every sentence was a fabrication. Replace the whole
      // output with an honest framing rather than returning empty text.
      if (gated_text.length < 20) {
        gated_text = `[Worker output was entirely unsupported completion claims with no grounding tool calls; suppressed by the boundary gate. Owner should re-prompt.]`;
      }
    }
  }

  // Step 4: capability-invention flag (does NOT strip; this is a
  // signal for the caller to surface or log).
  const capability_invention_flagged = CAPABILITY_INVENTION.test(gated_text);

  // Verdict roll-up for cheap logging.
  let verdict: BoundaryGateResult['verdict'];
  if (stripped_sentences.length > 0 && capability_invention_flagged) verdict = 'both';
  else if (stripped_sentences.length > 0) verdict = 'stripped';
  else if (capability_invention_flagged) verdict = 'flagged';
  else verdict = 'ok';

  return { gated_text, raw_text, stripped_sentences, capability_invention_flagged, verdict };
}

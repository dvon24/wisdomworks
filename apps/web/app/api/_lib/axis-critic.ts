/**
 * Axis runtime critic — Generator-Critic loop.
 *
 * Axis is WisdomWorks's runtime auditor agent. His ORIGINAL job (audit
 * team composition + health) is built (audit_team / provision_axis tools)
 * but the loop never ran. His EXPANDED job, shipped 2026-05-26: audit
 * response quality across every owner-facing LLM surface BEFORE delivery.
 *
 * This is the Anthropic Constitutional AI pattern applied to our
 * surfaces. A separate Haiku 4.5 call reads a draft response + context
 * + a per-surface rule sheet, returns structured JSON identifying any
 * rule violations. iris-brain (and eventually every owner-facing LLM
 * surface) calls critiqueResponse() before shipping. If the critic
 * flags HIGH-severity violations, ONE revision pass is forced using
 * the critique as feedback.
 *
 * Replaces the regex-gate primary defense with bounded language
 * understanding. The regex gates stay as cheap fast pre-filters that
 * run before the critic — they catch the obvious shapes, the critic
 * catches everything else.
 *
 * Failure modes this is designed to catch (from Devon's 2026-05-26
 * transcript triage):
 *   - Au7o Traffic recital — opening every reply with the same stale
 *     tool-failure section regardless of owner's question
 *   - Anthropic charges repeated 5+ times across turns
 *   - "✓ Saved" fabrication with no remember_this tool call
 *   - Owner asks two questions, Iris answers neither (toastmasters,
 *     workout question both buried)
 *
 * Cost shape: Haiku 4.5 critique on a typical Iris reply is
 * ~$0.001–0.003 + 1-2s latency. Skipped on short replies and
 * fabrication-guard retries to avoid double-criticing.
 */

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export type CriticSurface = 'iris-chat' | 'agent-tick' | 'email-sift' | 'daily-briefing' | 'marketing-draft';

export type Severity = 'high' | 'medium' | 'low';

export interface CritiqueViolation {
  rule: string;
  severity: Severity;
  evidence: string;
  fix: string;
}

export interface CritiqueResult {
  passes: boolean;
  violations: CritiqueViolation[];
  /** Token + cost telemetry — populated for logging. */
  tokens_in: number;
  tokens_out: number;
  /** Set when the critic call itself failed (network, parse, etc.). When
   *  this is non-null, callers should ship the original draft and log
   *  the error — never block delivery on a critic failure. */
  critic_error?: string;
}

export interface CritiqueInput {
  surface: CriticSurface;
  /** The owner's most recent message (or for non-chat surfaces, the
   *  task/prompt the generator was responding to). Used for the
   *  "answered the question" check. */
  ownerMessage: string;
  /** The draft response the generator produced. */
  draft: string;
  /** Last ~3 assistant+user turns for repetition-detection context.
   *  Trim aggressively — critic doesn't need full history. */
  recentTurns: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Names of tools the generator called THIS turn — used for the
   *  "claims persistence without tool" check. */
  toolsUsedThisTurn: string[];
  /** Set true to skip the critic entirely (e.g. fabrication-guard
   *  retry where we've already done one revision). */
  skip?: boolean;
  /** Optional — when provided, the critic's Haiku call is recorded to
   *  chat_runs via recordLlmCall so the command deck shows the cost.
   *  Without this, Axis runs free of charge as far as the dashboard
   *  knows, which is exactly the gap Devon flagged on 2026-05-27. */
  tenantPhone?: string;
  /** Optional roster of DELEGABLE agents (everyone on the team except Iris
   *  herself) so the critic can judge whether the owner's request belonged
   *  in an agent's domain and whether work presented as an agent's was
   *  actually produced by one. */
  team?: Array<{ name: string; role?: string; description?: string }>;
}

/**
 * Per-surface rule sheets. Each rule maps to a specific failure mode
 * observed in production. Add rules sparingly — the critic prompt
 * grows linearly with this list and over-strict rules generate false
 * positives that erode trust in the critic.
 */
const RULE_SHEETS: Record<CriticSurface, string> = {
  'iris-chat': `RULES (check each, mark severity high if certain, medium if plausible, low if minor):

1. answered_owner_question (HIGH) — The draft must substantively address what the owner ASKED in their most recent message. If the owner asked two questions, both must be addressed. If a question is BURIED under unrelated sections (e.g. owner asked about workouts, draft opens with three paragraphs about Au7o traffic), mark this violation high.

2. opens_with_volunteered_topic (HIGH) — The first 1-2 sentences must reference something from the owner's message OR be a direct answer to it. If the draft opens with a topic the owner did NOT mention (e.g. "*Au7o Traffic* — auth expired" when owner asked about a workout), mark this HIGH. The owner-topic-overlap check is loose — words like "schedule", "calendar", "team" can match casual references — but tool-failure recitals and stale-status reports about topics the owner didn't bring up are violations.

2b. adds_unrelated_followup (HIGH) — Even AFTER a correct primary answer, the draft must NOT add an unrelated coaching tip, reminder, or follow-up section the owner didn't ask about. If the owner asked about Topic A and the draft answers A but then adds "Also on Topic B...", "And on the workout timing...", "And don't forget about...", that's a volunteered follow-up violation — regardless of whether B was mentioned earlier in conversation. The owner is on Topic A right now. Adding B costs them attention AND costs the platform tokens. Mark HIGH if a section break introduces a topic with no semantic link to the owner's current message.

3. repeats_recent_info (MEDIUM) — If the draft re-states substantive info that appeared in either of the last 2 assistant turns without adding new info, that's a repetition violation. Brief mentions / context references are fine; full re-dumps of the same data points are not.

4. claims_persistence_without_tool (HIGH) — If the draft contains phrases like "saved", "noted", "scheduled", "added to your calendar", "locked in", "✓ Saved", "✓ noted", or any ✓ checkmark claim of completed state-change AND the toolsUsedThisTurn list does NOT contain a matching persisting tool (remember_this, create_workflow, approve_workflow, add_agent_to_team, update_agent, set_sender_rules, enable_mcp_server, set_canonical_role, move_agent_under_manager, set_marketing_autonomy, connect_automation_webhook, add_tool_to_agent), that's a high-severity fabrication.

5. unsupported_agent_attribution (MEDIUM) — If the draft attributes an action to a NAMED agent (Alex, Marcus, Mira, Riley, Luna, etc.) with verbs like "flagged", "handled", "is looking at", "fixed", "noted" AND no team-aware tool (consult_manager, add_agent_to_team, etc.) was called this turn AND the named agent isn't speaking as Iris herself, that's an attribution violation.

6. resurrects_unprompted_history (HIGH) — The draft references a topic, entity, or thread from PRIOR turns that the owner's CURRENT message does not mention by name or pronoun. Conversation history exists for anaphora resolution ("send it" → look back to know what "it" is), NOT as a list of open threads to fish through. Examples that should trigger HIGH:
   - Owner asks "what's the weather" → draft answers weather then adds "Also on the Ron email...". The Ron email was discussed earlier but not THIS turn. Violation.
   - Owner says "test of new updates" → draft invents a 7pm digest topic from earlier conversation and offers options about it. The owner never said 7pm THIS turn. Violation.
   - Owner asks about workout → draft adds "And on the workout timing complaint from yesterday...". Yesterday is not now. Violation.

   Exception: if the owner's current message uses a pronoun (it/that/the email/etc) that can ONLY be resolved by looking back, the resolved-to topic is in scope. The test: is the prior topic referenced because the owner is pointing at it RIGHT NOW, or because Iris decided to bring it up?

7. self_commentary (MEDIUM) — The draft contains apology theater or commentary about Iris's own behavior that the owner didn't ask for: "Won't happen again", "that's on me", "noted on staying on topic", "fair catch", "good point — I'll watch for that going forward". Even when sincere, these phrases consume the owner's attention without adding value. Acting differently IS the acknowledgment. Mark MEDIUM if such a phrase appears; HIGH if the entire reply is meta-commentary with no substantive answer.

8. should_have_delegated (MEDIUM) — If the owner's request falls squarely in a DELEGABLE TEAM AGENT's domain (a workout / training plan → a Coach or trainer; a P&L / financial summary / budgeting → a finance agent; website / SEO / code / repo work → a web or dev agent; scheduling → a scheduler) AND the draft answers it with Iris's OWN substantive work product AND "delegate_to_agent" is NOT in the tools called this turn, mark this MEDIUM. The named agents exist to do their own domain work — Iris should delegate to them, not do it all herself. Do NOT flag trivial one-liners, clarifying questions, quick status answers, or requests no listed agent owns. Match against the DELEGABLE TEAM AGENTS list — if no agent covers the domain, there is no violation.

9. presents_unproduced_agent_work (HIGH) — If the draft presents work product AS a named agent's output — e.g. "Here's what Coach put together:", "Coach's plan:", "[Marcus's response]", "Mira pulled together", "from Alex:" — but "delegate_to_agent" is NOT in the tools called this turn, then that agent did NOT actually produce it. That is the silent-substitution fabrication: Iris generating an absent agent's work and presenting it as theirs. Mark HIGH. IMPORTANT: when "delegate_to_agent" IS in the tools called this turn, presenting the agent's work with attribution is correct — do NOT flag.

10. wasteful_tool_use (MEDIUM) — If the owner's most recent message is a trivial acknowledgment or non-request ("thanks", "thank you", "ok", "okay", "cool", "got it", "nice", "👍", "perfect", "you were going to say something?", etc.) AND the tools called this turn include an EXPENSIVE tool — request_research, analyze_website, generate_website, create_document, delegate_to_agent, dispatch_to_agents, consult_manager — that is a wasteful misfire: a heavy/slow/costly tool fired when the message needed none (e.g. running web research on a "thank you"). Mark MEDIUM. Do NOT flag cheap read tools (recall_atoms, recall_behavioral_rag, list_*, get_*) on short messages — only the expensive ones listed. This catches tool-selection misfires the text-quality rules miss.

Return STRICT JSON with no text before or after:
{
  "passes": true | false,
  "violations": [
    { "rule": "rule_id", "severity": "high"|"medium"|"low", "evidence": "≤80 char quote from the draft", "fix": "≤120 char suggested rewrite or action" }
  ]
}

passes = true ONLY when violations is empty OR contains only "low" severity items.`,

  // Future surfaces — sketched, not yet wired. Build rule sheets per
  // surface as we propagate the critic. Placeholder rules keep the type
  // signature complete without forcing premature design.
  'agent-tick': `RULES:
1. addressed_observation_prompt (HIGH) — tick output must explain what the agent observed this cycle, not just generic platitudes.
2. used_available_tools (MEDIUM) — if the agent had relevant tools available, did they call any? Silent ticks on a tenant with data are suspicious.
3. no_cron_attribution (HIGH) — never claim a cron output came from a named agent.

Return STRICT JSON: { "passes": bool, "violations": [{rule, severity, evidence, fix}] }`,

  'email-sift': `RULES:
1. consistent_with_corrections (HIGH) — classification must respect the OPERATING MANUAL disposition rules (corrections, frustration_triggers) — if owner said "stop drafting replies to X", draft_reply must be null for X.
2. respects_trust_block (MEDIUM) — senders in the trusted block should bias toward business, not spam.

Return STRICT JSON: { "passes": bool, "violations": [{rule, severity, evidence, fix}] }`,

  'daily-briefing': `RULES:
1. each_section_grounded (HIGH) — every section must reference real data from the briefing context, not fabricated patterns.
2. no_named_agent_for_cron (HIGH) — never attribute cron output to a named agent.

Return STRICT JSON: { "passes": bool, "violations": [{rule, severity, evidence, fix}] }`,

  'marketing-draft': `RULES:
1. grounded_in_business_signal (HIGH) — concept must tie to a real atom/event from the tenant's data, not generic engagement bait.
2. respects_voice_profile (MEDIUM) — match the owner's recent approved captions in tone.

Return STRICT JSON: { "passes": bool, "violations": [{rule, severity, evidence, fix}] }`,
};

/**
 * Run Axis's critic on a generator draft. Returns the parsed critique
 * + token telemetry. NEVER throws — on critic failure (network, parse,
 * timeout) returns passes=true with critic_error populated so the
 * caller ships the original draft. Critic failures don't block delivery.
 */
export async function critiqueResponse(input: CritiqueInput): Promise<CritiqueResult> {
  // Audit policy (2026-05-30): the owner wants the critic to see EVERYTHING
  // that could carry a problem — a Haiku audit (~$0.002) is far cheaper than a
  // misfire (e.g. request_research on a "thank you" ~ $0.23). The only thing
  // safe to skip is a genuinely trivial reply that ALSO called no tools (an
  // "ok"/"👍" ack with nothing to catch). The moment ANY tool fired this turn,
  // we audit regardless of reply length — that's exactly the case that let
  // "You're welcome!" (15 chars) hide a wasteful analyze_website +
  // request_research misfire from the old length-only skip.
  const firedAnyTool = (input.toolsUsedThisTurn?.length ?? 0) > 0;
  if (input.skip || (input.draft.trim().length < 30 && !firedAnyTool)) {
    return { passes: true, violations: [], tokens_in: 0, tokens_out: 0 };
  }
  if (!ANTHROPIC_API_KEY) {
    return { passes: true, violations: [], tokens_in: 0, tokens_out: 0, critic_error: 'ANTHROPIC_API_KEY not set' };
  }

  const ruleSheet = RULE_SHEETS[input.surface];
  if (!ruleSheet) {
    return { passes: true, violations: [], tokens_in: 0, tokens_out: 0, critic_error: `no rule sheet for surface ${input.surface}` };
  }

  // Trim context aggressively — critic doesn't need full conversation
  // history. The owner's last message + last 3 turns + tools called this
  // turn cover all the rules.
  const recentTurnsTrimmed = (input.recentTurns ?? []).slice(-3).map((t) => ({
    role: t.role,
    content: (t.content ?? '').slice(0, 400),
  }));

  const system = `You are Axis, the runtime quality auditor for WisdomWorks. You read a draft response from the generator and check it against a rule sheet. You are STRICT but CALIBRATED — false positives erode trust in the audit. Mark severity high only when you are certain a rule was violated. When in doubt, mark medium or low (or no violation at all).

${ruleSheet}`;

  const team = input.team ?? [];
  const teamBlock = team.length === 0
    ? '(no delegable agents on this team)'
    : team
        .map((a) => `- ${a.name}${a.role ? ` — ${a.role}` : ''}${a.description ? `: ${a.description.slice(0, 120)}` : ''}`)
        .join('\n');

  const userBlock = `OWNER'S MOST RECENT MESSAGE:
"${input.ownerMessage.slice(0, 600)}"

RECENT TURNS (most recent last):
${recentTurnsTrimmed.length === 0 ? '(none)' : recentTurnsTrimmed.map((t) => `[${t.role}] ${t.content}`).join('\n\n')}

TOOLS CALLED THIS TURN BY GENERATOR:
${input.toolsUsedThisTurn.length === 0 ? '(none)' : input.toolsUsedThisTurn.join(', ')}

DELEGABLE TEAM AGENTS (Iris can hand domain work to these via delegate_to_agent):
${teamBlock}

DRAFT RESPONSE TO AUDIT:
"""
${input.draft.slice(0, 4000)}
"""

Audit the draft and return JSON.`;

  let tokens_in = 0;
  let tokens_out = 0;
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: HAIKU_MODEL,
        max_tokens: 600,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userBlock }],
      }),
    });
    if (!res.ok) {
      const errBody = await res.text();
      return { passes: true, violations: [], tokens_in, tokens_out, critic_error: `${res.status}: ${errBody.slice(0, 200)}` };
    }
    const data = await res.json();
    tokens_in = data.usage?.input_tokens ?? 0;
    tokens_out = data.usage?.output_tokens ?? 0;
    // 2026-05-27 — record critic's Haiku cost so it shows up in deck.
    // Fire-and-forget; never blocks the audit result.
    if (input.tenantPhone) {
      void (async () => {
        try {
          const { recordLlmCall } = await import('./chat-cost-tracker');
          await recordLlmCall({
            tenantPhone: input.tenantPhone!,
            surface: 'axis-critic',
            model: HAIKU_MODEL,
            tokensIn: tokens_in,
            tokensOut: tokens_out,
            cachedTokensIn: data.usage?.cache_read_input_tokens ?? 0,
            toolsUsed: [],
          });
        } catch (err) {
          console.warn('[axis-critic] cost record failed (non-blocking):', err);
        }
      })();
    }
    const text = data.content?.[0]?.text ?? '';
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    if (jsonStart < 0 || jsonEnd < jsonStart) {
      return { passes: true, violations: [], tokens_in, tokens_out, critic_error: 'no JSON in critic response' };
    }
    const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
    const violations = Array.isArray(parsed.violations) ? parsed.violations : [];
    // Normalize + filter — drop any violation without required fields.
    const clean: CritiqueViolation[] = [];
    for (const v of violations) {
      if (!v || typeof v.rule !== 'string' || typeof v.severity !== 'string') continue;
      if (!['high', 'medium', 'low'].includes(v.severity)) continue;
      clean.push({
        rule: v.rule.slice(0, 60),
        severity: v.severity as Severity,
        evidence: typeof v.evidence === 'string' ? v.evidence.slice(0, 200) : '',
        fix: typeof v.fix === 'string' ? v.fix.slice(0, 300) : '',
      });
    }
    // Deterministic guard for the two delegation rules. Whether an agent
    // actually produced the work, and whether Iris delegated at all, is
    // settled by toolsUsedThisTurn — NOT by the critic's reading of the prose
    // (Haiku doesn't reliably honor the in-prompt "don't flag when
    // delegate_to_agent fired" exclusion — observed false-positive 2026-05-29).
    // If delegate_to_agent fired this turn, presenting the agent's work is
    // legitimate and Iris DID delegate, so neither rule can apply.
    const delegatedThisTurn = (input.toolsUsedThisTurn ?? []).includes('delegate_to_agent');
    const guarded = delegatedThisTurn
      ? clean.filter((v) => v.rule !== 'presents_unproduced_agent_work' && v.rule !== 'should_have_delegated')
      : clean;

    // passes = true if NO high-severity violations
    const hasHigh = guarded.some((v) => v.severity === 'high');
    return {
      passes: !hasHigh,
      violations: guarded,
      tokens_in,
      tokens_out,
    };
  } catch (err: any) {
    return { passes: true, violations: [], tokens_in, tokens_out, critic_error: err?.message ?? String(err) };
  }
}

/**
 * Persist every Axis violation to axis_critiques (fire-and-forget).
 *
 * This is the LEARNING-loop foundation: repeated violations of the
 * same rule on the same tenant are evidence of a system-prompt or
 * disposition gap, not a one-off slip. Aggregation queries surface
 * those patterns to the owner ("Iris has buried questions 8x this
 * week — want me to tighten the prompt?") OR to auto-promotion logic
 * that lifts a recurring violation into a new disposition rule.
 *
 * Append-only. Never blocks delivery — even on persist failure, the
 * audit + revision already happened by the time this runs.
 */
export async function persistCritique(args: {
  tenantPhone: string;
  surface: CriticSurface;
  critique: CritiqueResult;
  sourceMessage: string;
  draft: string;
  revisionAttempted: boolean;
}): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  if (!args.critique.violations || args.critique.violations.length === 0) return;
  const cleanPhone = args.tenantPhone.replace(/[\s\-+()]/g, '');
  try {
    const rows = args.critique.violations.map((v) => ({
      tenant_phone: cleanPhone,
      surface: args.surface,
      rule: v.rule,
      severity: v.severity,
      evidence: v.evidence?.slice(0, 200) ?? null,
      fix: v.fix?.slice(0, 300) ?? null,
      source_message_preview: args.sourceMessage?.slice(0, 400) ?? null,
      draft_preview: args.draft?.slice(0, 400) ?? null,
      revision_attempted: args.revisionAttempted,
      metadata: {
        critic_tokens_in: args.critique.tokens_in,
        critic_tokens_out: args.critique.tokens_out,
        critic_model: HAIKU_MODEL,
      },
    }));
    await fetch(`${SUPABASE_URL}/rest/v1/axis_critiques`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(rows),
    });
  } catch (err) {
    // Non-blocking; aggregation just won't see this hit. Log so we can
    // notice if persist is silently broken.
    console.warn('[axis-critic] persist failed:', err);
  }
}

/**
 * Build a system-prompt addendum the generator sees on revision, so it
 * knows what to fix. Designed to be appended to the generator's
 * existing system prompt for the revision call — NOT injected as a
 * fake user message (that would blur the trust boundary).
 */
export function buildRevisionInstruction(critique: CritiqueResult): string {
  if (critique.passes || critique.violations.length === 0) return '';
  const high = critique.violations.filter((v) => v.severity === 'high');
  const med = critique.violations.filter((v) => v.severity === 'medium');
  const lines: string[] = [
    '',
    '═══════════════════════════════════════════════════════════════════════════',
    'AXIS AUDIT — REVISION REQUIRED',
    '═══════════════════════════════════════════════════════════════════════════',
    '',
    'Your previous draft was audited by Axis (the runtime quality auditor) and',
    'failed one or more rules. Revise the response to fix these issues:',
    '',
  ];
  for (const v of high) {
    lines.push(`✗ HIGH — ${v.rule}: ${v.evidence}`);
    if (v.fix) lines.push(`  Fix: ${v.fix}`);
  }
  for (const v of med) {
    lines.push(`⚠ MEDIUM — ${v.rule}: ${v.evidence}`);
    if (v.fix) lines.push(`  Fix: ${v.fix}`);
  }
  lines.push('');
  lines.push('Rewrite your response addressing these specifically. Do NOT apologize for the original draft in your revised reply — the owner never saw it.');
  return lines.join('\n');
}

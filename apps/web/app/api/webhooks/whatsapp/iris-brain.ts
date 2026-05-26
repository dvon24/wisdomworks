/**
 * Iris Brain — shared AI loop used by both the WhatsApp webhook and the
 * Command Deck /api/chat endpoint, so both surfaces stay in sync (same
 * system prompt, same tool calls, same conversation history).
 *
 * Caller responsibilities:
 *   1. Load UserContext (loadUserContext)
 *   2. Append the user's new message to conversationHistory
 *   3. Call generateIrisReply(text, user)
 *   4. The brain saves context internally and returns the assistant's text
 */

import { loadConnectionsForPhone } from '@wisdomworks/shared';
import {
  buildContextMessages,
  saveUserContext,
  type UserContext,
} from './context-store';
import { buildSystemPrompt } from './system-prompt';
import { buildToolList, executeTool, type ToolCall } from './agent-tools';
import { recordChatRun } from '../../_lib/chat-cost-tracker';

const MAX_ITERATIONS = 8;
// Sonnet 4.6 — same $3/$15 per MTok as Sonnet 4 but supports adaptive
// thinking + interleaved thinking between tool calls. Pure capability
// upgrade at zero cost change.
const SONNET_MODEL = 'claude-sonnet-4-6';
// Adaptive thinking budget. Claude decides how much of this to spend
// on thinking vs final text. 4096 gives plenty of headroom for
// multi-step reasoning without runaway latency on simple chats.
const MAX_TOKENS = 4096;
// Anthropic Sonnet 4.6 published rates per 1M tokens.
// Per docs: cache writes are 1.25× base, cache reads are 0.1× base.
const SONNET_IN_PER_M = 3;
const SONNET_OUT_PER_M = 15;
const SONNET_CACHE_WRITE_PER_M = 3.75;
const SONNET_CACHE_READ_PER_M = 0.3;

function estimateChatCost(uncachedIn: number, cacheWriteIn: number, cacheReadIn: number, totalOut: number): number {
  return (
    uncachedIn * SONNET_IN_PER_M +
    cacheWriteIn * SONNET_CACHE_WRITE_PER_M +
    cacheReadIn * SONNET_CACHE_READ_PER_M +
    totalOut * SONNET_OUT_PER_M
  ) / 1_000_000;
}

// Per-surface effort levels. Sonnet 4.6 defaults to `high` which Anthropic's
// own docs warn "can cause unexpected latency" — but `low` had the opposite
// problem: Iris skipped tool calls and shallow-replied to multi-step asks
// (e.g. attached weather image for race weekend → reply ignored the image,
// said something about being "tenacious" with iterations=0 and no tools
// used). `medium` is the Sonnet 4.6 recommended default: balances cost
// and reasoning quality.
//   - whatsapp / sms / imessage / telegram: realtime, owner-facing → medium
//   - deck: async owner-facing webapp → medium (was already)
// Drop to `low` per-call only when the message is clearly trivial (short
// "thanks", "ok", "cool") — that's a future surgical optimization.
type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
const EFFORT_BY_SURFACE: Record<'whatsapp' | 'deck' | 'telegram' | 'sms' | 'imessage', EffortLevel> = {
  whatsapp: 'medium',
  sms: 'medium',
  imessage: 'medium',
  telegram: 'medium',
  deck: 'medium',
};

async function callAnthropic(
  apiKey: string,
  systemPrompt: string,
  messages: any[],
  tools: any[],
  effort: EffortLevel,
  containerId?: string | null,
): Promise<any> {
  // Prompt caching strategy (3 of the 4 available breakpoints):
  //   1. tools[-1].cache_control — caches the tool definitions (stable per tenant)
  //   2. system[0].cache_control — caches tools + system prompt prefix
  //   3. top-level cache_control — automatic caching moves the breakpoint to the
  //      last message each request, so the growing conversation tail (multi-iter
  //      tool loops + multi-turn history) reads from cache on subsequent calls.
  // Hierarchy is tools → system → messages, so each breakpoint covers the
  // prior layers transitively. Cache reads are 10% of base; writes are 125%.
  //
  // Thinking: adaptive mode lets Claude decide whether/how much to think
  // per request. On Sonnet 4.6 this also auto-enables interleaved thinking
  // between tool calls — big win for multi-step reasoning in tool loops.
  // Thinking blocks are preserved in conversation history by default on
  // 4.6+ so prompt-cache prefixes stay valid across turns.
  const body: any = {
    model: SONNET_MODEL,
    max_tokens: MAX_TOKENS,
    thinking: { type: 'adaptive' },
    output_config: { effort },
    cache_control: { type: 'ephemeral' },
    system: [
      { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
    ],
    messages,
  };
  // PTC support: when any tool opted in via allowed_callers, append the
  // code_execution_20250825 tool so the model has a sandbox to write
  // Python that calls those tools. Beta header gates the whole feature.
  let toolsForRequest = tools;
  let usePtc = false;
  if (tools.length > 0) {
    usePtc = tools.some((t) => Array.isArray(t.allowed_callers) && t.allowed_callers.includes('code_execution_20250825'));
    if (usePtc) {
      const { CODE_EXECUTION_TOOL } = await import('./agent-tools');
      toolsForRequest = [...tools, CODE_EXECUTION_TOOL];
    }
    // Mark the last tool definition for caching so the tools array is
    // cached as the first layer (cheaper than re-shipping ~12kb of tool
    // schemas on every iteration of the tool loop).
    const toolsWithCache = toolsForRequest.map((t, i) =>
      i === toolsForRequest.length - 1 ? { ...t, cache_control: { type: 'ephemeral' } } : t,
    );
    body.tools = toolsWithCache;
  }
  // Preserve container state across iterations so the model's Python
  // env doesn't reset each round-trip (containers TTL ~5min — matches
  // prompt cache).
  if (containerId) {
    body.container = containerId;
  }

  const headers: Record<string, string> = {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  };
  if (usePtc) {
    headers['anthropic-beta'] = 'advanced-tool-use-2025-11-20';
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Anthropic API error: ${JSON.stringify(error)}`);
  }
  return response.json();
}

export async function generateIrisReply(
  text: string,
  user: UserContext,
  surface: 'whatsapp' | 'deck' | 'telegram' | 'sms' | 'imessage' = 'whatsapp',
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return `Hi ${user.name}! My AI brain is being set up — I'll be fully operational soon.`;
  }

  user.conversationHistory.push({
    role: 'user',
    content: text,
    timestamp: new Date().toISOString(),
  });

  const connections = await loadConnectionsForPhone(user.phoneNumber);
  // Bind the persist-refreshed-token callback onto each Google connection
  // so router-mediated calls (Gmail/Calendar via listEmails / listCalendarEvents)
  // also persist refreshed tokens — same loop the direct adapter calls
  // (GSC/GA/Sheets) get via googleIntegrationCtx.
  const { persistRefreshedAccessToken } = await import('../../_lib/oauth-token-store');
  for (const c of connections) {
    if (c.provider !== 'google') continue;
    (c as any).onTokenRefreshed = (newAccessToken: string, expiresAtIso: string) => {
      void persistRefreshedAccessToken({
        phoneNumber: user.phoneNumber,
        provider: c.provider,
        service: c.service,
        newAccessToken,
        expiresAtIso,
      });
    };
  }
  console.log(`[iris-${surface}] Loaded ${connections.length} connection(s) for ${user.phoneNumber}: ${connections.map((c) => `${c.provider}/${c.service}`).join(', ') || 'none'}`);
  const tools = buildToolList(connections, { ownerPhone: user.phoneNumber });

  // 2026-05-24 — MCP tool execution layer (commit will reference). For
  // each MCP server the tenant has enabled in tenant_mcp_servers, fetch
  // its advertised tool list and append namespaced (mcp__<slug>__<name>)
  // tools to the array. Discovery is cached per-tenant for 5 min and
  // wraps Promise.all so one slow server doesn't serialize the rest.
  // Failed servers reflect their error back into tenant_mcp_servers so
  // list_my_mcp_servers shows the failure to the owner.
  try {
    const { discoverMcpToolsForTenant } = await import('../../_lib/mcp-tool-discovery');
    const mcpTools = await discoverMcpToolsForTenant(user.phoneNumber);
    if (mcpTools.length > 0) {
      tools.push(...mcpTools.map((m) => m.anthropicTool));
      console.log(`[iris-${surface}] Added ${mcpTools.length} MCP tool(s): ${mcpTools.map((m) => m.fullName).join(', ')}`);
    }
  } catch (err) {
    console.warn(`[iris-${surface}] MCP discovery failed (non-blocking):`, err);
  }
  const messages: any[] = buildContextMessages(user);
  // Build the system prompt then append the owner-disposition block —
  // the operating manual auto-mined from past interactions. Renders
  // into every Iris turn so corrections / preferences / triggers carry
  // forward without re-relearning.
  const baseSystemPrompt = buildSystemPrompt(user, connections);
  const { buildDispositionContext } = await import('../../_lib/disposition-mining');
  const dispositionBlock = await buildDispositionContext(user.phoneNumber, { limit: 12 });
  const systemPrompt = baseSystemPrompt + dispositionBlock;

  // Accumulate token + tool usage across every Anthropic round-trip in the loop.
  // Per Anthropic's response schema:
  //   usage.input_tokens               = tokens AFTER the last cache breakpoint (uncached)
  //   usage.cache_creation_input_tokens = tokens being WRITTEN to cache (1.25× rate)
  //   usage.cache_read_input_tokens     = tokens READ from cache (0.1× rate)
  // Total prompt tokens = sum of all three; we track each separately for
  // accurate cost attribution.
  let uncachedTokensIn = 0;
  let cacheWriteTokensIn = 0;
  let cacheReadTokensIn = 0;
  let totalTokensOut = 0;
  const toolsUsed: string[] = [];
  // 2026-05-23 — code-generated state-change confirmations.
  // Each persisting tool that succeeds populates a canonical owner-facing
  // confirmation string (ToolResult.owner_confirmation). We accumulate
  // them here through the loop and append at delivery, AFTER the model's
  // natural-language reply. This makes the model's "going forward..."
  // claims redundant rather than load-bearing — the appended canonical
  // string IS the proof of the persisted change. Replaces the regex
  // fabrication guard as the primary defense for state-change claims;
  // the guard stays as an informational tripwire until we've watched
  // this pattern in production for a week.
  const ownerConfirmations: string[] = [];
  const startedAt = Date.now();

  const accumulate = (usage: any) => {
    uncachedTokensIn += usage?.input_tokens ?? 0;
    cacheWriteTokensIn += usage?.cache_creation_input_tokens ?? 0;
    cacheReadTokensIn += usage?.cache_read_input_tokens ?? 0;
    totalTokensOut += usage?.output_tokens ?? 0;
  };

  const effort = EFFORT_BY_SURFACE[surface] ?? 'medium';

  // 2026-05-24 — PTC container tracking. When PTC-enabled tools are
  // present and the model writes Python in the code-exec container,
  // the container needs to persist across loop iterations or each
  // round-trip starts fresh (defeating the token-savings purpose).
  // First response sets containerId; subsequent calls echo it back.
  let containerId: string | null = null;

  try {
    let iteration = 0;
    let response = await callAnthropic(apiKey, systemPrompt, messages, tools, effort, containerId);
    accumulate(response.usage);
    if (response.container?.id) containerId = response.container.id;

    while (response.stop_reason === 'tool_use' && iteration < MAX_ITERATIONS) {
      iteration++;
      const toolUseBlocks = response.content.filter((b: any) => b.type === 'tool_use');
      messages.push({ role: 'assistant', content: response.content });

      const toolResults: any[] = [];
      for (const block of toolUseBlocks) {
        const call: ToolCall = { name: block.name, input: block.input };
        // PTC caller distinction — tool calls from the code-exec container
        // have caller.type === 'code_execution_20250825'. Logged for
        // debugging but routed through the same executeTool path.
        const callerType = (block as any).caller?.type ?? 'direct';
        console.log(`[iris-${surface}] Tool call (${callerType}): ${call.name}`, call.input);
        toolsUsed.push(call.name);
        const result = await executeTool(call, connections, user);
        if (result.success && typeof result.owner_confirmation === 'string' && result.owner_confirmation.trim().length > 0) {
          ownerConfirmations.push(result.owner_confirmation.trim());
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: result.content,
          is_error: !result.success,
        });
      }
      messages.push({ role: 'user', content: toolResults });
      response = await callAnthropic(apiKey, systemPrompt, messages, tools, effort, containerId);
      accumulate(response.usage);
      if (response.container?.id) containerId = response.container.id;
    }

    // If the loop exited while still in tool_use (hit cap, or model wanted to keep going),
    // make one more call WITHOUT tools so it's forced to produce a text reply.
    if (response.stop_reason === 'tool_use') {
      console.warn(`[iris-${surface}] Tool loop hit cap at iteration ${iteration} — forcing final text.`);
      messages.push({ role: 'assistant', content: response.content });
      messages.push({
        role: 'user',
        content: 'Summarize what you just did in one or two short sentences for the user. No more tool calls.',
      });
      response = await callAnthropic(apiKey, systemPrompt, messages, [], effort);
      accumulate(response.usage);
    }

    let textBlock = response.content.find((b: any) => b.type === 'text');
    let assistantMessage = textBlock?.text ?? "I couldn't process that. Try again?";

    // ───────────────────────────────────────────────────────────────────────
    // CODE-SIDE PERFORMATIVE-COMPLIANCE STRIPPER
    //
    // Devon's 2026-05-23 frustration: Iris kept opening replies with
    // "About Mia — that was a mistake" / "I'm Iris, always have been" /
    // "Sorry about the Mia hallucination" even when the owner asked about
    // PDF tables or coach workouts. The disposition silent-guidance footer
    // failed. The prompt's no-recital rule failed. Three patches couldn't
    // stop the recital because Iris's own apologetic preambles in
    // conversation_history became context for the NEXT reply — self-
    // reinforcing loop.
    //
    // Code-side fix: strip apologetic-recital paragraphs from the START of
    // Iris's response when the OWNER's current message doesn't reference
    // the topic being apologized for. Same shape as fabrication guard but
    // for meta-behavior (talking about being good vs. just being good).
    //
    // Patterns are conservative — we only strip from the OPENING of the
    // response, not mid-text, so legitimate Mia-related answers still flow
    // through. Trailing apologies in long replies also pass through.
    //
    // ───────────────────────────────────────────────────────────────────────
    const ownerMsgLower = (text ?? '').toLowerCase();
    const RECITAL_OPENER_PATTERNS: Array<{ pattern: RegExp; topic: RegExp }> = [
      // "About Mia — that was a mistake..." / "On Mia: that was..." / "Mia was a hallucination"
      { pattern: /^(\s*[*\-•]?\s*)(about|on|re|sorry about|sorry for the)?\s*"?mia"?\b[^.\n]{0,200}[.!\n]/i, topic: /\bmia\b/i },
      // "My name is Iris — already confirmed" / "I'm Iris, always have been" / "I am Iris (confirmed)"
      { pattern: /^(\s*[*\-•]?\s*)(my name is|i['']?m|i am|just to confirm,? i['']?m|confirmed[,:]? i['']?m)\s+iris[^.\n]{0,150}[.!\n]/i, topic: /\b(name|iris|sophia)\b/i },
      // "Sorry for the confusion about <topic>" — generic apologetic preamble
      { pattern: /^(\s*[*\-•]?\s*)(sorry for the confusion|apologies for the confusion|to clarify[,:])\s*[^.\n]{0,200}[.!\n]/i, topic: /\b(confusion|clarify|earlier|prior)\b/i },
      // "As I noted before..." / "Just to be clear, [restating a rule]..."
      { pattern: /^(\s*[*\-•]?\s*)(as i (noted|mentioned|said) before|just to be clear|to reiterate)[,:]?\s*[^.\n]{0,200}[.!\n]/i, topic: /\b(noted|mentioned|reiterate|clear)\b/i },
    ];
    let stripCount = 0;
    let stripped = assistantMessage;
    for (const { pattern, topic } of RECITAL_OPENER_PATTERNS) {
      const match = stripped.match(pattern);
      if (match && !topic.test(ownerMsgLower)) {
        stripped = stripped.replace(pattern, '').trimStart();
        stripCount++;
      }
    }
    // Also collapse leading horizontal-rule dividers ("---") that often
    // separate the stripped preamble from the real answer below.
    stripped = stripped.replace(/^\s*(---|—{2,})\s*\n+/g, '').trimStart();
    if (stripCount > 0 && stripped.length > 0) {
      console.log(`[iris-${surface}] Stripped ${stripCount} recital opener(s). Original: "${assistantMessage.slice(0, 100)}..." Cleaned: "${stripped.slice(0, 100)}..."`);
      assistantMessage = stripped;
    }
    // If stripping ate the entire message (unlikely but possible), restore the original.
    if (stripped.length === 0) {
      console.warn(`[iris-${surface}] Recital stripper would have emptied the message — restoring original.`);
    }

    // ───────────────────────────────────────────────────────────────────────
    // ATTRIBUTION GATE
    //
    // Devon's 2026-05-23 transcript: Iris said "Alex flagged this for
    // immediate front-end triage. He's looking at CSS/responsive layout
    // bugs..." — no consult_manager call, no agent_runs row, no actual
    // delegation. Pure attribution fabrication. Same shape as the cron
    // "Mira flagged this email" bug fixed in e050c9e (prompt-only patch).
    //
    // The named team agents in user.profile.team are PERSONAS Iris
    // coordinates — they don't have autonomous backends that "flag" or
    // "look at" things. ALL work is done by Iris's own tools. So any
    // past-tense action attributed to another agent is unsupported
    // UNLESS Iris called a team-aware tool this turn (consult_manager,
    // add_agent_to_team, update_agent, move_agent_under_manager) that
    // makes the attribution real.
    //
    // We strip the FULL SENTENCE containing the unsupported attribution.
    // Conservative — if the model wrote a long paragraph, one sentence
    // drops without orphaning the rest. Iris herself is excluded (she
    // IS the speaker).
    // ───────────────────────────────────────────────────────────────────────
    const TEAM_AWARE_TOOLS = new Set([
      'consult_manager',
      'add_agent_to_team',
      'update_agent',
      'move_agent_under_manager',
      'remove_agent_from_team',
      'add_tool_to_agent',
    ]);
    const teamToolFired = toolsUsed.some((t) => TEAM_AWARE_TOOLS.has(t));
    // Iris IS the personal-assistant slot at team[0] — exclude her name
    // from the attribution scan since she's the speaker, not a third-
    // party actor.
    const irisNameLower = (user.profile?.team?.[0]?.name ?? 'Iris').toLowerCase();
    const teamNames = (user.profile?.team ?? [])
      .map((a) => a.name)
      .filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
      .filter((n) => n.toLowerCase() !== irisNameLower);
    if (!teamToolFired && teamNames.length > 0) {
      // Past-tense + present-progressive + future-tense action verbs that
      // make a CLAIM about an agent having done / doing / about-to-do
      // something. Owner-facing phrasing only — internal Iris-speak like
      // "Marcus is your finance lead" doesn't trigger.
      const ATTR_VERBS =
        '(flagged|noted|handled|fixed|prepared|reviewed|checked|sent|posted|published|emailed|wrote|drafted|recommended|analyzed|caught|spotted|identified|escalated|approved|rejected|investigated|monitored|is\\s+(looking|monitoring|reviewing|checking|handling|investigating|preparing|drafting)|will\\s+(look|monitor|review|check|handle|investigate|prepare|draft|send|post|publish|email)|has\\s+(flagged|noted|handled|fixed|prepared|reviewed|checked|sent|posted|published))';
      const namesAlt = teamNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
      const attrPattern = new RegExp(`\\b(${namesAlt})\\b[^.!?\\n]{0,60}\\b${ATTR_VERBS}\\b[^.!?\\n]{0,200}[.!?\\n]`, 'gi');
      const hits: string[] = [];
      let attrStripped = assistantMessage;
      let match: RegExpExecArray | null;
      // Collect all hits first to log before mutating.
      const re = new RegExp(attrPattern.source, attrPattern.flags);
      while ((match = re.exec(assistantMessage)) !== null) {
        hits.push(match[0]);
      }
      if (hits.length > 0) {
        attrStripped = assistantMessage.replace(attrPattern, '').replace(/\n{3,}/g, '\n\n').trim();
        // Don't ship an empty message — if every sentence was an
        // unsupported attribution, fall back to an honest one-liner.
        if (attrStripped.length === 0) {
          attrStripped = "I don't have anything specific to attribute here — what would you like me to do?";
        }
        console.warn(
          `[iris-${surface}] Attribution gate stripped ${hits.length} unsupported claim(s): ${JSON.stringify(hits.map((h) => h.slice(0, 100)))}`,
        );
        assistantMessage = attrStripped;
      }
    }

    // ───────────────────────────────────────────────────────────────────────
    // UNPROMPTED-TOPIC GATE
    //
    // Devon's 2026-05-23 5:52 PM transcript: in response to "needed to add
    // the fixes to the folder so I can get them fixed", Iris opened with:
    //   *Who's Mia* — she appears in older system data...
    //   *My name* — I'm Iris. Already set correctly...
    //   *Au7o mobile issues* — Alex flagged this...
    //   *A couple of loose ends from the earlier thread:*
    //     - The Eric email — ...
    //     - The Ron letter — you said don't send...
    //     - Swim — noted, hope it was good. 🏊
    //
    // Closed-loop resurrection: Iris re-raised topics the owner had already
    // resolved or never asked about THIS turn. The recital stripper missed
    // it because the opener wasn't apologetic, just volunteered.
    //
    // Two narrow patterns this gate targets:
    //   1. SELF-REFERENTIAL OPENER — a leading section header like
    //      *Who's <name>* or *My name* or "I'm Iris..." when the owner's
    //      current message has zero overlap with identity/name topics.
    //   2. LOOSE-ENDS TRAILER — a trailing section like "loose ends from
    //      the earlier thread" / "couple of things from before" / "still
    //      pending" when the owner's message is short and unrelated.
    //
    // Conservative: we only strip the matched SECTION (header + its body
    // up to the next blank line or section break), never the whole reply.
    // Falls back to original if stripping would empty the message.
    // ───────────────────────────────────────────────────────────────────────
    const ownerMsgLowerForTopic = (text ?? '').toLowerCase();
    // Words that mean "the owner is referencing identity/naming topics this turn"
    const IDENTITY_HINTS = /\b(name|who are|who's|call you|rename|call yourself|mia|sophia|iris|persona|identity)\b/i;
    // Words that mean "the owner is referencing loose-ends / catch-up topics this turn"
    const CATCHUP_HINTS = /\b(loose ends|catch up|what'?s pending|status|update me|where (are|were) we|earlier|before|from yesterday|from last (night|time|week))\b/i;

    const ownerReferencesIdentity = IDENTITY_HINTS.test(ownerMsgLowerForTopic);
    const ownerReferencesCatchup = CATCHUP_HINTS.test(ownerMsgLowerForTopic);

    let topicStripped = assistantMessage;
    const topicHits: string[] = [];

    // PATTERN 1 — self-referential opener section. Matches a leading
    // *Who's <Name>* or **Who's <Name>** or *My name* etc, optionally
    // followed by a paragraph of body text up to a blank line / new section.
    // Only fires when owner didn't reference identity topics.
    if (!ownerReferencesIdentity) {
      const SELF_REF_OPENERS: RegExp[] = [
        // *Who's Mia* / **Who is Mia** / *Who was Sophia*
        /^\s*\*{1,2}\s*who'?s?\s+(was\s+|is\s+)?[a-z]+\s*\*{1,2}\b[\s\S]*?(?=\n\s*\n|\n\s*\*{1,2}\s*\w|$)/i,
        // *My name* / *My name —* / **My name** etc.
        /^\s*\*{1,2}\s*my\s+name\s*\*{1,2}\b[\s\S]*?(?=\n\s*\n|\n\s*\*{1,2}\s*\w|$)/i,
        // *Name* / *About my name* / *On my name*
        /^\s*\*{1,2}\s*(about|on|re)\s+my\s+name\s*\*{1,2}\b[\s\S]*?(?=\n\s*\n|\n\s*\*{1,2}\s*\w|$)/i,
      ];
      for (const pat of SELF_REF_OPENERS) {
        const match = topicStripped.match(pat);
        if (match) {
          topicHits.push(`self-ref-opener: ${match[0].slice(0, 80)}`);
          topicStripped = topicStripped.replace(pat, '').trimStart();
        }
      }
    }

    // PATTERN 2 — loose-ends trailer block. Matches a section like
    // "*A couple of loose ends from the earlier thread:*" through to end
    // of message. Only fires when owner didn't reference catch-up topics.
    if (!ownerReferencesCatchup) {
      const LOOSE_ENDS_PATTERNS: RegExp[] = [
        // *A couple of loose ends* / *Loose ends* / *Few loose ends from earlier*
        /\n\s*\*{1,2}\s*(a\s+)?(couple|few)\s+(of\s+)?loose\s+ends?[^*\n]*\*{1,2}[\s\S]*$/i,
        /\n\s*\*{1,2}\s*loose\s+ends?[^*\n]*\*{1,2}[\s\S]*$/i,
        // "Also still want to make sure these didn't get lost"
        /\n\s*(also\s+)?(still\s+want|wanted)\s+to\s+(make\s+sure|circle\s+back|mention)[\s\S]*$/i,
        // *Catching up* / *From the earlier thread*
        /\n\s*\*{1,2}\s*(catching\s+up|from\s+(the\s+)?earlier\s+thread|from\s+before)[^*\n]*\*{1,2}[\s\S]*$/i,
      ];
      for (const pat of LOOSE_ENDS_PATTERNS) {
        const match = topicStripped.match(pat);
        if (match) {
          topicHits.push(`loose-ends-trailer: ${match[0].slice(0, 80).trim()}`);
          topicStripped = topicStripped.replace(pat, '').trimEnd();
        }
      }
    }

    if (topicHits.length > 0) {
      const cleaned = topicStripped.trim();
      // Safety: never ship empty — fall back to original.
      if (cleaned.length > 0) {
        console.warn(
          `[iris-${surface}] Unprompted-topic gate stripped ${topicHits.length} section(s): ${JSON.stringify(topicHits)}`,
        );
        assistantMessage = cleaned;
      } else {
        console.warn(
          `[iris-${surface}] Unprompted-topic gate would have emptied the message — restoring original. Hits: ${JSON.stringify(topicHits)}`,
        );
      }
    }

    // ───────────────────────────────────────────────────────────────────────
    // CODE-SIDE FABRICATION GUARD
    //
    // Three prompt-only patches failed to stop Iris from saying "going forward
    // every morning brief will include..." without calling create_workflow.
    // Last-line-of-defense check: scan the final text for forbidden phrases
    // and verify that a persisting tool was called THIS TURN. If not, inject
    // a corrective system message and force ONE retry.
    //
    // Persisting tools are the ones that actually make a "going forward"
    // claim true. Anything else (list_X, get_X, audit_X) doesn't establish
    // future behavior.
    // ───────────────────────────────────────────────────────────────────────
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
    const FABRICATION_PATTERNS: RegExp[] = [
      // Morning-brief specific (original patterns from 4c7df5e).
      /(going forward|from here on|starting tomorrow|starting today|from now on).{0,80}(brief|morning|every|include|all future|now include)/i,
      /(every morning brief|every daily brief|each morning brief).{0,80}(will|now|include|contain)/i,
      /(locked in|saved).{0,40}(brief|morning|going forward|will|every)/i,
      /(will now include|now include).{0,60}(brief|workout|recommendation|section)/i,
      /(baked into|built into|added to).{0,40}(brief|morning|digest|cron)/i,
      /tomorrow'?s brief will include/i,

      // 2026-05-23 — bare completion claims paired with "going forward" /
      // "from now on" etc., even WITHOUT a following morning-brief keyword.
      // Devon's rename test: "Done — I'm Iris going forward" slipped past
      // the old patterns because nothing followed "going forward".
      /(done|got it|✓|✅|locked in)[\s\S]{0,80}(going forward|from now on|from here on)/i,
      /(going forward|from now on|from here on)[\s\S]{0,20}[.!]/i,
      // Identity / name fabrications.
      /i (am|'m) (now |going to be )?[a-z]+ (— |- |going forward|from now on)/i,
      // "always have been Iris" / "always was [X]" — claims unchanged state right
      // after a rename. Broadened 2026-05-23 — earlier pattern required a SPACE
      // after "been" before the negative lookahead, so sentence-ending uses like
      // "I'm Iris — always have been." (period, not space) slipped through.
      // \b after "been|was" matches word boundary which handles ".", "!", "?",
      // EOL, etc. Then exclude legitimate "a/an" continuations.
      /\balways (have been|was)\b(?![ \t]+(a|an)\b)/i,
    ];
    const detectFabrication = (text: string): string[] => {
      const hits: string[] = [];
      for (const pat of FABRICATION_PATTERNS) {
        const m = text.match(pat);
        if (m) hits.push(m[0]);
      }
      return hits;
    };
    const hasPersistingTool = toolsUsed.some(t => PERSISTING_TOOLS.has(t));

    const fabricationHits = detectFabrication(assistantMessage);
    // When a persisting tool fired AND it returned a canonical
    // owner_confirmation, the fabrication regex becomes INFORMATIONAL
    // ONLY — we'll append the canonical confirmation below regardless
    // of what the model said in prose. Logging the hit still tells us
    // the model is generating redundant prose we can train it out of,
    // but we don't retry (and we don't ship a stripped/empty message).
    if (fabricationHits.length > 0 && ownerConfirmations.length > 0) {
      console.info(
        `[iris-${surface}] Fabrication phrases present but ${ownerConfirmations.length} canonical confirmation(s) will be appended — model prose is redundant, not load-bearing. Phrases: ${JSON.stringify(fabricationHits)}`,
      );
    } else if (fabricationHits.length > 0 && !hasPersistingTool) {
      console.warn(
        `[iris-${surface}] Fabrication guard triggered. Phrases: ${JSON.stringify(fabricationHits)} | tools this turn: ${JSON.stringify(toolsUsed)}`,
      );
      // Inject a corrective system-style message and force a retry without
      // tools so the model produces an honest final reply.
      messages.push({ role: 'assistant', content: response.content });
      messages.push({
        role: 'user',
        content: `SYSTEM CORRECTION — your previous response claimed an ongoing/recurring behavior would happen "going forward" without calling a tool that persists it. Specifically these phrases triggered the fabrication guard: ${JSON.stringify(fabricationHits)}. The tools you called this turn (${JSON.stringify(toolsUsed)}) do NOT make any future behavior happen.\n\nRewrite your response. If the owner asked for a recurring action, you have exactly two honest options:\n1. Call create_workflow NOW (in this turn) to actually schedule the recurring action, then describe what you persisted (referencing the user_workflows row).\n2. Explain honestly that you can't modify the hardcoded morning brief, and offer to create a SEPARATE workflow that fires at a similar time. Phrase it as a proposal ("Want me to set up a daily 'X' workflow?"), NOT as a done deal.\n\nDo NOT use phrases like "going forward," "every morning brief will," "locked in," "from here on," "starting tomorrow your brief will include," "baked into," or "now include" unless you can point to a tool call you made this turn that creates the row that makes it true. Retry the response.`,
      });
      const retryResp = await callAnthropic(apiKey, systemPrompt, messages, [], effort);
      accumulate(retryResp.usage);
      const retryTextBlock = retryResp.content.find((b: any) => b.type === 'text');
      if (retryTextBlock?.text) {
        assistantMessage = retryTextBlock.text;
        textBlock = retryTextBlock;
        const retryHits = detectFabrication(assistantMessage);
        if (retryHits.length > 0) {
          // Retry also fabricated — log but let through. Don't infinite-loop.
          console.error(
            `[iris-${surface}] Fabrication guard RETRY ALSO FABRICATED. Phrases: ${JSON.stringify(retryHits)}. Letting through but flagging.`,
          );
        }
      }
    }

    // ───────────────────────────────────────────────────────────────────────
    // AXIS RUNTIME CRITIC — Generator-Critic loop
    //
    // Anthropic Constitutional AI pattern. Haiku 4.5 reads the draft +
    // owner's last message + last 3 turns + tools-used + per-surface
    // rule sheet, returns structured JSON identifying any violations.
    // On HIGH violations, force ONE revision pass with critique as
    // additional system context (NOT injected as user message — preserves
    // trust boundary).
    //
    // Replaces the regex-gate primary defense with bounded language
    // understanding. Regex gates above stay as cheap pre-filters. The
    // critic catches every novel failure shape they miss — the Au7o
    // Traffic recital, the Anthropic charges repetition, the bare
    // "✓ Saved" fake, the buried owner question.
    //
    // Cost: ~$0.001-0.003 per audited reply + ~1-2s latency. Skipped
    // for short acks. Critic failure (network/parse) is non-blocking —
    // ships original draft on failure.
    // ───────────────────────────────────────────────────────────────────────
    try {
      const { critiqueResponse, buildRevisionInstruction, persistCritique } = await import('../../_lib/axis-critic');
      // Trim recent turns for the critic — last 3 user+assistant pairs.
      const histForCritic = (user.conversationHistory ?? [])
        .slice(-6)
        .map((m: any) => ({ role: m.role as 'user' | 'assistant', content: m.content ?? '' }));
      const critique = await critiqueResponse({
        surface: 'iris-chat',
        ownerMessage: text,
        draft: assistantMessage,
        recentTurns: histForCritic,
        toolsUsedThisTurn: toolsUsed,
      });
      accumulate({ input_tokens: critique.tokens_in, output_tokens: critique.tokens_out } as any);
      // Persist EVERY violation (high + medium + low) so the aggregation
      // layer sees full signal, not just revision-triggering ones. Fire-
      // and-forget — never blocks delivery.
      const willRevise = !critique.passes && critique.violations.length > 0;
      void persistCritique({
        tenantPhone: user.phoneNumber,
        surface: 'iris-chat',
        critique,
        sourceMessage: text,
        draft: assistantMessage,
        revisionAttempted: willRevise,
      });
      if (critique.critic_error) {
        console.warn(`[iris-${surface}] Axis critic failed (non-blocking): ${critique.critic_error}`);
      } else if (!critique.passes) {
        const highCount = critique.violations.filter((v) => v.severity === 'high').length;
        console.warn(`[iris-${surface}] Axis flagged ${critique.violations.length} violation(s) (${highCount} high): ${JSON.stringify(critique.violations.map((v) => `${v.severity}:${v.rule}`))}`);
        // ONE revision pass — append critique as additional system
        // prompt content. NOT a fake user message (preserves trust
        // boundary). The model sees its own previous reply in messages
        // and the audit feedback in system, then rewrites.
        const revisionAddendum = buildRevisionInstruction(critique);
        const revisedSystem = `${systemPrompt}${revisionAddendum}`;
        // The conversation already has the draft as the most recent
        // assistant message in iris-brain's loop. Push it explicitly
        // here so the model sees what to revise.
        const revisionMessages = [...messages];
        // The final assistant message from the loop may already be in
        // `messages` (pushed during tool_use iterations). If the LAST
        // entry is the user's tool_results, we need to append the
        // draft so the model has something to revise. Otherwise the
        // assistant content is already there.
        const lastMsg = revisionMessages[revisionMessages.length - 1];
        if (!lastMsg || lastMsg.role !== 'assistant') {
          revisionMessages.push({ role: 'assistant', content: assistantMessage });
        }
        // No tools on revision — the model already gathered evidence;
        // we want a clean rewrite, not more tool calls.
        const retryResp = await callAnthropic(apiKey, revisedSystem, revisionMessages, [], effort, containerId);
        accumulate(retryResp.usage);
        const retryTextBlock = retryResp.content.find((b: any) => b.type === 'text');
        if (retryTextBlock?.text && retryTextBlock.text.trim().length > 0) {
          console.log(`[iris-${surface}] Axis revision: original "${assistantMessage.slice(0, 80)}..." → revised "${retryTextBlock.text.slice(0, 80)}..."`);
          assistantMessage = retryTextBlock.text;
          textBlock = retryTextBlock;
        }
      } else if (critique.violations.length > 0) {
        // Medium/low only — log for tuning, don't revise.
        console.log(`[iris-${surface}] Axis passed with ${critique.violations.length} low/medium note(s).`);
      }
    } catch (err: any) {
      console.warn(`[iris-${surface}] Axis critic exception (non-blocking): ${err?.message ?? String(err)}`);
    }

    // ───────────────────────────────────────────────────────────────────────
    // CODE-GENERATED STATE-CHANGE CONFIRMATIONS
    //
    // For any persisting tool that fired AND populated owner_confirmation,
    // append the canonical string to the response. This runs AFTER the
    // recital stripper and fabrication guard so:
    //   - the model's natural-language reply (potentially containing
    //     "going forward..." prose) stays, BUT
    //   - the canonical confirmation is the load-bearing source of truth
    //     about what actually changed in the DB.
    //
    // Future iterations may substitute rather than append (replacing the
    // model's claim entirely), but appending keeps the rollout reversible
    // and gives us a clean signal to train the model out of duplicate prose.
    // ───────────────────────────────────────────────────────────────────────
    if (ownerConfirmations.length > 0) {
      const block = ownerConfirmations.map((c) => `✓ ${c}`).join('\n');
      // Trim trailing whitespace from the model's text before appending so
      // the divider sits cleanly. If the model's text is empty (rare —
      // would mean it called tools and produced no prose), the
      // confirmations stand alone.
      const trimmed = assistantMessage.trim();
      assistantMessage = trimmed.length > 0
        ? `${trimmed}\n\n${block}`
        : block;
      console.log(`[iris-${surface}] Appended ${ownerConfirmations.length} canonical confirmation(s).`);
    }

    // NOTE: we don't push the assistant message to conversationHistory here.
    // The caller (webhook → sendWhatsAppReply → sendOwnerMessage) appends to
    // conversation_history as the message actually leaves the system. This
    // keeps cron + reactive paths writing through the same code path, so
    // Iris's own outputs (including proactive sends) all land in her
    // memory without duplication.
    await saveUserContext(user);

    // 2026-05-23 — fire-and-forget per-turn ingest into behavioral RAG.
    // The rolling-summary indexer in behavioral-rag-refresh runs every
    // 30 min and loses per-turn fidelity. This inline ingest captures
    // each owner↔Iris exchange as a discrete searchable chunk so
    // recall_behavioral_rag can find specific past corrections /
    // clarifications semantically. Detects correction-class turns via
    // simple owner-language patterns (no/not/wrong/incorrect/that's
    // not + person) so they get the is_correction flag for ranking.
    void (async () => {
      try {
        const { ingestConversationTurn } = await import('../../_lib/behavioral-rag-ingest');
        const isCorrection = /\b(no|not|wrong|incorrect|that'?s not|change|stop|don'?t)\b/i.test(text) &&
          text.length < 300; // short owner messages with negation tend to be corrections
        await ingestConversationTurn({
          tenantPhone: user.phoneNumber,
          userMessage: text,
          assistantMessage,
          isCorrection,
          evidence: isCorrection ? text.slice(0, 200) : undefined,
        });
      } catch (err) {
        console.warn('[iris-brain] inline behavioral-rag ingest failed (non-blocking):', err);
      }
    })();

    const totalTokensIn = uncachedTokensIn + cacheWriteTokensIn + cacheReadTokensIn;
    const cachedPct = totalTokensIn > 0 ? Math.round((cacheReadTokensIn / totalTokensIn) * 100) : 0;
    const costUsd = estimateChatCost(uncachedTokensIn, cacheWriteTokensIn, cacheReadTokensIn, totalTokensOut);
    console.log(
      `[iris-${surface}] effort=${effort} | iters=${iteration} | tokens: ${totalTokensIn}in/${totalTokensOut}out (uncached ${uncachedTokensIn}, write ${cacheWriteTokensIn}, read ${cacheReadTokensIn} — ${cachedPct}% hit) | tools: ${toolsUsed.length} | cost: $${costUsd.toFixed(4)}`,
    );

    // Persist this turn so the dashboard's "usage this month" includes
    // chat costs (which dominate iris-brain workloads).
    void recordChatRun({
      tenantPhone: user.phoneNumber,
      surface,
      modelUsed: SONNET_MODEL,
      iterations: iteration,
      tokensIn: totalTokensIn,
      tokensOut: totalTokensOut,
      cachedTokensIn: cacheReadTokensIn,
      costUsd,
      toolsUsed,
      durationMs: Date.now() - startedAt,
      userMessagePreview: text.slice(0, 200),
      assistantReplyPreview: assistantMessage.slice(0, 200),
    });

    // Owner-disposition mining — Devon's framing: "this should be one
    // of the first things the agent populates to encourage learning the
    // client." Fire-and-forget extractor runs after every owner→Iris
    // turn, looks for disposition signals (corrections, approvals,
    // preferences, frustration triggers, communication-style cues) and
    // upserts them to tenant_disposition_rules. Active rules render in
    // every agent's system prompt next tick — never re-learn the same
    // correction twice. Cold-start mode boosts extraction in the first
    // 30 messages so newly-deployed tenants build up their operating
    // manual fast.
    void (async () => {
      try {
        const { mineDispositionFromTurn, isTenantInColdStart } = await import('../../_lib/disposition-mining');
        const isCold = await isTenantInColdStart(user.phoneNumber);
        // Use the message just BEFORE the user's input as "what they're
        // reacting to". The last assistant message in conversationHistory
        // is the right anchor (we just removed our own assistant push
        // earlier in the universal sendOwnerMessage refactor, so the
        // history reflects what we actually sent).
        const history = (user as any)?.conversationHistory as
          | Array<{ role: string; content: string }>
          | undefined;
        const reversed = (history ?? []).slice().reverse();
        const lastAssistant = reversed.find((m) => m.role === 'assistant')?.content;
        const recentHistory = (history ?? [])
          .slice(-6)
          .map((m) => `${m.role}: ${m.content.slice(0, 200)}`)
          .join('\n');
        await mineDispositionFromTurn({
          tenantPhone: user.phoneNumber,
          ownerMessage: text,
          lastAssistantMessage: lastAssistant,
          recentHistory,
          isColdStart: isCold,
        });
      } catch (err) {
        console.warn(`[iris-${surface}] disposition mining failed (non-blocking):`, err);
      }
    })();

    return assistantMessage;
  } catch (error: any) {
    console.error(`[iris-${surface}] Error:`, error);
    // Surface the actual cause so the owner can see what failed instead of
    // a generic "connection issue" that hides every real bug. Strip stack
    // traces and cap length to keep WhatsApp responses readable. Real
    // network failures still get the user-friendly suffix.
    const msg = (error?.message ?? String(error ?? 'unknown')).toString();
    const short = msg
      .split('\n')[0]!
      .replace(/^Error:\s*/i, '')
      .slice(0, 220);
    const isNetwork = /fetch|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|socket|aborted/i.test(short);
    if (isNetwork) {
      return `Hi ${user.name} — I had a network blip (${short}). Try that again in a moment.`;
    }
    return `Hi ${user.name} — something went wrong: ${short}. Want me to retry, or is this a bug to flag?`;
  }
}

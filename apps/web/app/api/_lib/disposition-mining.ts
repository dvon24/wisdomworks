/**
 * Owner-disposition mining + injection.
 *
 * After every owner→Iris turn, fire an extractor that looks at:
 *   - the owner's most recent message
 *   - the assistant's last message before that (the thing the owner is
 *     reacting TO)
 *   - 3-4 messages of additional context
 *
 * Asks Sonnet for any disposition signals the owner just gave —
 * corrections, approvals, preferences, frustration triggers,
 * communication-style cues. New rules upsert into
 * tenant_disposition_rules; conflicting rules supersede the old.
 *
 * Cold-start emphasis (Devon's framing: "this should be one of the
 * first things the agent populates"): for tenants with <30 messages,
 * we ALSO mine implicit signals from agreement patterns + question
 * styles, not just explicit feedback. After 30 messages the extractor
 * relaxes to explicit-signal-only to avoid over-fitting.
 */

import { redactPII } from '@wisdomworks/shared';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

const COLD_START_MESSAGE_THRESHOLD = 30;

export type DispositionKind =
  | 'correction'
  | 'approval'
  | 'preference'
  | 'frustration_trigger'
  | 'communication_style';

export interface DispositionRule {
  id: string;
  tenant_phone: string;
  kind: DispositionKind;
  rule_text: string;
  why?: string;
  evidence?: string;
  scope: string;
  confidence: number;
  status: 'active' | 'superseded' | 'dismissed';
  applied_count: number;
  last_applied_at?: string | null;
  created_at: string;
}

interface ExtractedRule {
  kind: DispositionKind;
  rule_text: string;
  why?: string;
  evidence?: string;
  scope?: string;
  confidence?: number;
  /** When set, this rule supersedes a prior rule with this canonical id-substring match. */
  supersedes_keyword?: string;
}

// ─── Extraction ───────────────────────────────────────────────────────────

interface ExtractInput {
  tenantPhone: string;
  ownerMessage: string;
  ownerMessageId?: string;
  lastAssistantMessage?: string;
  recentHistory?: string;
  /** Inferred from the tenant's total message count — affects extractor verbosity */
  isColdStart?: boolean;
}

/**
 * Run the disposition extractor against one owner message in context.
 * Fire-and-forget from iris-brain. Never throws — failures are logged.
 *
 * Returns the rules that were actually persisted (for observability).
 */
export async function mineDispositionFromTurn(input: ExtractInput): Promise<ExtractedRule[]> {
  if (!ANTHROPIC_API_KEY) return [];

  const ownerText = (input.ownerMessage ?? '').trim();
  if (ownerText.length < 4) return []; // can't disposition-mine "ok" or "yes"
  // The extractor is most valuable when there's something to react TO.
  // If we have no prior assistant message AND we're past cold-start,
  // skip — owner-only chatter without context produces too many false
  // positives (treats every preference statement as a rule).
  if (!input.lastAssistantMessage && !input.isColdStart) return [];

  const system = `You are an OPERATING-MANUAL miner. Your job: detect when the owner just gave a disposition signal that should become a persistent rule for how every agent works with them.

You're looking at:
1. The owner's most recent message
2. The assistant's prior message (what the owner is reacting to)
3. Recent context

Output STRICT JSON with the rules to persist. EMPTY ARRAY when there's no clear signal — false positives are worse than misses, since rules go into every agent's prompt forever.

{
  "rules": [
    {
      "kind": "correction" | "approval" | "preference" | "frustration_trigger" | "communication_style",
      "rule_text": "The canonical 'always X' / 'never Y' sentence agents will read",
      "why": "1-line explanation tying the rule to what the owner just said",
      "evidence": "Short quote of the owner's exact words (≤200 chars)",
      "scope": "everywhere" | "lane:scheduler" | "lane:finance" | "lane:marketing" | "tool:send_email" | etc,
      "confidence": 0.0-1.0,
      "supersedes_keyword": "optional — short keyword to identify a prior rule this contradicts"
    }
  ]
}

Disposition KINDS:

- correction: Owner says the assistant got something wrong. Examples:
  - "we already sent that yesterday" → never re-remind without checking conversation history
  - "no, it's John not Jonathan" → use "John" for that contact
- approval: Owner gives explicit positive signal on a SPECIFIC pattern. Examples:
  - "perfect, do that for the salon ones too" → repeat the pattern for similar contexts
  - "yes that's exactly the tone" → keep using this tone
  Ignore generic "ok" / "thanks" — those aren't pattern signals.
- preference: Owner states a standing rule. Examples:
  - "always cc Jane on contracts" → add Jane to cc on contract emails
  - "I prefer to handle invoices myself" → don't auto-send invoices, draft only
- frustration_trigger: Owner expresses frustration tied to a specific behavior. Examples:
  - "stop reminding me about that" → don't re-surface this kind of reminder
  - "don't ever post without asking" → require approval for that action
- communication_style: How the owner wants Iris to TALK. Examples:
  - "shorter please" → keep replies under N sentences
  - "skip the intros, just answer" → no preamble in replies
  - "more detail next time" → expand explanations

CRITICAL RULES FOR THE EXTRACTOR:
- If the owner is just answering Iris's question or making a normal request, NOT a disposition signal — return [].
- Don't extract DOMAIN facts (client names, prices, services) — those are knowledge_atoms, not disposition.
- Don't extract one-shot corrections about a specific email — those are lessons_learned. This is for STANDING patterns.
- The rule_text MUST be actionable for any agent reading it ("never X", "always Y", "use tone Z"), not narrative ("the owner mentioned...").
- Set confidence ≥0.8 only when the signal is unambiguous. 0.6-0.7 for plausible signals.${input.isColdStart ? '\n\nCOLD START (owner has <30 messages with the platform): be slightly more aggressive — capture preferences from less-explicit statements. Better to capture and let the owner correct than miss formative signal.' : ''}`;

  const userBlock = [
    input.lastAssistantMessage ? `Iris's last message:\n"${input.lastAssistantMessage.slice(0, 800)}"\n` : '',
    input.recentHistory ? `Recent context:\n${input.recentHistory.slice(0, 1200)}\n` : '',
    `Owner's message just now:\n"${ownerText.slice(0, 800)}"`,
  ].filter(Boolean).join('\n');

  let parsed: { rules?: ExtractedRule[] } = {};
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userBlock }],
      }),
    });
    if (!res.ok) {
      console.warn('[disposition-mine] extractor call failed:', res.status);
      return [];
    }
    const data = await res.json();
    const text = data.content?.[0]?.text ?? '';
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    if (jsonStart < 0 || jsonEnd < jsonStart) return [];
    parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
  } catch (err) {
    console.warn('[disposition-mine] extractor exception:', err);
    return [];
  }

  const candidates = Array.isArray(parsed.rules) ? parsed.rules : [];
  if (candidates.length === 0) return [];

  const persisted: ExtractedRule[] = [];
  for (const c of candidates) {
    if (!c.rule_text || !c.kind) continue;
    const id = await persistRule({
      tenantPhone: input.tenantPhone,
      sourceMessageId: input.ownerMessageId,
      rule: c,
    });
    if (id) persisted.push(c);
  }
  return persisted;
}

async function persistRule(args: {
  tenantPhone: string;
  sourceMessageId?: string;
  rule: ExtractedRule;
}): Promise<string | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const cleanPhone = args.tenantPhone.replace(/[\s\-+()]/g, '');

  // Conflict resolution — if the model flagged a supersedes_keyword,
  // mark matching active rules as superseded BEFORE inserting the new one.
  // Match is substring-OR-word in rule_text (cheap; semantic match could
  // come later via embeddings on rule_text).
  if (args.rule.supersedes_keyword && args.rule.supersedes_keyword.length >= 3) {
    try {
      const kw = args.rule.supersedes_keyword.toLowerCase().slice(0, 80);
      const lookup = await fetch(
        `${SUPABASE_URL}/rest/v1/tenant_disposition_rules?tenant_phone=eq.${cleanPhone}&status=eq.active&kind=eq.${args.rule.kind}&rule_text=ilike.*${encodeURIComponent(kw)}*&select=id`,
        { headers: headers() },
      );
      if (lookup.ok) {
        const olds = await lookup.json();
        for (const old of olds) {
          await fetch(`${SUPABASE_URL}/rest/v1/tenant_disposition_rules?id=eq.${old.id}`, {
            method: 'PATCH',
            headers: { ...headers(), Prefer: 'return=minimal' },
            body: JSON.stringify({ status: 'superseded' }),
          });
        }
      }
    } catch {}
  }

  try {
    // Story 6.5 — `evidence` captures the owner's verbatim words, which
    // often include third-party PII ("always cc jane.smith@acme.com on
    // contracts", "Maria's number is 206-555-..."). Redact before write
    // so PII doesn't sit in tenant_disposition_rules forever. The
    // rule_text is already a model-generalized version and rarely
    // contains PII, but we redact it too for consistency.
    const evidenceRedacted = args.rule.evidence ? redactPII(args.rule.evidence.slice(0, 400)) : null;
    const ruleTextRedacted = redactPII(args.rule.rule_text.slice(0, 600));
    const whyRedacted = args.rule.why ? redactPII(args.rule.why.slice(0, 400)) : null;

    const res = await fetch(`${SUPABASE_URL}/rest/v1/tenant_disposition_rules`, {
      method: 'POST',
      headers: { ...headers(), Prefer: 'return=representation' },
      body: JSON.stringify({
        tenant_phone: cleanPhone,
        kind: args.rule.kind,
        rule_text: ruleTextRedacted.redacted,
        why: whyRedacted?.redacted ?? null,
        evidence: evidenceRedacted?.redacted ?? null,
        scope: args.rule.scope?.slice(0, 100) ?? 'everywhere',
        confidence: typeof args.rule.confidence === 'number'
          ? Math.max(0, Math.min(1, args.rule.confidence))
          : 0.7,
        source_message_id: args.sourceMessageId ?? null,
        status: 'active',
      }),
    });
    if (!res.ok) {
      console.warn('[disposition-mine] persist failed:', await res.text());
      return null;
    }
    const rows = await res.json();
    return rows[0]?.id ?? null;
  } catch (err) {
    console.warn('[disposition-mine] persist exception:', err);
    return null;
  }
}

// ─── Read API ─────────────────────────────────────────────────────────────

export async function listActiveDispositionRules(
  tenantPhone: string,
  limit = 25,
): Promise<DispositionRule[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_disposition_rules?tenant_phone=eq.${cleanPhone}&status=eq.active&order=applied_count.desc,created_at.desc&limit=${limit}&select=*`,
      { headers: headers() },
    );
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export async function dismissDispositionRule(
  tenantPhone: string,
  ruleId: string,
): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false;
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_disposition_rules?id=eq.${ruleId}&tenant_phone=eq.${cleanPhone}`,
      {
        method: 'PATCH',
        headers: { ...headers(), Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'dismissed' }),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Renderer (injection into agent prompts) ─────────────────────────────

/**
 * Build the disposition-rules block for an agent's system prompt.
 * Bumps applied_count on the rules we render so we can sort by what's
 * actually load-bearing in future renders. Fire-and-forget bump.
 *
 * Pass `lane` to scope to lane-specific rules + everywhere rules.
 */
export async function buildDispositionContext(
  tenantPhone: string,
  options: { lane?: string; limit?: number } = {},
): Promise<string> {
  const limit = options.limit ?? 12;
  const rules = await listActiveDispositionRules(tenantPhone, limit * 2);
  if (rules.length === 0) return '';

  // Filter by scope: keep 'everywhere' + matching lane scope
  const filtered = rules.filter((r) => {
    if (r.scope === 'everywhere' || !r.scope) return true;
    if (options.lane && r.scope === `lane:${options.lane}`) return true;
    return false;
  }).slice(0, limit);

  if (filtered.length === 0) return '';

  // Group by kind for readability in the prompt
  const byKind: Record<DispositionKind, DispositionRule[]> = {
    correction: [],
    approval: [],
    preference: [],
    frustration_trigger: [],
    communication_style: [],
  };
  for (const r of filtered) byKind[r.kind].push(r);

  const sections: string[] = [];
  if (byKind.frustration_trigger.length > 0) {
    sections.push('NEVER:\n' + byKind.frustration_trigger.map((r) => `  • ${r.rule_text}`).join('\n'));
  }
  if (byKind.correction.length > 0) {
    sections.push('AVOID REPEATING (owner has corrected):\n' + byKind.correction.map((r) => `  • ${r.rule_text}`).join('\n'));
  }
  if (byKind.preference.length > 0) {
    sections.push('STANDING PREFERENCES:\n' + byKind.preference.map((r) => `  • ${r.rule_text}`).join('\n'));
  }
  if (byKind.approval.length > 0) {
    sections.push('PROVEN PATTERNS (owner has approved):\n' + byKind.approval.map((r) => `  • ${r.rule_text}`).join('\n'));
  }
  if (byKind.communication_style.length > 0) {
    sections.push('TONE / FORMAT:\n' + byKind.communication_style.map((r) => `  • ${r.rule_text}`).join('\n'));
  }

  // Fire-and-forget bump applied_count — never block the prompt build
  void bumpAppliedCount(filtered.map((r) => r.id));

  return `\n\nOPERATING MANUAL FOR THIS OWNER (auto-learned from past interactions — never re-relearn):\n${sections.join('\n\n')}`;
}

async function bumpAppliedCount(ids: string[]): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY || ids.length === 0) return;
  try {
    const cur = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_disposition_rules?id=in.(${ids.join(',')})&select=id,applied_count`,
      { headers: headers() },
    );
    if (!cur.ok) return;
    const rows = await cur.json();
    const now = new Date().toISOString();
    await Promise.all(
      rows.map((r: any) =>
        fetch(`${SUPABASE_URL}/rest/v1/tenant_disposition_rules?id=eq.${r.id}`, {
          method: 'PATCH',
          headers: { ...headers(), Prefer: 'return=minimal' },
          body: JSON.stringify({ applied_count: (r.applied_count ?? 0) + 1, last_applied_at: now }),
        }),
      ),
    );
  } catch {}
}

// ─── Cold-start helper ────────────────────────────────────────────────────

/**
 * Cheap message-count check for cold-start mode. Reads
 * whatsapp_contexts.message_count (already maintained by context-store).
 */
export async function isTenantInColdStart(tenantPhone: string): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false;
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${cleanPhone}&select=message_count&limit=1`,
      { headers: headers() },
    );
    if (!res.ok) return true; // treat unknown tenants as cold-start
    const rows = await res.json();
    const count = rows[0]?.message_count ?? 0;
    return count < COLD_START_MESSAGE_THRESHOLD;
  } catch {
    return true;
  }
}

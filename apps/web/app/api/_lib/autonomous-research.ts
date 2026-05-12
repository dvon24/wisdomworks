/**
 * L3 autonomous research — agents proactively detect knowledge gaps
 * and queue research requests without the owner having to ask.
 *
 * Today's autonomy levels:
 *   L1: Owner-initiated (owner asks Iris to research X)
 *   L2: Agent-requested (Marcus says "I need to know about this"
 *       → Iris researches and folds back)
 *   L3 (this): Agent-detected (no one asked; an agent notices a
 *       recurring topic in conversation + agent runs that the team
 *       doesn't have atoms about, queues research itself, surfaces
 *       to owner via the digest)
 *
 * Cost controls (otherwise this burns through web_search budget fast):
 *   - Daily cap: 2 L3 requests per tenant per day
 *   - Dedup against existing atoms (don't research what we already know)
 *   - Recurring signal required (one mention ≠ a topic worth researching)
 *   - Topic must be domain-relevant (competitor / vendor / regulation /
 *     technology in the owner's stack) — not idle conversation
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const DETECTOR_MODEL = 'claude-sonnet-4-20250514';

const DAILY_L3_CAP = 2;

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

/** Count L3 research requests fired today for this tenant. */
async function countL3Today(tenantPhone: string): Promise<number> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return 0;
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/research_requests?tenant_phone=eq.${cleanPhone}&owner_initiated=eq.false&created_at=gte.${startOfDay.toISOString()}&metadata->>autonomy_level=eq.L3&select=id`,
      { headers: headers() },
    );
    if (!res.ok) return 0;
    const rows = await res.json();
    return rows.length;
  } catch {
    return 0;
  }
}

/** Pull recent context the detector chews on: chat history, agent runs, atoms. */
async function loadDetectorContext(tenantPhone: string): Promise<{
  recentChat: string;
  recentAtomKeywords: Set<string>;
  recentResearchTopics: Set<string>;
}> {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return { recentChat: '', recentAtomKeywords: new Set(), recentResearchTopics: new Set() };
  }
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  try {
    const [ctxRes, atomsRes, researchRes] = await Promise.all([
      fetch(
        `${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${cleanPhone}&select=conversation_history`,
        { headers: headers() },
      ),
      fetch(
        `${SUPABASE_URL}/rest/v1/tenant_knowledge_atoms?tenant_phone=eq.${cleanPhone}&updated_at=gte.${sevenDaysAgo}&select=content&order=updated_at.desc&limit=100`,
        { headers: headers() },
      ),
      fetch(
        `${SUPABASE_URL}/rest/v1/research_requests?tenant_phone=eq.${cleanPhone}&created_at=gte.${ninetyDaysAgo}&select=topic`,
        { headers: headers() },
      ),
    ]);
    const ctxRows = ctxRes.ok ? await ctxRes.json() : [];
    const atomRows = atomsRes.ok ? await atomsRes.json() : [];
    const researchRows = researchRes.ok ? await researchRes.json() : [];

    // Compress recent chat to last 25 turns, owner-side only
    const history = (ctxRows[0]?.conversation_history ?? []) as Array<{ role: string; content: string }>;
    const recentChat = history
      .filter((m) => m.role === 'user')
      .slice(-25)
      .map((m) => `- ${m.content.slice(0, 200)}`)
      .join('\n');

    // Build a keyword set from existing atoms (rough — used by the
    // detector to know what's already known)
    const recentAtomKeywords = new Set<string>();
    for (const a of atomRows) {
      const words = (a.content as string).toLowerCase().match(/\b[a-z]{4,}\b/g) ?? [];
      for (const w of words) recentAtomKeywords.add(w);
    }

    const recentResearchTopics = new Set<string>(
      researchRows.map((r: any) => (r.topic as string).toLowerCase()),
    );

    return { recentChat, recentAtomKeywords, recentResearchTopics };
  } catch {
    return { recentChat: '', recentAtomKeywords: new Set(), recentResearchTopics: new Set() };
  }
}

/** Ask the model to identify research-worthy topics from recent activity. */
async function detectResearchTopics(input: {
  recentChat: string;
  existingAtomKeywords: string[];
  alreadyResearched: string[];
}): Promise<Array<{ topic: string; why: string; kind: string }>> {
  if (!ANTHROPIC_API_KEY) return [];
  if (!input.recentChat.trim()) return [];

  const prompt = `You are a research-prioritization agent for a business owner.

RECENT OWNER MESSAGES (last week):
${input.recentChat}

ALREADY-KNOWN KEYWORDS (we already have facts about these):
${input.existingAtomKeywords.slice(0, 60).join(', ')}

ALREADY-RESEARCHED TOPICS (don't re-research):
${input.alreadyResearched.slice(0, 30).join('\n  - ')}

TASK: Identify up to 2 RECURRING topics from the owner's recent messages that:
1. Show up MULTIPLE times (one-offs don't count)
2. Aren't already in the known-keywords list
3. Aren't already researched
4. Are domain-relevant: competitors, vendors, regulations, technologies in their stack, market shifts. NOT idle conversation, personal life, or one-time questions.
5. Would meaningfully inform a decision they're trying to make

If nothing qualifies, return an empty array. Better to skip than waste owner attention.

Return JSON ONLY:
[
  { "topic": "specific researchable phrase (e.g. 'GoHighLevel pricing changes 2026' not 'GHL')",
    "why": "1 sentence explanation — what about the owner's messages signals this needs research",
    "kind": "competitor_analysis" | "vendor_research" | "regulation" | "technology" | "market_trend" }
]`;

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: DETECTOR_MODEL,
        max_tokens: 600,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) {
      console.warn('[autonomous-research] detector call failed:', res.status);
      return [];
    }
    const data = await res.json();
    const text = data.content?.[0]?.text ?? '[]';
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed) ? parsed.filter((p: any) => p?.topic && p?.why).slice(0, 2) : [];
  } catch (err) {
    console.warn('[autonomous-research] detector exception:', err);
    return [];
  }
}

/** Run the L3 detector for one tenant. Returns count of research requests
 *  queued (each will be processed by Iris's orchestrator tick). */
export async function runL3Detector(tenantPhone: string): Promise<{ queued: number; reason?: string }> {
  const usedToday = await countL3Today(tenantPhone);
  if (usedToday >= DAILY_L3_CAP) {
    return { queued: 0, reason: `L3 daily cap (${DAILY_L3_CAP}) reached` };
  }

  const ctx = await loadDetectorContext(tenantPhone);
  const candidates = await detectResearchTopics({
    recentChat: ctx.recentChat,
    existingAtomKeywords: Array.from(ctx.recentAtomKeywords),
    alreadyResearched: Array.from(ctx.recentResearchTopics),
  });

  if (candidates.length === 0) return { queued: 0 };

  // Queue them as research_requests with autonomy_level=L3 stamped on metadata
  let queued = 0;
  const { enqueueResearch } = await import('./research');
  for (const c of candidates.slice(0, DAILY_L3_CAP - usedToday)) {
    try {
      const result = await enqueueResearch({
        tenantPhone,
        topic: c.topic,
        reason: `L3 autonomous detection: ${c.why}`,
        kind: (c.kind as any) ?? 'general',
        requestingAgentName: 'L3-detector',
        ownerInitiated: false,
      });
      if (result.id) {
        // Stamp metadata so countL3Today can identify these later
        if (SUPABASE_URL && SUPABASE_KEY) {
          try {
            await fetch(`${SUPABASE_URL}/rest/v1/research_requests?id=eq.${result.id}`, {
              method: 'PATCH',
              headers: { ...headers(), Prefer: 'return=minimal' },
              body: JSON.stringify({ metadata: { autonomy_level: 'L3', detection_reason: c.why } }),
            });
          } catch {}
        }
        queued++;
      }
    } catch (err) {
      console.warn('[autonomous-research] enqueue failed:', err);
    }
  }

  return { queued };
}

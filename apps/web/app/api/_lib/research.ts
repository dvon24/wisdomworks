/**
 * Phase 2 — Research / competitive intelligence.
 *
 * Agents call request_research(topic, why) to queue an investigation.
 * Iris (or any orchestrator) picks it up on her tick, calls Anthropic's
 * web_search tool to do the actual research, then synthesizes a brief that
 * lands in the notification queue as a high-severity item.
 *
 * Rate-limited per tenant (5 searches/day for agent-initiated; unlimited
 * for owner-initiated when Devon directly asks).
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
const TAVILY_URL = 'https://api.tavily.com/search';

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

export type ResearchKind = 'competitor_analysis' | 'market_research' | 'best_practices' | 'fact_check' | 'general';
export type ResearchStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'declined';

const DAILY_SEARCH_CAP = 5; // per tenant for agent-initiated

export interface ResearchRequest {
  id: string;
  tenant_phone: string;
  requesting_agent_instance_id: string | null;
  requesting_agent_name: string | null;
  topic: string;
  reason: string | null;
  kind: ResearchKind;
  status: ResearchStatus;
  result_summary: string | null;
  result_brief: any;
  searches_used: number;
  tokens_used: number;
  owner_initiated: boolean;
  error: string | null;
  created_at: string;
  metadata: any;
}

// ─── Queue helpers ────────────────────────────────────────────────────────

export async function enqueueResearch(args: {
  tenantPhone: string;
  topic: string;
  reason?: string;
  kind?: ResearchKind;
  requestingAgentInstanceId?: string;
  requestingAgentName?: string;
  ownerInitiated?: boolean;
}): Promise<{ id?: string; deferred?: boolean; reason?: string }> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { reason: 'supabase not configured' };

  // Rate-limit check (agent-initiated only)
  if (!args.ownerInitiated) {
    try {
      const capRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/searches_today`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ p_tenant_phone: args.tenantPhone }),
      });
      if (capRes.ok) {
        const used = parseInt((await capRes.text()).trim(), 10) || 0;
        if (used >= DAILY_SEARCH_CAP) {
          return { deferred: true, reason: `daily search cap reached (${used}/${DAILY_SEARCH_CAP})` };
        }
      }
    } catch {
      // ignore — fail open if cap check breaks
    }
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/research_requests`, {
      method: 'POST',
      headers: { ...headers(), Prefer: 'return=representation' },
      body: JSON.stringify({
        tenant_phone: args.tenantPhone,
        topic: args.topic.slice(0, 500),
        reason: args.reason?.slice(0, 500) ?? null,
        kind: args.kind ?? 'general',
        requesting_agent_instance_id: args.requestingAgentInstanceId ?? null,
        requesting_agent_name: args.requestingAgentName ?? null,
        owner_initiated: !!args.ownerInitiated,
        status: 'pending',
      }),
    });
    if (!res.ok) {
      console.warn('[research] enqueue failed:', await res.text());
      return { reason: `Supabase ${res.status}` };
    }
    const rows = await res.json();
    return { id: rows[0]?.id };
  } catch (err: any) {
    return { reason: err?.message ?? String(err) };
  }
}

export async function loadPendingResearch(tenantPhone: string, limit = 3): Promise<ResearchRequest[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/research_requests?tenant_phone=eq.${tenantPhone}&status=eq.pending&order=created_at.asc&limit=${limit}&select=*`,
      { headers: headers() },
    );
    return res.ok ? await res.json() : [];
  } catch {
    return [];
  }
}

async function markStatus(id: string, fields: Partial<{ status: ResearchStatus; result_summary: string; result_brief: any; searches_used: number; tokens_used: number; error: string; started_at: string; completed_at: string; surfaced_in_notification_id: string | null }>): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  await fetch(`${SUPABASE_URL}/rest/v1/research_requests?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...headers(), Prefer: 'return=minimal' },
    body: JSON.stringify(fields),
  });
}

// ─── Research execution via Anthropic's web_search tool ───────────────────

export interface ResearchBrief {
  topic: string;
  kind: ResearchKind;
  summary: string;
  key_findings: string[];
  sources: { url: string; title?: string }[];
  recommendations: string[];
  confidence: number;
}

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score?: number;
  published_date?: string;
}

interface TavilyResponse {
  query: string;
  answer?: string;
  results: TavilyResult[];
  response_time?: number;
}

/**
 * Call Tavily Search API. Tavily is purpose-built for AI agents — returns
 * pre-cleaned text content + an optional synthesized answer. We use
 * search_depth='advanced' which does multi-query internally for richer
 * results on a single call.
 */
async function tavilySearch(query: string, opts?: { depth?: 'basic' | 'advanced'; maxResults?: number; includeDomains?: string[] }): Promise<{ results: TavilyResult[]; answer?: string; error?: string }> {
  if (!TAVILY_API_KEY) return { results: [], error: 'TAVILY_API_KEY not set' };
  try {
    const res = await fetch(TAVILY_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TAVILY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        search_depth: opts?.depth ?? 'advanced',
        max_results: opts?.maxResults ?? 8,
        include_answer: true,
        include_raw_content: false,
        include_domains: opts?.includeDomains,
      }),
    });
    if (!res.ok) {
      return { results: [], error: `Tavily ${res.status}: ${(await res.text()).slice(0, 200)}` };
    }
    const data: TavilyResponse = await res.json();
    return { results: data.results ?? [], answer: data.answer };
  } catch (err: any) {
    return { results: [], error: err?.message ?? String(err) };
  }
}

/**
 * Run research using Anthropic's native web_search tool (preferred when
 * admin-enabled in the Claude Console — one API call, native citations).
 * Tool version: web_search_20250305 (basic, no dynamic filtering).
 */
async function runResearchAnthropicNative(req: { topic: string; reason?: string; kind: ResearchKind; ownerContext?: string }): Promise<{ brief: ResearchBrief | null; searchesUsed: number; tokensUsed: number; error?: string }> {
  const kindGuidance: Record<ResearchKind, string> = {
    competitor_analysis: "Identify what they do well, what they're missing, and what WisdomWorks (a mobile-first AI agent platform for non-desk workers — solo electricians, restaurant owners, side-hustle founders, NOT Slack/Teams users) should do differently. Surface their pricing model, their wedge, one specific thing to adopt, one to reject.",
    market_research: 'Capture the current state of the market: players, sizes if available, what users actually want, recent shifts. Specific numbers and dates.',
    best_practices: 'Pull the most cited / well-evidenced practices in this area. Prefer 2024+ sources.',
    fact_check: 'Verify the specific claim against the sources. Note disagreement if sources conflict.',
    general: 'Investigate the topic and produce a structured brief grounded in concrete sources.',
  };

  const system = `You are a senior research analyst working for the owner of WisdomWorks (a mobile-first AI agent platform for non-desk workers). Search the web (1-3 times max) and synthesize a structured JSON brief.

Topic kind: ${req.kind}
Guidance: ${kindGuidance[req.kind]}
${req.ownerContext ? `\nOwner context: ${req.ownerContext}` : ''}

After your searches, return ONLY a JSON object in this exact shape:
{
  "summary": "2-3 sentences capturing the essence.",
  "key_findings": ["5-8 specific factual findings, each one sentence"],
  "sources": [{ "url": "https://...", "title": "..." }],
  "recommendations": ["2-4 concrete action items grounded in WisdomWorks' mobile-first non-desk wedge"],
  "confidence": 0.0-1.0
}

Hard rules:
- Search no more than 3 times.
- Every key_finding must come from search results, not training data.
- Recommendations must align with WisdomWorks' wedge (mobile-first, non-desk workers). Reject anything like "build a Slack integration" or "target enterprise teams."
- Return ONLY the JSON. No markdown fences. No commentary.`;

  const userPrompt = `Topic: ${req.topic}${req.reason ? `\nWhy: ${req.reason}` : ''}`;

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { brief: null, searchesUsed: 0, tokensUsed: 0, error: `Anthropic native ${res.status}: ${errText.slice(0, 300)}` };
    }

    const data = await res.json();
    const content: any[] = data.content ?? [];
    const searchesUsed = data.usage?.server_tool_use?.web_search_requests ?? content.filter((c) => c.type === 'server_tool_use' && c.name === 'web_search').length;

    const finalText = content.filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
    const jsonMatch = finalText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { brief: null, searchesUsed, tokensUsed: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0), error: 'No JSON in Anthropic native response' };
    }
    const parsed = JSON.parse(jsonMatch[0]);
    const brief: ResearchBrief = {
      topic: req.topic,
      kind: req.kind,
      summary: stripCitations(String(parsed.summary ?? '')).slice(0, 1000),
      key_findings: Array.isArray(parsed.key_findings) ? parsed.key_findings.map((f: any) => stripCitations(String(f))).slice(0, 12) : [],
      sources: Array.isArray(parsed.sources) ? parsed.sources.slice(0, 10) : [],
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations.map((r: any) => stripCitations(String(r))).slice(0, 6) : [],
      confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
    };
    return { brief, searchesUsed, tokensUsed: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0) };
  } catch (err: any) {
    return { brief: null, searchesUsed: 0, tokensUsed: 0, error: err?.message ?? String(err) };
  }
}

/** Strip Anthropic web_search inline citation tags. Audit trail is kept
 * in the original sources[] array; the display text shouldn't have raw
 * `<cite index="...">...</cite>` markers. */
function stripCitations(text: string): string {
  return text
    .replace(/<cite\s+index="[^"]*">/gi, '')
    .replace(/<\/cite>/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Run a research query. Provider preference:
 *   1. Anthropic native web_search (preferred — no extra API key, native citations)
 *   2. Tavily fallback (if TAVILY_API_KEY set and Anthropic native fails)
 *
 * To use Anthropic native: enable web search in the Claude Console (admin action).
 * To use Tavily: set TAVILY_API_KEY env var (free tier 1000 searches/mo).
 */
export async function runResearch(req: { topic: string; reason?: string; kind: ResearchKind; ownerContext?: string }): Promise<{ brief: ResearchBrief | null; searchesUsed: number; tokensUsed: number; error?: string }> {
  if (!ANTHROPIC_API_KEY) return { brief: null, searchesUsed: 0, tokensUsed: 0, error: 'ANTHROPIC_API_KEY not set' };

  // Try Anthropic native first
  const native = await runResearchAnthropicNative(req);
  if (native.brief) return native;

  // If native failed AND Tavily is configured, fall back. Otherwise return
  // the native error so the user knows to enable web search in the Console.
  if (!TAVILY_API_KEY) {
    return {
      brief: null,
      searchesUsed: 0,
      tokensUsed: native.tokensUsed,
      error: `${native.error ?? 'Anthropic native web_search failed'}. Either enable Web search in Claude Console (claude.com/settings → tools), OR set TAVILY_API_KEY env var (free tier at tavily.com).`,
    };
  }

  console.log(`[research] Anthropic native failed (${native.error}); falling back to Tavily`);

  // 1. Search the web via Tavily
  const search = await tavilySearch(req.topic, { depth: 'advanced', maxResults: 8 });
  if (search.error) return { brief: null, searchesUsed: 0, tokensUsed: 0, error: search.error };
  if (search.results.length === 0) {
    return {
      brief: {
        topic: req.topic,
        kind: req.kind,
        summary: 'No relevant results found for this query.',
        key_findings: [],
        sources: [],
        recommendations: ['Try a more specific search query, or verify the topic is publicly indexed.'],
        confidence: 0.1,
      },
      searchesUsed: 1,
      tokensUsed: 0,
    };
  }

  // 2. Synthesize via Sonnet
  const kindGuidance: Record<ResearchKind, string> = {
    competitor_analysis: "Identify what they do well, what they're missing, and what WisdomWorks (a mobile-first AI agent platform for non-desk workers — solo electricians, restaurant owners, side-hustle founders, NOT Slack/Teams users) should do differently. Surface their pricing model, their wedge, and one specific feature/positioning to adopt and one to reject.",
    market_research: 'Capture the current state of the market: players, sizes if available, what users actually want, recent shifts. Be specific with numbers and dates.',
    best_practices: 'Pull the most cited / well-evidenced practices in this area. Prefer 2024+ sources.',
    fact_check: 'Verify the specific claim against the sources. Note disagreement if sources conflict.',
    general: 'Investigate the topic and produce a structured brief grounded in concrete sources.',
  };

  const sourcesBlock = search.results.map((r, i) =>
    `[${i + 1}] ${r.title}\n    URL: ${r.url}\n    Content: ${r.content.slice(0, 600)}`,
  ).join('\n\n');

  const tavilyAnswer = search.answer ? `\nTAVILY'S AUTO-ANSWER (use as a starting point, verify against sources):\n${search.answer}\n` : '';

  const system = `You are a senior research analyst working for the owner of WisdomWorks (a mobile-first AI agent platform for non-desk workers). Synthesize the web search results below into a structured brief.

Topic kind: ${req.kind}
Guidance: ${kindGuidance[req.kind]}
${req.ownerContext ? `\nOwner context: ${req.ownerContext}` : ''}

Return ONLY a JSON object in this exact shape, no preamble:

{
  "summary": "2-3 sentences capturing the essence of what you found.",
  "key_findings": ["5-8 specific factual findings, each one sentence, each citable to a source in the results"],
  "sources": [{ "url": "https://...", "title": "..." }],
  "recommendations": ["2-4 concrete action items grounded in WisdomWorks' wedge (mobile-first, non-desk workers). For competitor_analysis: one to adopt, one to reject."],
  "confidence": 0.0-1.0
}

Hard rules:
- Every key_finding must be grounded in a result below — no hallucinations.
- Recommendations must align with WisdomWorks' mobile-first non-desk wedge. Reject anything that says "build a Slack integration" or "target enterprise teams."
- If the results are sparse or off-topic, set confidence < 0.5 and say so in summary.
- Return ONLY the JSON. No markdown fences. No commentary.`;

  const userPrompt = `Topic: ${req.topic}${req.reason ? `\nWhy: ${req.reason}` : ''}\n\nWEB SEARCH RESULTS (${search.results.length}):\n${sourcesBlock}${tavilyAnswer}`;

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { brief: null, searchesUsed: 1, tokensUsed: 0, error: `Anthropic ${res.status}: ${errText.slice(0, 300)}` };
    }

    const data = await res.json();
    const content: any[] = data.content ?? [];
    const finalText = content.filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
    const jsonMatch = finalText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { brief: null, searchesUsed: 1, tokensUsed: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0), error: 'No JSON in synthesis response' };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const brief: ResearchBrief = {
      topic: req.topic,
      kind: req.kind,
      summary: String(parsed.summary ?? '').slice(0, 1000),
      key_findings: Array.isArray(parsed.key_findings) ? parsed.key_findings.map(String).slice(0, 12) : [],
      sources: Array.isArray(parsed.sources) && parsed.sources.length > 0
        ? parsed.sources.slice(0, 10)
        // Fall back to Tavily's results if the model didn't echo sources back
        : search.results.slice(0, 5).map((r) => ({ url: r.url, title: r.title })),
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations.map(String).slice(0, 6) : [],
      confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
    };

    return {
      brief,
      searchesUsed: 1,
      tokensUsed: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
    };
  } catch (err: any) {
    return { brief: null, searchesUsed: 1, tokensUsed: 0, error: err?.message ?? String(err) };
  }
}

/**
 * Process one pending research request end-to-end: mark in_progress,
 * run the research, store the brief, enqueue an approval-queue
 * notification, mark completed (or failed).
 *
 * Pass skipEnqueue=true when the caller is delivering the brief inline
 * (e.g. owner-initiated WhatsApp request). Otherwise the digest cron
 * picks the same brief up and double-sends it.
 */
export async function processResearchRequest(
  req: ResearchRequest,
  opts: { ownerContext?: string; skipEnqueue?: boolean } = {},
): Promise<{ ok: boolean; brief?: ResearchBrief; error?: string }> {
  await markStatus(req.id, { status: 'in_progress', started_at: new Date().toISOString() });

  const result = await runResearch({
    topic: req.topic,
    reason: req.reason ?? undefined,
    kind: req.kind,
    ownerContext: opts.ownerContext,
  });

  if (!result.brief) {
    await markStatus(req.id, {
      status: 'failed',
      error: result.error ?? 'unknown',
      searches_used: result.searchesUsed,
      tokens_used: result.tokensUsed,
      completed_at: new Date().toISOString(),
    });
    return { ok: false, error: result.error };
  }

  let notifId: string | null = null;
  if (!opts.skipEnqueue) {
    // Enqueue an approval-queue notification with the brief — only when
    // delivery is NOT happening inline (background path: agent-initiated
    // research that completes between owner messages).
    const { enqueueNotification } = await import('./notifications');
    const bodyLines = [
      result.brief.summary,
      '',
      'KEY FINDINGS:',
      ...result.brief.key_findings.map((f) => `• ${f}`),
      '',
      'RECOMMENDATIONS:',
      ...result.brief.recommendations.map((r) => `→ ${r}`),
      '',
      `Sources: ${result.brief.sources.slice(0, 3).map((s) => s.url).join(', ')}${result.brief.sources.length > 3 ? ` +${result.brief.sources.length - 3} more` : ''}`,
      `Confidence: ${Math.round(result.brief.confidence * 100)}%`,
    ];

    notifId = await enqueueNotification({
      tenantPhone: req.tenant_phone,
      kind: 'agent_observation',
      severity: result.brief.confidence >= 0.7 ? 'high' : 'medium',
      title: `Research: ${req.topic.slice(0, 80)}`,
      body: bodyLines.join('\n').slice(0, 1000),
      sourceAgent: req.requesting_agent_name ?? 'Iris',
      sourceId: req.id,
      metadata: { brief: result.brief, requesting_agent: req.requesting_agent_name },
    });
  }

  await markStatus(req.id, {
    status: 'completed',
    result_summary: result.brief.summary,
    result_brief: result.brief,
    searches_used: result.searchesUsed,
    tokens_used: result.tokensUsed,
    surfaced_in_notification_id: notifId,
    completed_at: new Date().toISOString(),
  });

  return { ok: true, brief: result.brief };
}

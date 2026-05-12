/**
 * Phase 2 — Research / competitive intelligence.
 *
 * Agents call request_research(topic, why) to queue an investigation.
 * Sophia (or any orchestrator) picks it up on her tick, calls Anthropic's
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

/**
 * Run a single research query using Anthropic's web_search tool. Returns
 * a structured brief or null on failure. The model decides whether to
 * search and how many times — we cap at 3 searches per request.
 */
export async function runResearch(req: { topic: string; reason?: string; kind: ResearchKind; ownerContext?: string }): Promise<{ brief: ResearchBrief | null; searchesUsed: number; tokensUsed: number; error?: string }> {
  if (!ANTHROPIC_API_KEY) return { brief: null, searchesUsed: 0, tokensUsed: 0, error: 'ANTHROPIC_API_KEY not set' };

  const kindGuidance: Record<ResearchKind, string> = {
    competitor_analysis: 'Look up the competitor\'s site + pricing + positioning + reviews. Identify what they do well, what they\'re missing, and what we (WisdomWorks — an AI agent platform for non-desk workers on WhatsApp/mobile, NOT Slack/Teams) should do differently.',
    market_research: 'Find the current state of the market, who the players are, what users actually want, what\'s shifting. Be specific with numbers and dates where possible.',
    best_practices: 'Find the most cited / well-evidenced practices in this area. Cite sources. Prefer recent (2024+).',
    fact_check: 'Verify a specific claim. Cite the source. Note disagreement if sources conflict.',
    general: 'Investigate the topic and produce a structured brief.',
  };

  const system = `You are a senior research analyst working for the owner of WisdomWorks (a mobile-first AI agent platform). Your job is to research the topic below, using web_search 1-3 times maximum, then produce a structured JSON brief.

Topic kind: ${req.kind}
Guidance: ${kindGuidance[req.kind]}
${req.ownerContext ? `\nOwner context: ${req.ownerContext}` : ''}

After your searches, return ONLY a JSON object in this exact shape:

{
  "summary": "2-3 sentences capturing the essence of what you found.",
  "key_findings": ["5-8 specific factual findings, each one sentence, each citing a source if applicable"],
  "sources": [{ "url": "https://...", "title": "..." }],
  "recommendations": ["2-4 concrete action items for the owner based on the findings"],
  "confidence": 0.0-1.0
}

Hard rules:
- Search no more than 3 times.
- Recommendations must be specific to WisdomWorks' wedge (mobile-first, non-desk workers, WhatsApp). Don't recommend things that contradict that positioning.
- If you can't find enough info, set confidence < 0.5 and say so in summary.
- Return ONLY the JSON, no preamble or markdown fences.`;

  const userPrompt = `Research: ${req.topic}${req.reason ? `\n\nWhy this matters: ${req.reason}` : ''}`;

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
        tools: [{
          type: 'web_search_20250915',
          name: 'web_search',
          max_uses: 3,
        }],
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { brief: null, searchesUsed: 0, tokensUsed: 0, error: `Anthropic ${res.status}: ${errText.slice(0, 300)}` };
    }

    const data = await res.json();
    const content: any[] = data.content ?? [];

    // Count tool uses to track search budget
    const searchesUsed = content.filter((c) => c.type === 'tool_use' && c.name === 'web_search').length;

    // Final text block is the JSON brief
    const finalText = content.filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
    const jsonMatch = finalText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { brief: null, searchesUsed, tokensUsed: data.usage?.input_tokens + data.usage?.output_tokens || 0, error: 'No JSON in response' };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const brief: ResearchBrief = {
      topic: req.topic,
      kind: req.kind,
      summary: String(parsed.summary ?? '').slice(0, 1000),
      key_findings: Array.isArray(parsed.key_findings) ? parsed.key_findings.map(String).slice(0, 12) : [],
      sources: Array.isArray(parsed.sources) ? parsed.sources.slice(0, 10) : [],
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations.map(String).slice(0, 6) : [],
      confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
    };

    return {
      brief,
      searchesUsed,
      tokensUsed: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
    };
  } catch (err: any) {
    return { brief: null, searchesUsed: 0, tokensUsed: 0, error: err?.message ?? String(err) };
  }
}

/**
 * Process one pending research request end-to-end: mark in_progress,
 * run the research, store the brief, enqueue an approval-queue
 * notification, mark completed (or failed).
 */
export async function processResearchRequest(req: ResearchRequest, ownerContext?: string): Promise<{ ok: boolean; brief?: ResearchBrief; error?: string }> {
  await markStatus(req.id, { status: 'in_progress', started_at: new Date().toISOString() });

  const result = await runResearch({
    topic: req.topic,
    reason: req.reason ?? undefined,
    kind: req.kind,
    ownerContext,
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

  // Enqueue an approval-queue notification with the brief
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

  const notifId = await enqueueNotification({
    tenantPhone: req.tenant_phone,
    kind: 'agent_observation',
    severity: result.brief.confidence >= 0.7 ? 'high' : 'medium',
    title: `Research: ${req.topic.slice(0, 80)}`,
    body: bodyLines.join('\n').slice(0, 1000),
    sourceAgent: req.requesting_agent_name ?? 'Sophia',
    sourceId: req.id,
    metadata: { brief: result.brief, requesting_agent: req.requesting_agent_name },
  });

  await markStatus(req.id, {
    status: 'completed',
    result_summary: result.brief.summary,
    result_brief: result.brief,
    searches_used: result.searchesUsed,
    tokens_used: result.tokensUsed,
    surfaced_in_notification_id: notifId ?? null,
    completed_at: new Date().toISOString(),
  });

  return { ok: true, brief: result.brief };
}

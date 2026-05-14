/**
 * Story 2.9 FR17 — Career development opportunities.
 *
 * For each tenant, periodically:
 *   1. Pull the user's role/department context (from ontology_entities +
 *      knowledge_atoms).
 *   2. Pull KB chunks tagged as capabilities the org has documented.
 *   3. Ask Sonnet for 0-2 SPECIFIC career-development opportunities that
 *      connect the user's current role to one of those capabilities —
 *      "you've been doing X; the org needs Y; here's a path."
 *   4. Enqueue as low-severity notifications so they ride the next digest.
 *
 * Dedup: each opportunity carries the source capability_id + role as the
 * notification's topicKeywords, so the enqueueNotification pre-flight
 * silently drops re-pings on opportunities the owner already addressed.
 *
 * Cadence: weekly (Mondays). The cron runs daily but only fires per
 * tenant if last_career_scan_at is ≥7 days old. Career-dev nudges are
 * meant to feel rare and intentional, not chatty.
 */

import { enqueueNotification } from './notifications';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

const CADENCE_DAYS = 7;

interface CareerOpportunity {
  title: string;
  rationale: string;
  source_capability: string;
  confidence: number;
  next_step: string;
}

/**
 * Pull a thin tenant snapshot — the user's apparent role + the
 * organization's documented capabilities. We don't need full RAG here
 * since we want a curated view, not retrieval.
 */
async function loadTenantCareerContext(tenantPhone: string): Promise<{
  role: string;
  industry: string;
  businessName: string;
  capabilities: string[];
  recentAtoms: string;
} | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');

  let role = 'owner';
  let industry = '';
  let businessName = 'the business';
  try {
    const ctxRes = await fetch(
      `${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${cleanPhone}&select=business_name,business_type,profile`,
      { headers: headers() },
    );
    if (ctxRes.ok) {
      const rows = await ctxRes.json();
      const r = rows[0];
      if (r) {
        businessName = r.business_name ?? businessName;
        industry = r.business_type ?? '';
        role = r.profile?.preferences?.role ?? role;
      }
    }
  } catch {}

  // Pull capability-typed entities the org has documented. These are the
  // "what we'd like to grow into" slots that pair naturally with a
  // career-dev nudge.
  let capabilities: string[] = [];
  try {
    const capRes = await fetch(
      `${SUPABASE_URL}/rest/v1/ontology_entities?tenant_phone=eq.${cleanPhone}&entity_type=eq.capability&select=name,metadata&limit=30`,
      { headers: headers() },
    );
    if (capRes.ok) {
      const rows = await capRes.json();
      capabilities = rows.map((r: any) => r.name).filter(Boolean);
    }
  } catch {}

  // Last 10 atoms give Sonnet context on what the user has been doing
  let recentAtoms = '';
  try {
    const atomsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/knowledge_atoms?tenant_phone=eq.${cleanPhone}&order=created_at.desc&limit=10&select=kind,title,summary`,
      { headers: headers() },
    );
    if (atomsRes.ok) {
      const atoms = await atomsRes.json();
      recentAtoms = atoms.map((a: any) => `- [${a.kind}] ${a.title}${a.summary ? `: ${a.summary.slice(0, 120)}` : ''}`).join('\n');
    }
  } catch {}

  return { role, industry, businessName, capabilities, recentAtoms };
}

/**
 * Ask Sonnet for 0-2 concrete career-development opportunities. JSON-only
 * output. Conservative — returns [] when there's nothing real to surface
 * rather than inventing growth opportunities that aren't grounded in
 * the user's actual work or the org's documented capabilities.
 */
async function generateOpportunities(
  ctx: NonNullable<Awaited<ReturnType<typeof loadTenantCareerContext>>>,
): Promise<CareerOpportunity[]> {
  if (!ANTHROPIC_API_KEY) return [];
  if (ctx.capabilities.length === 0 && !ctx.recentAtoms) return [];

  const system = `You are a career-development advisor for ${ctx.businessName} (${ctx.industry || 'small business'}). The user's current apparent role is "${ctx.role}". Propose 0-2 SPECIFIC career-development opportunities that connect what the user has been doing recently to one of the organization's documented capabilities. Be conservative — return [] if you can't ground both halves of the connection in concrete signal.

Output STRICT JSON:
{
  "opportunities": [
    {
      "title": "Short 5-12 word label",
      "rationale": "1-2 sentences explaining the connection between recent work and the capability",
      "source_capability": "The exact capability name this maps to",
      "confidence": 0.0-1.0,
      "next_step": "ONE concrete action they could take this week — not 'consider learning X' but a specific small action"
    }
  ]
}

Rules:
- 0-2 opportunities max. Quality > quantity.
- confidence ≥0.7 if both the role signal and capability are concrete.
- next_step must be doable in <30min — not "take a course" or "find a mentor."
- If the signals are too thin, return {"opportunities": []}.`;

  const userBlock = `Documented capabilities:\n${ctx.capabilities.length > 0 ? ctx.capabilities.map((c) => `- ${c}`).join('\n') : '(none documented)'}\n\nRecent activity:\n${ctx.recentAtoms || '(no recent signal)'}`;

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userBlock }],
      }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const text = data.content?.[0]?.text ?? '';
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    if (jsonStart < 0 || jsonEnd < jsonStart) return [];
    const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
    return (parsed.opportunities ?? []).slice(0, 2).map((o: any): CareerOpportunity => ({
      title: String(o.title ?? '').slice(0, 200),
      rationale: String(o.rationale ?? '').slice(0, 600),
      source_capability: String(o.source_capability ?? '').slice(0, 200),
      confidence: typeof o.confidence === 'number' ? Math.max(0, Math.min(1, o.confidence)) : 0.5,
      next_step: String(o.next_step ?? '').slice(0, 300),
    })).filter((o: CareerOpportunity) => o.title && o.next_step);
  } catch (err) {
    console.warn('[career-dev] generation failed:', err);
    return [];
  }
}

/**
 * Has this tenant been scanned in the last CADENCE_DAYS? Stored on
 * whatsapp_contexts.profile.last_career_scan_at to avoid a new table.
 */
async function wasScannedRecently(tenantPhone: string): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false;
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${cleanPhone}&select=profile`,
      { headers: headers() },
    );
    if (!res.ok) return false;
    const rows = await res.json();
    const last = rows[0]?.profile?.last_career_scan_at;
    if (!last) return false;
    return Date.now() - new Date(last).getTime() < CADENCE_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

async function markScanned(tenantPhone: string): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${cleanPhone}&select=profile`,
      { headers: headers() },
    );
    if (!res.ok) return;
    const rows = await res.json();
    const profile = rows[0]?.profile ?? {};
    profile.last_career_scan_at = new Date().toISOString();
    await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${cleanPhone}`, {
      method: 'PATCH',
      headers: { ...headers(), Prefer: 'return=minimal' },
      body: JSON.stringify({ profile }),
    });
  } catch (err) {
    console.warn('[career-dev] markScanned failed:', err);
  }
}

/**
 * Run the FR17 detector for one tenant. Cadence-gated (weekly). Returns
 * the count of opportunities enqueued (post-dedup).
 */
export async function runCareerDevDetector(tenantPhone: string): Promise<{
  proposed: number;
  skipped_reason?: string;
}> {
  if (await wasScannedRecently(tenantPhone)) {
    return { proposed: 0, skipped_reason: 'within cadence window' };
  }
  const ctx = await loadTenantCareerContext(tenantPhone);
  if (!ctx) return { proposed: 0, skipped_reason: 'no tenant context' };

  const opportunities = await generateOpportunities(ctx);
  if (opportunities.length === 0) {
    // Still mark scanned — don't retry every cron tick when there's
    // genuinely no signal yet
    await markScanned(tenantPhone);
    return { proposed: 0, skipped_reason: 'no grounded opportunities' };
  }

  let proposed = 0;
  for (const opp of opportunities) {
    // Dedup keys: capability name + first 3 words of the title. If the
    // owner already said "not interested in <capability>" or "done <title>",
    // the enqueue pre-flight drops it.
    const titleKey = opp.title.split(/\s+/).filter((w) => w.length >= 4).slice(0, 2).join(' ');
    const id = await enqueueNotification({
      tenantPhone,
      kind: 'agent_observation',
      severity: 'low',
      title: `Career-dev: ${opp.title.slice(0, 80)}`,
      body: `${opp.rationale}\n\nNext step (≤30min): ${opp.next_step}\n\nReply "not interested in ${opp.source_capability}" to skip future nudges in this area.`,
      sourceAgent: 'career-dev',
      metadata: {
        source_capability: opp.source_capability,
        confidence: opp.confidence,
      },
      topicKeywords: [opp.source_capability, titleKey].filter((s) => s && s.length >= 3),
    });
    if (id) proposed++;
  }
  await markScanned(tenantPhone);
  return { proposed };
}

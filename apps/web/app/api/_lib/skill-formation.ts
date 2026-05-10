/**
 * Story 2.15 — Skill Formation & Cross-Agent Learning.
 *
 * When an agent finishes a successful run, we mine it for a reusable
 * technique, attach it to the LANE (not just the individual agent), and
 * inject the lane's top techniques into every peer agent's prompt next
 * tick. The runtime then reports back success/failure outcomes so good
 * skills float up and bad skills auto-retire.
 *
 * Flow:
 *   1. tickAgent finishes a run with outcome 'acted' or 'proposed'.
 *   2. extractSkillsFromRun() asks Anthropic for a technique signature.
 *   3. upsert_agent_skill stores it on the lane.
 *   4. Next tick, loadTickContext fetches top_skills_for_lane → ctx.appliedSkills.
 *   5. buildAgentSystemPrompt renders them as PROVEN TECHNIQUES.
 *   6. tickAgent records the outcome (success/failure/neutral) for each
 *      skill that was in scope on this tick.
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

export interface AppliedSkill {
  id: string;
  technique_signature: string;
  description: string;
  technique_payload: any;
  success_count: number;
  failure_count: number;
  total_uses: number;
  success_rate: number;
  last_success_at: string | null;
}

/**
 * Pull the top N proven techniques for a lane. New skills (no application
 * history yet) are floated to the top so they get a chance to be applied.
 */
export async function topSkillsForLane(
  tenantPhone: string,
  lane: string,
  limit = 5,
): Promise<AppliedSkill[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/top_skills_for_lane`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        p_tenant_phone: tenantPhone,
        p_lane: lane,
        p_limit: limit,
      }),
    });
    if (!res.ok) return [];
    return await res.json();
  } catch (err) {
    console.warn('[skill-formation] topSkillsForLane failed:', err);
    return [];
  }
}

/**
 * Idempotent upsert by (tenant, lane, signature). Description + payload
 * get overwritten so the description stays current as agents learn more
 * about when the technique applies.
 */
export async function upsertSkill(args: {
  tenantPhone: string;
  lane: string;
  signature: string;
  description: string;
  payload?: any;
  discoveredByInstanceId?: string;
  discoveredFromRunId?: string;
  metadata?: any;
}): Promise<string | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/upsert_agent_skill`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        p_tenant_phone: args.tenantPhone,
        p_lane: args.lane,
        p_technique_signature: args.signature.slice(0, 200),
        p_description: args.description.slice(0, 600),
        p_technique_payload: args.payload ?? {},
        p_discovered_by_instance_id: args.discoveredByInstanceId ?? null,
        p_discovered_from_run_id: args.discoveredFromRunId ?? null,
        p_metadata: args.metadata ?? {},
      }),
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text.replace(/"/g, '').trim() || null;
  } catch (err) {
    console.warn('[skill-formation] upsertSkill failed:', err);
    return null;
  }
}

/**
 * Record success/failure/neutral for a skill that was in the agent's
 * prompt on this tick. The RPC also auto-retires the skill if its
 * failure rate has crossed the threshold.
 */
export async function recordSkillOutcome(args: {
  skillId: string;
  agentInstanceId: string;
  agentRunId?: string;
  outcome: 'success' | 'failure' | 'neutral';
  notes?: string;
}): Promise<{ ok: boolean; retired?: boolean }> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { ok: false };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/record_skill_outcome`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        p_skill_id: args.skillId,
        p_agent_instance_id: args.agentInstanceId,
        p_agent_run_id: args.agentRunId ?? null,
        p_outcome: args.outcome,
        p_notes: args.notes ?? null,
      }),
    });
    if (!res.ok) return { ok: false };
    const retired = (await res.text()).trim() === 'true';
    return { ok: true, retired };
  } catch (err) {
    console.warn('[skill-formation] recordSkillOutcome failed:', err);
    return { ok: false };
  }
}

/**
 * Manually retire a skill (owner-driven, e.g. via WhatsApp tool).
 */
export async function retireSkill(skillId: string, reason: string): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/agent_skills?id=eq.${skillId}`, {
      method: 'PATCH',
      headers: { ...headers(), Prefer: 'return=minimal' },
      body: JSON.stringify({
        retired_at: new Date().toISOString(),
        retired_reason: reason.slice(0, 200),
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function listAllSkills(tenantPhone: string, includeRetired = false): Promise<any[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const filter = includeRetired ? '' : '&retired_at=is.null';
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/agent_skills?tenant_phone=eq.${tenantPhone}${filter}&order=lane.asc,success_count.desc&select=id,lane,technique_signature,description,success_count,failure_count,retired_at`,
    { headers: headers() },
  );
  return res.ok ? await res.json() : [];
}

/**
 * Mine a successful run for one reusable technique. Cheap (Haiku) — only
 * called on outcome ∈ {acted, proposed} runs that produced meaningful
 * output. Returns at most one skill per call to keep the catalog tight.
 *
 * The signature is meant to be stable across reruns — if the same agent
 * does the same thing tomorrow, the signature should match so the
 * existing skill row gets its counter bumped instead of creating a dupe.
 */
export async function extractSkillFromRun(args: {
  agentName: string;
  agentRole: string;
  lane: string;
  observation: string;
  recommendation?: string;
  outputSummary?: string;
  proposedAction?: string;
}): Promise<{ signature: string; description: string; payload?: any } | null> {
  if (!ANTHROPIC_API_KEY) return null;
  if (!args.observation && !args.outputSummary) return null;

  const system = `You are a skill-extraction analyst. Given a successful agent run, identify ONE reusable technique that the agent applied — something that could help OTHER agents in the same lane (${args.lane}) tomorrow.

Rules:
- The technique must be GENERAL ENOUGH to apply to similar future situations, not one-off.
- The signature must be stable: lowercase, snake_case, 3-6 words, describing the TECHNIQUE not the specific output. Examples: "lead_with_pricing_objection", "batch_low_priority_emails_into_digest", "ask_for_decision_deadline_upfront".
- The description (1-2 sentences) tells a peer agent WHEN to apply this and WHAT to do.
- If the run is too generic / too specific / not a reusable lesson, respond with EXACTLY: NO_SKILL

Respond with ONLY a JSON object, no other text:
{
  "signature": "snake_case_technique_name",
  "description": "When [trigger condition], [do the thing] because [reason].",
  "applies_when": "1-line trigger description"
}`;

  const userMsg = [
    `Agent: ${args.agentName} (${args.agentRole})`,
    `Lane: ${args.lane}`,
    `Observation: ${args.observation}`,
    args.recommendation ? `Recommendation: ${args.recommendation}` : '',
    args.proposedAction ? `Action: ${args.proposedAction}` : '',
    args.outputSummary ? `Output: ${args.outputSummary}` : '',
  ].filter(Boolean).join('\n');

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userMsg }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = (data.content?.[0]?.text ?? '').trim();
    if (/^NO_SKILL\b/i.test(text)) return null;
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    if (!parsed?.signature || !parsed?.description) return null;
    // Normalize signature to snake_case lower
    const sig = String(parsed.signature)
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 80);
    if (sig.length < 4) return null;
    return {
      signature: sig,
      description: String(parsed.description).slice(0, 600),
      payload: parsed.applies_when ? { applies_when: String(parsed.applies_when) } : {},
    };
  } catch (err) {
    console.warn('[skill-formation] extractSkillFromRun failed:', err);
    return null;
  }
}

/**
 * Render the lane's proven techniques as a system-prompt block. Empty
 * string when the lane has no skills yet.
 */
export function renderSkillsForPrompt(skills: AppliedSkill[]): string {
  if (skills.length === 0) return '';
  const lines = skills.map((s, i) => {
    const score = s.total_uses === 0
      ? 'new — try it'
      : `${Math.round(s.success_rate * 100)}% success across ${s.total_uses} use${s.total_uses === 1 ? '' : 's'}`;
    const when = s.technique_payload?.applies_when ? ` (${s.technique_payload.applies_when})` : '';
    return `  ${i + 1}. [${score}] ${s.description}${when}`;
  });
  return [
    '',
    'PROVEN TECHNIQUES YOUR LANE HAS LEARNED',
    '(Apply these when the situation matches. Mention which one you used in your observation so we can track effectiveness.)',
    ...lines,
  ].join('\n');
}

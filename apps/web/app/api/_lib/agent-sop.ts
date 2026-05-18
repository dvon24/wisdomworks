/**
 * Per-agent SOP (Standard Operating Procedure) synthesizer.
 *
 * Devon's framing 2026-05-18: "What context have they built from their
 * interactions? Have they defined that, the SOP remember?"
 *
 * The per-tenant owner-disposition profile is already injected into
 * every agent prompt (Story 2.9 Phase 3 + the disposition-mining lib).
 * That answers "how should agents work with this owner."
 *
 * THIS module answers the complementary question: "what is THIS
 * specific agent actually doing, based on its accumulated runs +
 * tools + corrections + lane-specific skills?" Renders a readable
 * SOP doc per agent, on-demand, by stitching together what's already
 * captured across:
 *
 *   - agent_runs (recent ticks: what they actually do / propose /
 *     escalate / observe)
 *   - agent_skills (lane-scoped proven techniques — Story 2.15)
 *   - lessons_learned (corrections that bound their behavior)
 *   - tenant_disposition_rules (owner-level rules every agent reads)
 *   - tenant_knowledge_atoms (lane-tagged facts in their domain)
 *   - agent_configs (their role, tools, output channels, governance)
 *
 * The output is a synthesized human-readable doc — owner asks Iris
 * "what's Marcus actually doing" → she calls show_agent_sop → gets
 * back a "Marcus's Operating Manual" snapshot showing what's true
 * RIGHT NOW. No new storage; computed on demand.
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

export interface AgentSop {
  /** Agent identity. */
  agent_name: string;
  agent_role: string;
  lane?: string;
  description?: string;
  /** What the owner can ask this agent to do (from tools + role). */
  capabilities: string[];
  /** Lane-scoped proven techniques (Story 2.15 — agent_skills). */
  proven_techniques: Array<{ technique: string; success_rate?: number; uses?: number }>;
  /** Corrections that have shaped this agent's behavior (lessons + per-lane disposition rules). */
  guardrails: Array<{ rule: string; severity?: string; reason?: string }>;
  /** Lane-tagged atoms — domain facts this agent knows. */
  domain_facts: Array<{ kind: string; content: string }>;
  /** Recent activity summary (last 14 days of agent_runs). */
  recent_activity: {
    total_ticks: number;
    by_outcome: Record<string, number>;
    last_acted_at?: string | null;
    sample_outputs: string[];
  };
  /** Package 2 — owner praise/affirmation summary for this agent.
   *  Pulled from tenant_disposition_rules where attributed_to_agent =
   *  this agent's name. Populated regardless of mode. */
  owner_affirmations: {
    net_score: number;
    last_affirmed_at?: string | null;
    recent_affirmations: Array<{ rule_text: string; evidence?: string; created_at: string }>;
    by_kind: Record<string, number>;
  };
  /** Free-text narrative — Sonnet's synthesis of "this is how Marcus
   *  has been operating." Generated only when the owner explicitly
   *  asks for a narrative (sopMode='narrative'); structured-only mode
   *  skips this to save tokens. */
  narrative?: string;
}

export interface AgentSopOptions {
  /** 'structured' returns the data block only (cheap, deterministic).
   *  'narrative' adds a Sonnet-synthesized prose summary at the top
   *  (better for owner-facing presentation). */
  mode?: 'structured' | 'narrative';
}

/**
 * Build the SOP for one named agent in this tenant. Returns null if
 * the agent isn't found. Errors during sub-queries degrade gracefully
 * (empty arrays / undefined fields) so partial data is still useful.
 */
export async function buildAgentSop(
  tenantPhone: string,
  agentName: string,
  options: AgentSopOptions = {},
): Promise<AgentSop | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');

  // 1. Load agent_configs row (case-insensitive name match)
  const configRes = await fetch(
    `${SUPABASE_URL}/rest/v1/agent_configs?tenant_phone=eq.${cleanPhone}&agent_name=ilike.${encodeURIComponent(agentName)}&limit=1&select=id,agent_name,agent_role,config,output_channels,governance_rules,status`,
    { headers: headers() },
  );
  if (!configRes.ok) return null;
  const configs = await configRes.json();
  const config = configs?.[0];
  if (!config) return null;
  const lane: string | undefined = config.config?.category;

  // 2. Get the running instance for this config so we can scope skills + runs
  const instRes = await fetch(
    `${SUPABASE_URL}/rest/v1/agent_instances?agent_config_id=eq.${config.id}&select=id&limit=1`,
    { headers: headers() },
  );
  const inst = (instRes.ok ? await instRes.json() : [])?.[0];

  // 3. Capabilities = output_channels + config.tools (best-effort)
  const capabilities = [
    ...((config.output_channels as string[]) ?? []),
    ...((config.config?.tools as string[]) ?? []),
  ].filter(Boolean);

  // 4. Lane-scoped proven techniques from agent_skills (Story 2.15)
  let proven_techniques: AgentSop['proven_techniques'] = [];
  if (lane) {
    try {
      const skillsRes = await fetch(
        `${SUPABASE_URL}/rest/v1/agent_skills?tenant_phone=eq.${cleanPhone}&lane=eq.${encodeURIComponent(lane)}&retired_at=is.null&order=success_count.desc&limit=10&select=description,success_count,failure_count`,
        { headers: headers() },
      );
      if (skillsRes.ok) {
        const skills = await skillsRes.json();
        proven_techniques = skills.map((s: any) => {
          const total = (s.success_count ?? 0) + (s.failure_count ?? 0);
          return {
            technique: s.description,
            success_rate: total > 0 ? Number((s.success_count / total).toFixed(2)) : undefined,
            uses: total,
          };
        });
      }
    } catch {}
  }

  // 5. Guardrails = lessons that apply to this lane + disposition rules with this lane's scope
  const guardrails: AgentSop['guardrails'] = [];
  try {
    const lessonsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/lessons_learned?tenant_phone=eq.${cleanPhone}&resolved_at=is.null&order=severity.asc&limit=10&select=title,severity,what_went_wrong,corrective_action`,
      { headers: headers() },
    );
    if (lessonsRes.ok) {
      const lessons = await lessonsRes.json();
      for (const l of lessons) {
        guardrails.push({
          rule: l.corrective_action ?? l.title,
          severity: l.severity,
          reason: l.what_went_wrong,
        });
      }
    }
  } catch {}
  try {
    const dispRes = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_disposition_rules?tenant_phone=eq.${cleanPhone}&status=eq.active&or=(scope.eq.everywhere${lane ? `,scope.eq.${encodeURIComponent(lane)}` : ''})&order=confidence.desc&limit=10&select=kind,rule_text,why`,
      { headers: headers() },
    );
    if (dispRes.ok) {
      const rules = await dispRes.json();
      for (const r of rules) {
        guardrails.push({
          rule: r.rule_text,
          severity: r.kind,
          reason: r.why,
        });
      }
    }
  } catch {}

  // 6. Domain facts — atoms tagged with this lane (or general atoms)
  let domain_facts: AgentSop['domain_facts'] = [];
  try {
    const tagFilter = lane
      ? `tags=cs.{${lane}}`
      : 'tags=cs.{general}';
    const atomsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_knowledge_atoms?tenant_phone=eq.${cleanPhone}&status=eq.active&${tagFilter}&order=owner_confirmed.desc,confidence.desc&limit=15&select=kind,content`,
      { headers: headers() },
    );
    if (atomsRes.ok) {
      const atoms = await atomsRes.json();
      domain_facts = atoms.map((a: any) => ({ kind: a.kind, content: a.content }));
    }
  } catch {}

  // 7. Recent activity from agent_runs (last 14 days)
  let recent_activity: AgentSop['recent_activity'] = {
    total_ticks: 0,
    by_outcome: {},
    sample_outputs: [],
  };
  if (inst?.id) {
    try {
      const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
      const runsRes = await fetch(
        `${SUPABASE_URL}/rest/v1/agent_runs?agent_instance_id=eq.${inst.id}&started_at=gte.${since}&order=started_at.desc&limit=50&select=outcome,output_summary,started_at`,
        { headers: headers() },
      );
      if (runsRes.ok) {
        const runs = await runsRes.json();
        recent_activity.total_ticks = runs.length;
        const byOutcome: Record<string, number> = {};
        let lastActed: string | null = null;
        const samples: string[] = [];
        for (const r of runs) {
          byOutcome[r.outcome] = (byOutcome[r.outcome] ?? 0) + 1;
          if ((r.outcome === 'acted' || r.outcome === 'proposed') && !lastActed) {
            lastActed = r.started_at;
          }
          if (samples.length < 5 && r.output_summary && r.outcome !== 'no_op') {
            samples.push(`[${r.outcome}] ${r.output_summary.slice(0, 140)}`);
          }
        }
        recent_activity.by_outcome = byOutcome;
        recent_activity.last_acted_at = lastActed;
        recent_activity.sample_outputs = samples;
      }
    } catch {}
  }

  // 8. Owner affirmations (Package 2) — praise + per-agent disposition
  //    rules from the last 90 days. Fed into both the SOP doc and the
  //    promotion-candidate scoring (Package 3).
  let owner_affirmations: AgentSop['owner_affirmations'] = {
    net_score: 0,
    last_affirmed_at: null,
    recent_affirmations: [],
    by_kind: {},
  };
  try {
    const { getAgentAffirmations } = await import('./disposition-mining');
    const aff = await getAgentAffirmations(cleanPhone, config.agent_name, { windowDays: 90 });
    owner_affirmations = {
      net_score: aff.net_score,
      last_affirmed_at: aff.last_affirmed_at,
      recent_affirmations: aff.recent_affirmations,
      by_kind: aff.by_kind as Record<string, number>,
    };
  } catch (err) {
    console.warn('[agent-sop] affirmation lookup failed:', err);
  }

  const sop: AgentSop = {
    agent_name: config.agent_name,
    agent_role: config.agent_role,
    lane,
    description: config.config?.description,
    capabilities,
    proven_techniques,
    guardrails,
    domain_facts,
    recent_activity,
    owner_affirmations,
  };

  // 8. Optional Sonnet narrative — only when explicitly requested
  if (options.mode === 'narrative' && ANTHROPIC_API_KEY) {
    try {
      sop.narrative = await synthesizeNarrative(sop);
    } catch (err) {
      console.warn('[agent-sop] narrative synthesis failed:', err);
    }
  }

  return sop;
}

/**
 * Sonnet pass that turns the structured SOP into a short readable
 * narrative the owner can skim. Bounded to ~250 tokens out.
 */
async function synthesizeNarrative(sop: AgentSop): Promise<string> {
  const system = `You are summarizing the OPERATING MANUAL for one AI agent on a small business team. The owner wants to understand what this agent actually does day-to-day, what they've learned, and where they're bounded. Write 2-3 short paragraphs in plain English — no jargon, no fluff, no marketing speak. Address the OWNER directly ("Marcus has been..."). End with one concrete recommendation the owner could act on.`;

  const facts = [
    `Agent: ${sop.agent_name} (${sop.agent_role})${sop.lane ? ` — lane: ${sop.lane}` : ''}`,
    sop.description ? `Remit: ${sop.description}` : '',
    `Capabilities: ${sop.capabilities.slice(0, 8).join(', ') || '(none configured)'}`,
    '',
    `RECENT ACTIVITY (last 14 days):`,
    `  Total ticks: ${sop.recent_activity.total_ticks}`,
    `  By outcome: ${Object.entries(sop.recent_activity.by_outcome).map(([k, v]) => `${k}=${v}`).join(', ') || 'none'}`,
    `  Last action: ${sop.recent_activity.last_acted_at ?? 'no recent action'}`,
    sop.recent_activity.sample_outputs.length > 0
      ? `  Sample outputs:\n    - ${sop.recent_activity.sample_outputs.join('\n    - ')}`
      : '',
    '',
    `PROVEN TECHNIQUES (from skill formation):`,
    sop.proven_techniques.length === 0
      ? '  (none yet — agent has not had successful patterns extracted)'
      : sop.proven_techniques
          .slice(0, 5)
          .map((t) => `  - ${t.technique}${t.uses ? ` (${t.uses} uses, ${Math.round((t.success_rate ?? 0) * 100)}% success)` : ''}`)
          .join('\n'),
    '',
    `GUARDRAILS (corrections + owner rules):`,
    sop.guardrails.length === 0
      ? '  (none — agent has not been corrected on anything specific)'
      : sop.guardrails.slice(0, 5).map((g) => `  - ${g.rule}${g.reason ? ` (because: ${g.reason})` : ''}`).join('\n'),
    '',
    `DOMAIN FACTS (atoms tagged to this lane):`,
    sop.domain_facts.length === 0
      ? '  (none — owner has not taught lane-specific facts yet)'
      : sop.domain_facts.slice(0, 5).map((a) => `  - [${a.kind}] ${a.content}`).join('\n'),
    '',
    `OWNER AFFIRMATIONS (last 90 days) — net score ${sop.owner_affirmations.net_score}, ${sop.owner_affirmations.recent_affirmations.length} recent praises:`,
    sop.owner_affirmations.recent_affirmations.length === 0
      ? '  (no specific praise yet — agent has not been called out by name in positive feedback)'
      : sop.owner_affirmations.recent_affirmations
          .slice(0, 3)
          .map((a) => `  - "${a.rule_text}"${a.evidence ? ` (owner said: ${a.evidence})` : ''}`)
          .join('\n'),
  ].filter(Boolean).join('\n');

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: facts }],
    }),
  });
  if (!res.ok) return '';
  const data = await res.json();
  return (data.content?.[0]?.text ?? '').trim();
}

/**
 * Render a built SOP as a WhatsApp-friendly message block. Used by
 * Iris's show_agent_sop tool when she wants to surface the SOP to the
 * owner in a readable form (vs. dropping raw JSON).
 */
export function renderSopForChat(sop: AgentSop): string {
  const lines: string[] = [];
  lines.push(`📋 **${sop.agent_name}** — ${sop.agent_role}${sop.lane ? `  ·  lane: ${sop.lane}` : ''}`);
  if (sop.description) lines.push(`   ${sop.description}`);
  if (sop.narrative) {
    lines.push('', sop.narrative);
  }
  lines.push('', '**Recent activity (14d):**');
  if (sop.recent_activity.total_ticks === 0) {
    lines.push('   No ticks — this agent has been idle or just spun up.');
  } else {
    const outcomes = Object.entries(sop.recent_activity.by_outcome)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    lines.push(`   ${sop.recent_activity.total_ticks} ticks · ${outcomes}`);
    if (sop.recent_activity.sample_outputs.length > 0) {
      lines.push('   Recent:');
      for (const s of sop.recent_activity.sample_outputs.slice(0, 3)) {
        lines.push(`     • ${s}`);
      }
    }
  }
  if (sop.proven_techniques.length > 0) {
    lines.push('', '**Proven techniques:**');
    for (const t of sop.proven_techniques.slice(0, 5)) {
      const stat = t.uses ? ` (${Math.round((t.success_rate ?? 0) * 100)}% / ${t.uses} uses)` : '';
      lines.push(`   • ${t.technique}${stat}`);
    }
  }
  if (sop.guardrails.length > 0) {
    lines.push('', '**Guardrails:**');
    for (const g of sop.guardrails.slice(0, 5)) {
      lines.push(`   • ${g.rule}`);
    }
  }
  if (sop.domain_facts.length > 0) {
    lines.push('', '**Domain knowledge:**');
    for (const a of sop.domain_facts.slice(0, 5)) {
      lines.push(`   • [${a.kind}] ${a.content.slice(0, 120)}`);
    }
  }
  if (sop.owner_affirmations.recent_affirmations.length > 0 || sop.owner_affirmations.net_score !== 0) {
    lines.push('', `**Owner affirmations** (net score: ${sop.owner_affirmations.net_score}${sop.owner_affirmations.last_affirmed_at ? `, last: ${new Date(sop.owner_affirmations.last_affirmed_at).toLocaleDateString()}` : ''}):`);
    if (sop.owner_affirmations.recent_affirmations.length === 0) {
      lines.push('   (no specific praise yet — but no negative signals either)');
    } else {
      for (const a of sop.owner_affirmations.recent_affirmations.slice(0, 3)) {
        lines.push(`   ✓ ${a.rule_text.slice(0, 150)}`);
      }
    }
  }
  return lines.join('\n');
}

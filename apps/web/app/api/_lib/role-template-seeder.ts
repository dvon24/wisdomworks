/**
 * Role-scoped template seeder — when an agent is provisioned (Marcus, Mira,
 * Riley, Alex, etc.), look up their role's canonical workflow templates and
 * create them in user_workflows as pending_approval rows.
 *
 * This is the piece that makes "add an agent" feel like "hire an employee."
 * Without this, every owner has to ask Iris to create every routine, one at
 * a time, from scratch. With it, the agent ships with day-1 routines that
 * just need owner approval.
 *
 * Role-slug matching is loose: we lowercase the agent_role string and try
 * known role keys in order. Common phrasings:
 *   "Financial Advisor" / "Finance / Bookkeeping" → 'financial-advisor'
 *   "Personal Finance" / "Bookkeeper"             → 'finance'
 *   "Scheduler" / "Executive Coordinator"         → 'scheduler'
 *   "Au7o Dev" / "Project Lead"                   → 'au7o-dev'
 *   "Personal Assistant" / "Orchestrator"         → 'personal-assistant'
 *   "Runtime Auditor"                             → 'runtime-auditor'
 *
 * If no template set matches, the seed is a no-op (the agent works fine,
 * just without auto-seeded workflows; owner can still create custom ones
 * via Iris). Adding new role templates is purely a database concern —
 * insert into agent_role_templates and they pick up on next provisioning.
 */

import { nextRunAfter } from './cron-next';
import { findRedundantWorkflow } from './user-workflows';
import { getAgentCanonicalRole, setAgentCanonicalRole } from './role-catalog';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

interface RoleTemplate {
  id: string;
  role_slug: string;
  name_suffix: string;
  description: string;
  cron_expr: string | null;
  steps: any[];
  category: string | null;
}

/**
 * Map a free-text agent_role string to a known role_slug. Conservative —
 * unknown roles return null so the seeder is a no-op rather than guessing
 * incorrectly. Add new mappings as new roles ship.
 */
/**
 * Map a free-text agent_role (or agent name) to a canonical role_slug that
 * EXISTS in agent_role_catalog. Returns null when nothing matches confidently
 * — the caller then leaves the agent unbound and surfaces it (the "can't ship
 * mute" visibility) rather than guessing wrong.
 *
 * Every returned slug MUST be a real catalog row (verified 2026-06-03 against
 * the 30-row catalog). Order matters — specific compound phrases first, then
 * single keywords. Notable corrections 2026-06-03:
 *   - developer/engineer/au7o → 'web-developer' (was 'au7o-dev', which has no
 *     catalog row — its templates were folded into web-developer).
 *   - finance/bookkeeping split: 'bookkeeper' vs 'financial-advisor' are
 *     distinct catalog roles; 'finance' (orphan) folds into financial-advisor.
 *   - operations-manager is its OWN complete role now — no longer lumped into
 *     financial-advisor.
 */
export function inferRoleSlug(agentRole: string | undefined | null): string | null {
  if (!agentRole) return null;
  const r = agentRole.toLowerCase().trim();
  const has = (...kw: string[]) => kw.some((k) => r.includes(k));

  // ── Platform / coordination ──
  if (has('auditor', 'runtime monitor')) return 'runtime-auditor';
  // "Personal AI Assistant", "Personal Assistant", "Executive Assistant" — the
  // 'assistant' + (personal|executive) pair catches infixes like "AI".
  if (has('personal assistant', 'orchestrator', 'chief of staff', 'executive assistant') || (r.includes('assistant') && (r.includes('personal') || r.includes('executive')))) return 'personal-assistant';
  if (has('scheduler', 'schedul', 'coordinator', 'calendar manager', 'booking')) return 'scheduler';

  // ── Technical ──
  if (has('ux', 'ui design', 'product design', 'designer')) return 'ux-designer';
  if (has('web developer', 'developer', 'engineer', 'devops', 'au7o', 'programmer', 'full stack', 'frontend', 'backend', 'software')) return 'web-developer';

  // ── Finance (most specific first) ──
  if (has('bookkeep', 'accounts payable', 'accounts receivable')) return 'bookkeeper';
  if (has('operations manager', 'ops manager', 'operations lead') || r === 'operations' || r === 'ops') return 'operations-manager';
  if (has('financial advisor', 'finance manager', 'cfo', 'controller', 'accountant', 'personal finance') || r === 'finance' || (r.includes('financ') && r.includes('advis'))) return 'financial-advisor';

  // ── Marketing / content / writing ──
  if (has('content creator', 'influencer', 'video creator', 'creator')) return 'content-creator';
  if (has('marketing', 'social media', 'brand manager', 'growth')) return 'marketing-manager';
  if (has('copywriter', 'writer', 'author', 'blogger')) return 'writer';
  if (has('editor', 'proofread')) return 'editor';

  // ── People-facing ops ──
  if (has('customer service', 'customer support', 'customer success', 'support agent', 'help desk', 'concierge')) return 'customer-service';
  if (has('recruiter', 'talent', 'hiring', 'human resources') || r === 'hr') return 'recruiter';
  if (has('real estate', 'realtor', 'property')) return 'real-estate-agent';
  if (has('consultant', 'strategist', 'advisor')) return 'consultant';

  // ── Project management ──
  if (has('freelance')) return 'freelancer-pm';
  if (has('project manager', 'program manager', 'scrum', 'delivery manager')) return 'project-manager';

  // ── Health / wellness (specific coach types before generic) ──
  if (has('personal trainer', 'fitness coach', 'strength coach', 'trainer')) return 'personal-trainer';
  if (has('nutritionist', 'dietician', 'dietitian', 'nutrition')) return 'nutritionist';
  if (has('meal plan', 'meal prep')) return 'meal-planner';
  if (has('grocery', 'shopping list')) return 'grocery-planner';
  if (has('sleep')) return 'sleep-coach';
  if (has('medication', 'pharmacy', 'prescription', 'meds')) return 'medication-tracker';
  if (has('fitness log', 'workout log', 'activity track')) return 'fitness-logger';
  if (has('language coach', 'language tutor', 'esl')) return 'language-coach';
  // Therapy/counseling labels route here too: we deliberately have NO clinical-
  // therapist catalog role (regulated — the agent must not present as a licensed
  // therapist), so life-coach is the safe, non-mute landing for wellness/
  // emotional-support intent. Binding only — the persona stays coaching, not clinical.
  if (has('life coach', 'wellness coach', 'mindfulness', 'habit', 'therapist', 'therapy', 'counselor', 'counseling', 'mental health', 'emotional support', 'wellbeing', 'well-being')) return 'life-coach';

  // ── Education ──
  if (has('tutor', 'teacher', 'homeschool', 'curriculum', 'instructor', 'education')) return 'tutor';

  // ── Lifestyle ──
  if (has('travel', 'trip', 'itinerary')) return 'travel-planner';
  if (has('household', 'home manager', 'house manager')) return 'household-manager';

  return null;
}

export interface SeedResult {
  ok: boolean;
  agent_name: string;
  role_slug: string | null;
  templates_found: number;
  workflows_created: number;
  workflows_skipped: Array<{ name: string; reason: string }>;
  interpretation: string;
}

/**
 * Look up role templates and create user_workflows rows for each one.
 * Idempotent — re-running for the same agent skips workflows that already
 * exist (matched by exact name). Doesn't activate anything; everything
 * lands as pending_approval.
 */
export async function seedRoleTemplatesForAgent(args: {
  tenantPhone: string;
  agentName: string;
  agentRole: string;
  /** If known at call time (e.g. fresh provisioning), skip the lookup. */
  canonicalRoleSlug?: string | null;
}): Promise<SeedResult> {
  // Prefer the canonical_role_slug stored on the agent_configs row (set
  // explicitly at provisioning or backfill). Fall back to legacy free-text
  // inference for agents that predate the catalog migration. Once all
  // tenants are backfilled, the inference fallback can be deleted.
  let roleSlug: string | null = args.canonicalRoleSlug ?? null;
  if (!roleSlug) {
    const cfg = await getAgentCanonicalRole({
      tenantPhone: args.tenantPhone,
      agentName: args.agentName,
    });
    roleSlug = cfg?.canonical_role_slug ?? null;
  }
  if (!roleSlug) {
    // Legacy path — infer from the free-text role string.
    roleSlug = inferRoleSlug(args.agentRole);
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return {
      ok: false,
      agent_name: args.agentName,
      role_slug: roleSlug,
      templates_found: 0,
      workflows_created: 0,
      workflows_skipped: [],
      interpretation: 'Supabase not configured.',
    };
  }
  if (!roleSlug) {
    return {
      ok: true,
      agent_name: args.agentName,
      role_slug: null,
      templates_found: 0,
      workflows_created: 0,
      workflows_skipped: [],
      interpretation: `No canonical templates for role "${args.agentRole}" — agent is provisioned but with no auto-seeded routines. Owner can still create custom workflows via Iris.`,
    };
  }

  const cleanPhone = args.tenantPhone.replace(/[\s\-+()]/g, '');
  const agentSlug = args.agentName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  // Pull templates for this role.
  const tplRes = await fetch(
    `${SUPABASE_URL}/rest/v1/agent_role_templates?role_slug=eq.${roleSlug}&select=*`,
    { headers: headers() },
  );
  if (!tplRes.ok) {
    return {
      ok: false,
      agent_name: args.agentName,
      role_slug: roleSlug,
      templates_found: 0,
      workflows_created: 0,
      workflows_skipped: [],
      interpretation: `Couldn't read role templates (HTTP ${tplRes.status}).`,
    };
  }
  const templates = (await tplRes.json()) as RoleTemplate[];
  if (templates.length === 0) {
    return {
      ok: true,
      agent_name: args.agentName,
      role_slug: roleSlug,
      templates_found: 0,
      workflows_created: 0,
      workflows_skipped: [],
      interpretation: `Role "${roleSlug}" has no templates defined yet.`,
    };
  }

  // Existing workflows for this tenant — skip dups by NAME and by SCHEDULE
  // OVERLAP. Name-only dedup let a seeded 'coach-weekday-workout' coexist with
  // an owner-created 'coach-daily-workout-3pm-cet' (same steps, overlapping
  // schedule, different name) → stacked workouts. Reuse the shared overlap
  // check so the seeder and create_workflow agree on what "duplicate" means.
  const existingRes = await fetch(
    `${SUPABASE_URL}/rest/v1/user_workflows?tenant_phone=eq.${cleanPhone}&status=neq.removed&select=name,status,cron_expr,steps`,
    { headers: headers() },
  );
  const existingNames = new Set<string>();
  const existingWorkflows: Array<{ name: string; status: any; cron_expr: string | null; steps: any[] }> = [];
  if (existingRes.ok) {
    const rows = await existingRes.json();
    for (const r of rows) {
      existingNames.add(r.name);
      existingWorkflows.push({ name: r.name, status: r.status, cron_expr: r.cron_expr ?? null, steps: r.steps ?? [] });
    }
  }

  let created = 0;
  const skipped: Array<{ name: string; reason: string }> = [];

  for (const tpl of templates) {
    const workflowName = `${agentSlug}-${tpl.name_suffix}`;
    if (existingNames.has(workflowName)) {
      skipped.push({ name: workflowName, reason: 'already exists' });
      continue;
    }

    // Substitute {{agent_name}} placeholder in steps with the actual agent name.
    const serialized = JSON.stringify(tpl.steps);
    const concreteSteps = JSON.parse(
      serialized.replace(/\{\{agent_name\}\}/g, args.agentName),
    );

    // Skip if a non-removed workflow already runs the same steps on an
    // overlapping schedule (even under a different name).
    const conflict = findRedundantWorkflow(existingWorkflows, tpl.cron_expr ?? null, concreteSteps);
    if (conflict) {
      skipped.push({ name: workflowName, reason: `overlaps existing "${conflict.name}" (same steps, overlapping schedule)` });
      continue;
    }

    const nextRun = tpl.cron_expr ? nextRunAfter(tpl.cron_expr, new Date()) : null;

    try {
      const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/user_workflows`, {
        method: 'POST',
        headers: { ...headers(), Prefer: 'return=minimal' },
        body: JSON.stringify({
          tenant_phone: cleanPhone,
          name: workflowName,
          description: tpl.description,
          cron_expr: tpl.cron_expr,
          steps: concreteSteps,
          status: 'pending_approval',
          next_run_at: nextRun?.toISOString() ?? null,
        }),
      });
      if (insertRes.ok) {
        created++;
        // Track within this run so a second template can't overlap the one we
        // just seeded.
        existingNames.add(workflowName);
        existingWorkflows.push({ name: workflowName, status: 'pending_approval', cron_expr: tpl.cron_expr ?? null, steps: concreteSteps });
      } else {
        const text = await insertRes.text();
        skipped.push({ name: workflowName, reason: `${insertRes.status}: ${text.slice(0, 100)}` });
      }
    } catch (err: any) {
      skipped.push({ name: workflowName, reason: err?.message ?? String(err) });
    }
  }

  const skipNote = skipped.length > 0
    ? ` (${skipped.length} skipped: ${skipped.map(s => `${s.name} — ${s.reason}`).join('; ')})`
    : '';

  return {
    ok: true,
    agent_name: args.agentName,
    role_slug: roleSlug,
    templates_found: templates.length,
    workflows_created: created,
    workflows_skipped: skipped,
    interpretation: created > 0
      ? `${args.agentName} provisioned with ${created} starter routine${created === 1 ? '' : 's'} (pending approval).${templates[0] ? ` Reply "approve all ${args.agentName} workflows" to activate them, or pick specific ones with "approve ${workflowName(args.agentName, templates[0])}".` : ''}${skipNote}`
      : `${args.agentName} provisioned. ${templates.length} role templates exist but none were new for this tenant${skipNote}.`,
  };
}

function workflowName(agentName: string, tpl: RoleTemplate): string {
  const slug = agentName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${slug}-${tpl.name_suffix}`;
}

export interface BindSeedAgentResult {
  agent_name: string;
  agent_role: string;
  role_slug: string | null;
  bound: boolean;
  workflows_created: number;
  matched: boolean;
}

export interface BindSeedReport {
  tenant_phone: string;
  agents: BindSeedAgentResult[];
  bound_count: number;
  workflows_created: number;
  unmatched: string[];
  summary: string;
}

/**
 * Bind every agent on a tenant to a canonical catalog role and seed its day-1
 * routines. This is the launch-critical onboarding wire (GAP 1 — the deploy
 * path never bound agents to the catalog or seeded routines) AND the self-heal
 * for legacy agents created before binding existed (GAP 6 — agents added via
 * WhatsApp/backfill/provision_axis with canonical_role_slug=null, e.g. a
 * tenant's pre-existing Coach/Mira).
 *
 * Reuses the in-app pieces (inferRoleSlug + setAgentCanonicalRole +
 * seedRoleTemplatesForAgent) so there's ONE source of role logic. Idempotent:
 * an already-bound agent isn't re-bound, and seeding skips workflows that
 * already exist. Agents whose role can't be resolved to a catalog slug are
 * returned in `unmatched` (NOT silently skipped) so the caller can surface
 * them — the "no agent ships mute, and if one might, we say so" guarantee.
 */
export async function bindAndSeedTenantAgents(tenantPhone: string): Promise<BindSeedReport> {
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  const base: BindSeedReport = { tenant_phone: cleanPhone, agents: [], bound_count: 0, workflows_created: 0, unmatched: [], summary: 'no agents' };
  if (!SUPABASE_URL || !SUPABASE_KEY) return { ...base, summary: 'supabase not configured' };

  let configs: Array<{ agent_name: string; agent_role: string | null; canonical_role_slug: string | null }> = [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_configs?tenant_phone=eq.${cleanPhone}&status=neq.removed&select=agent_name,agent_role,canonical_role_slug`,
      { headers: headers() },
    );
    if (res.ok) configs = await res.json();
    else return { ...base, summary: `load failed: ${res.status}` };
  } catch (err) {
    console.warn('[bind-seed] load agent_configs failed:', err);
    return { ...base, summary: 'load failed' };
  }

  const agents: BindSeedAgentResult[] = [];
  const unmatched: string[] = [];
  let boundCount = 0;
  let workflowsCreated = 0;

  for (const c of configs) {
    const role = c.agent_role ?? '';
    // Prefer an already-set slug; else resolve from the role string, then name.
    const slug = c.canonical_role_slug ?? inferRoleSlug(role) ?? inferRoleSlug(c.agent_name);
    if (!slug) {
      unmatched.push(c.agent_name);
      agents.push({ agent_name: c.agent_name, agent_role: role, role_slug: null, bound: false, workflows_created: 0, matched: false });
      continue;
    }
    let bound = !!c.canonical_role_slug;
    if (!c.canonical_role_slug) {
      const r = await setAgentCanonicalRole({ tenantPhone: cleanPhone, agentName: c.agent_name, canonicalRoleSlug: slug });
      bound = r.ok;
      if (r.ok) boundCount++;
      else console.warn(`[bind-seed] bind ${c.agent_name} -> ${slug} failed: ${r.reason}`);
    }
    // Idempotent re-seed (skips existing workflows) so newly-added role
    // templates also reach already-bound agents.
    const seed = await seedRoleTemplatesForAgent({ tenantPhone: cleanPhone, agentName: c.agent_name, agentRole: role, canonicalRoleSlug: slug });
    workflowsCreated += seed.workflows_created;
    agents.push({ agent_name: c.agent_name, agent_role: role, role_slug: slug, bound, workflows_created: seed.workflows_created, matched: true });
  }

  return {
    tenant_phone: cleanPhone,
    agents,
    bound_count: boundCount,
    workflows_created: workflowsCreated,
    unmatched,
    summary: `${configs.length} agents — ${boundCount} newly bound, ${workflowsCreated} routines seeded${unmatched.length ? `, ${unmatched.length} UNMATCHED: ${unmatched.join(', ')}` : ''}`,
  };
}

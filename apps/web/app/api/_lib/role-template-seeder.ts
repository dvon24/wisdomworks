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
export function inferRoleSlug(agentRole: string | undefined | null): string | null {
  if (!agentRole) return null;
  const r = agentRole.toLowerCase().trim();
  if (r.includes('financial advisor') || (r.includes('financ') && r.includes('advis'))) return 'financial-advisor';
  if (r.includes('bookkeep') || r.includes('personal finance') || r === 'finance') return 'finance';
  if (r.includes('schedul') || r.includes('coordinator') || r.includes('executive assistant')) return 'scheduler';
  if (r.includes('au7o') || r.includes('project lead') || r.includes('engineer')) return 'au7o-dev';
  if (r.includes('personal assistant') || r.includes('orchestrator')) return 'personal-assistant';
  if (r.includes('auditor') || r.includes('runtime monitor')) return 'runtime-auditor';
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
}): Promise<SeedResult> {
  const roleSlug = inferRoleSlug(args.agentRole);
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

  // Existing workflow names for this tenant — skip dups.
  const existingRes = await fetch(
    `${SUPABASE_URL}/rest/v1/user_workflows?tenant_phone=eq.${cleanPhone}&select=name`,
    { headers: headers() },
  );
  const existingNames = new Set<string>();
  if (existingRes.ok) {
    const rows = await existingRes.json();
    for (const r of rows) existingNames.add(r.name);
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

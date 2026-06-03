/**
 * Catalog integrity audit — the guarantee that NO role in the agent library
 * ships "mute" (tools but no day-1 routines) or broken (tools that don't
 * exist, templates with no catalog home).
 *
 * Background: a 2026-06-03 review found 6 catalog roles with zero
 * agent_role_templates (customer-service, marketing-manager, operations-
 * manager, recruiter, ux-designer, web-developer) — they'd provision with
 * tools but no proactive routines, i.e. silent agents. Plus 2 orphan template
 * slugs (finance, au7o-dev) whose templates had no catalog row.
 *
 * This function encodes the invariants every catalog role MUST satisfy so the
 * failure becomes detectable (and, wired into a write-time gate / CI check,
 * preventable) instead of shipping silently:
 *
 *   1. no_tools        — a role with empty default_tools provisions an agent
 *                        that can DO nothing.
 *   2. no_routines     — a role with no agent_role_templates provisions an
 *                        agent with no day-1 work → "mute".
 *   3. dangling_tool   — a default_tool name that isn't in the live tool
 *                        registry → the agent is offered a tool that 404s.
 *   4. orphan_template — agent_role_templates rows for a slug with no
 *                        agent_role_catalog row → unreachable + FK risk if
 *                        ever PATCHed onto agent_configs.canonical_role_slug.
 *   5. no_capabilities — (warn) a role with no required_capabilities declared;
 *                        not fatal but means capability-gap detection can't
 *                        reason about it.
 *
 * The tool registry is passed IN (validToolNames) so this lib stays decoupled
 * from the heavy agent-tools module — the admin endpoint supplies it.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const sbHeaders = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
});

export type CatalogViolationKind =
  | 'no_tools'
  | 'no_routines'
  | 'dangling_tool'
  | 'orphan_template'
  | 'no_capabilities';

export interface CatalogViolation {
  role_slug: string;
  kind: CatalogViolationKind;
  severity: 'error' | 'warn';
  detail: string;
}

export interface CatalogAuditReport {
  ok: boolean; // true iff there are zero ERROR-severity violations
  rolesChecked: number;
  templateRows: number;
  mute: string[]; // roles that would ship with no day-1 routines
  violations: CatalogViolation[];
  summary: string;
}

interface CatalogRow {
  role_slug: string;
  default_tools: string[] | null;
  required_capabilities: string[] | null;
}

/**
 * Audit the live agent_role_catalog + agent_role_templates against the
 * invariants above. Pass `validToolNames` (the keys of TOOL_REGISTRY) to also
 * catch default_tools that reference a tool the platform doesn't have.
 */
export async function auditCatalogIntegrity(
  opts: { validToolNames?: Set<string> } = {},
): Promise<CatalogAuditReport> {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return { ok: false, rolesChecked: 0, templateRows: 0, mute: [], violations: [], summary: 'supabase not configured' };
  }

  const [catRes, tplRes] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/agent_role_catalog?select=role_slug,default_tools,required_capabilities`, { headers: sbHeaders() }),
    fetch(`${SUPABASE_URL}/rest/v1/agent_role_templates?select=role_slug`, { headers: sbHeaders() }),
  ]);
  if (!catRes.ok) {
    return { ok: false, rolesChecked: 0, templateRows: 0, mute: [], violations: [], summary: `catalog query ${catRes.status}` };
  }
  const catalog: CatalogRow[] = await catRes.json();
  const templates: Array<{ role_slug: string }> = tplRes.ok ? await tplRes.json() : [];

  const templateCount = new Map<string, number>();
  for (const t of templates) templateCount.set(t.role_slug, (templateCount.get(t.role_slug) ?? 0) + 1);
  const catalogSlugs = new Set(catalog.map((r) => r.role_slug));

  const violations: CatalogViolation[] = [];
  const mute: string[] = [];

  for (const r of catalog) {
    const tools = r.default_tools ?? [];
    const caps = r.required_capabilities ?? [];

    if (tools.length === 0) {
      violations.push({ role_slug: r.role_slug, kind: 'no_tools', severity: 'error', detail: 'no default_tools — agent would provision with no capabilities' });
    }
    if ((templateCount.get(r.role_slug) ?? 0) === 0) {
      violations.push({ role_slug: r.role_slug, kind: 'no_routines', severity: 'error', detail: 'no agent_role_templates — agent ships MUTE (no day-1 routines)' });
      mute.push(r.role_slug);
    }
    if (caps.length === 0) {
      violations.push({ role_slug: r.role_slug, kind: 'no_capabilities', severity: 'warn', detail: 'no required_capabilities declared — capability-gap detection is blind to this role' });
    }
    if (opts.validToolNames) {
      for (const tool of tools) {
        if (!opts.validToolNames.has(tool)) {
          violations.push({ role_slug: r.role_slug, kind: 'dangling_tool', severity: 'error', detail: `default tool "${tool}" is not in the live tool registry` });
        }
      }
    }
  }

  // Orphans: template rows pointing at a slug with no catalog home.
  for (const slug of templateCount.keys()) {
    if (!catalogSlugs.has(slug)) {
      violations.push({ role_slug: slug, kind: 'orphan_template', severity: 'error', detail: `${templateCount.get(slug)} agent_role_templates row(s) but NO agent_role_catalog row — unreachable + FK risk` });
    }
  }

  const errorCount = violations.filter((v) => v.severity === 'error').length;
  const warnCount = violations.length - errorCount;
  return {
    ok: errorCount === 0,
    rolesChecked: catalog.length,
    templateRows: templates.length,
    mute,
    violations,
    summary: `${catalog.length} roles, ${templates.length} template rows — ${errorCount} error(s), ${warnCount} warning(s)${mute.length ? ` · MUTE: ${mute.join(', ')}` : ''}`,
  };
}

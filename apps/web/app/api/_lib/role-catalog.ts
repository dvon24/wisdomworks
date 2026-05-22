/**
 * Agent role catalog — read access to the global dictionary of canonical
 * agent roles. Backs the list_available_roles tool, the add_agent_to_team
 * role-validation step, and the seedRoleTemplatesForAgent lookup.
 *
 * The catalog is intentionally a small, curated list (~10 roles). New
 * roles get added via SQL migration as the platform learns what shapes
 * matter — NOT via owner-provided free text. This keeps every agent on
 * the platform mapped to one of N known shapes, which is what unlocks
 * cross-tenant pattern aggregation, marketing claims, default-tool
 * suggestion, and unambiguous template seeding.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

export interface RoleCatalogEntry {
  role_slug: string;
  display_default: string;
  category: string;
  description: string;
  default_tools: string[];
  required_capabilities: string[];
  optional_capabilities: string[];
  system_prompt_fragment?: string | null;
}

let catalogCache: { ts: number; rows: RoleCatalogEntry[] } | null = null;
const CACHE_TTL_MS = 60_000;

export async function listRoleCatalog(): Promise<RoleCatalogEntry[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  if (catalogCache && Date.now() - catalogCache.ts < CACHE_TTL_MS) {
    return catalogCache.rows;
  }
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_role_catalog?select=*&order=category,display_default`,
      { headers: headers() },
    );
    if (!res.ok) return catalogCache?.rows ?? [];
    const rows = (await res.json()) as RoleCatalogEntry[];
    catalogCache = { ts: Date.now(), rows };
    return rows;
  } catch {
    return catalogCache?.rows ?? [];
  }
}

export async function getRoleCatalogEntry(slug: string): Promise<RoleCatalogEntry | null> {
  const all = await listRoleCatalog();
  return all.find(r => r.role_slug === slug.toLowerCase().trim()) ?? null;
}

/** Validate that a role_slug exists in the catalog. */
export async function isValidRoleSlug(slug: string | undefined | null): Promise<boolean> {
  if (!slug) return false;
  const entry = await getRoleCatalogEntry(slug);
  return entry !== null;
}

/**
 * Set canonical_role_slug + display_name on an existing agent_configs row.
 * Looked up by (tenant_phone, agent_name) so this works for both freshly-
 * provisioned and backfilled agents.
 */
export async function setAgentCanonicalRole(args: {
  tenantPhone: string;
  agentName: string;
  canonicalRoleSlug: string;
  displayName?: string;
}): Promise<{ ok: boolean; reason?: string }> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { ok: false, reason: 'supabase_not_configured' };
  if (!(await isValidRoleSlug(args.canonicalRoleSlug))) {
    return { ok: false, reason: `unknown_role_slug:${args.canonicalRoleSlug}` };
  }
  const cleanPhone = args.tenantPhone.replace(/[\s\-+()]/g, '');
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_configs?tenant_phone=eq.${cleanPhone}&agent_name=eq.${encodeURIComponent(args.agentName)}&status=neq.removed`,
      {
        method: 'PATCH',
        headers: { ...headers(), Prefer: 'return=minimal' },
        body: JSON.stringify({
          canonical_role_slug: args.canonicalRoleSlug,
          ...(args.displayName ? { display_name: args.displayName } : {}),
          updated_at: new Date().toISOString(),
        }),
      },
    );
    if (!res.ok) return { ok: false, reason: `${res.status}: ${(await res.text()).slice(0, 200)}` };
    return { ok: true };
  } catch (err: any) {
    return { ok: false, reason: err?.message ?? String(err) };
  }
}

/** Read the canonical_role_slug for an existing agent (by tenant + name). */
export async function getAgentCanonicalRole(args: {
  tenantPhone: string;
  agentName: string;
}): Promise<{ canonical_role_slug: string | null; display_name: string | null; agent_role: string | null } | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const cleanPhone = args.tenantPhone.replace(/[\s\-+()]/g, '');
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_configs?tenant_phone=eq.${cleanPhone}&agent_name=eq.${encodeURIComponent(args.agentName)}&status=neq.removed&select=canonical_role_slug,display_name,agent_role&limit=1`,
      { headers: headers() },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return rows?.[0] ?? null;
  } catch {
    return null;
  }
}

/** Render the catalog as a numbered list for Iris's chat replies. */
export function formatCatalogForChat(entries: RoleCatalogEntry[]): string {
  if (entries.length === 0) return '(catalog empty — admin needs to seed agent_role_catalog)';
  const byCategory = new Map<string, RoleCatalogEntry[]>();
  for (const e of entries) {
    if (!byCategory.has(e.category)) byCategory.set(e.category, []);
    byCategory.get(e.category)!.push(e);
  }
  const out: string[] = [];
  for (const [cat, items] of byCategory) {
    out.push(`*${cat.toUpperCase()}*`);
    for (const e of items) {
      out.push(`  • ${e.display_default} (${e.role_slug}) — ${e.description}`);
    }
  }
  return out.join('\n');
}

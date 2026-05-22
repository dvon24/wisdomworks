/**
 * MCP server catalog + per-tenant enablement.
 *
 * Foundation only as of 2026-05-22 — owners can browse the catalog,
 * enable a server (records intent + stores credentials), and the
 * capability audit reflects enabled servers. ACTUAL TOOL DISCOVERY +
 * EXECUTION via @modelcontextprotocol/sdk is the next-session piece;
 * see project_mcp_ingestion_plan.md for the full sprint.
 *
 * Schema:
 *   • mcp_server_catalog (global, admin-curated)
 *   • tenant_mcp_servers (per-tenant enablement + auth_config)
 *
 * For MVP, auth_config is stored as JSONB on tenant_mcp_servers. Future
 * security work will move tokens into a separate encrypted column or
 * the credential vault pattern from [[reference_ai_compliance_patterns]].
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

export interface McpServerCatalogEntry {
  server_slug: string;
  display_name: string;
  description: string;
  category: string;
  transport: 'http' | 'stdio' | 'sse';
  default_url: string | null;
  auth_kind: 'none' | 'oauth' | 'api-token' | 'personal-access-token';
  auth_setup_hint: string | null;
  capability_slugs: string[];
  example_tools: string[];
}

export interface TenantMcpServer {
  id: string;
  tenant_phone: string;
  server_slug: string;
  status: 'enabled' | 'disabled' | 'error' | 'revoked';
  auth_config: Record<string, any> | null;
  last_error: string | null;
  enabled_at: string;
}

let catalogCache: { ts: number; rows: McpServerCatalogEntry[] } | null = null;
const CACHE_TTL_MS = 5 * 60_000;

export async function listMcpServerCatalog(): Promise<McpServerCatalogEntry[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  if (catalogCache && Date.now() - catalogCache.ts < CACHE_TTL_MS) {
    return catalogCache.rows;
  }
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/mcp_server_catalog?select=*&order=category,display_name`,
      { headers: headers() },
    );
    if (!res.ok) return catalogCache?.rows ?? [];
    const rows = (await res.json()) as McpServerCatalogEntry[];
    catalogCache = { ts: Date.now(), rows };
    return rows;
  } catch {
    return catalogCache?.rows ?? [];
  }
}

export async function getMcpServerCatalogEntry(slug: string): Promise<McpServerCatalogEntry | null> {
  const all = await listMcpServerCatalog();
  return all.find(s => s.server_slug === slug.toLowerCase().trim()) ?? null;
}

/** List MCP servers enabled for a specific tenant (status='enabled'). */
export async function listTenantMcpServers(tenantPhone: string): Promise<TenantMcpServer[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_mcp_servers?tenant_phone=eq.${cleanPhone}&status=eq.enabled&select=*`,
      { headers: headers() },
    );
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

/**
 * Set of canonical capability slugs satisfied by THIS tenant's enabled
 * MCP servers. Used by capability-audit.ts to upgrade MCP_PENDING checks
 * from "pending until ingestion ships" to "ready (satisfied by X MCP)".
 */
export async function tenantCapabilitiesFromMcp(tenantPhone: string): Promise<Map<string, string>> {
  // Returns Map<capability_slug, display_name> so the audit can say
  // "satisfied by: GitHub MCP" instead of just "ready."
  const enabled = await listTenantMcpServers(tenantPhone);
  if (enabled.length === 0) return new Map();
  const catalog = await listMcpServerCatalog();
  const result = new Map<string, string>();
  for (const t of enabled) {
    const entry = catalog.find(c => c.server_slug === t.server_slug);
    if (!entry) continue;
    for (const cap of entry.capability_slugs) {
      // First-server wins per capability (rare overlap in practice).
      if (!result.has(cap)) result.set(cap, `${entry.display_name} MCP`);
    }
  }
  return result;
}

/**
 * Enable an MCP server for a tenant. Idempotent — re-enabling updates the
 * auth_config + status without creating a new row.
 */
export async function enableMcpServer(args: {
  tenantPhone: string;
  serverSlug: string;
  authConfig?: Record<string, any>;
}): Promise<{ ok: boolean; reason?: string; entry?: TenantMcpServer; catalogEntry?: McpServerCatalogEntry }> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { ok: false, reason: 'supabase_not_configured' };
  const cleanPhone = args.tenantPhone.replace(/[\s\-+()]/g, '');
  const slug = args.serverSlug.toLowerCase().trim();

  const catalogEntry = await getMcpServerCatalogEntry(slug);
  if (!catalogEntry) {
    return { ok: false, reason: `unknown_server:${slug}` };
  }

  // If the server requires auth and the caller didn't provide it, refuse
  // — owner needs to set the token first. The Iris tool wraps this so the
  // chat-side prompt explains how to grab the token from each provider.
  if (catalogEntry.auth_kind !== 'none' && !args.authConfig) {
    return {
      ok: false,
      reason: `auth_required:${catalogEntry.auth_kind}`,
      catalogEntry,
    };
  }

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_mcp_servers?on_conflict=tenant_phone,server_slug`,
      {
        method: 'POST',
        headers: { ...headers(), Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({
          tenant_phone: cleanPhone,
          server_slug: slug,
          status: 'enabled',
          auth_config: args.authConfig ?? null,
          last_error: null,
          updated_at: new Date().toISOString(),
        }),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, reason: `${res.status}: ${text.slice(0, 200)}`, catalogEntry };
    }
    const rows = await res.json();
    const entry = Array.isArray(rows) ? rows[0] : rows;
    return { ok: true, entry, catalogEntry };
  } catch (err: any) {
    return { ok: false, reason: err?.message ?? String(err), catalogEntry };
  }
}

export async function disableMcpServer(args: {
  tenantPhone: string;
  serverSlug: string;
}): Promise<{ ok: boolean; reason?: string }> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { ok: false, reason: 'supabase_not_configured' };
  const cleanPhone = args.tenantPhone.replace(/[\s\-+()]/g, '');
  const slug = args.serverSlug.toLowerCase().trim();
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_mcp_servers?tenant_phone=eq.${cleanPhone}&server_slug=eq.${slug}`,
      {
        method: 'PATCH',
        headers: { ...headers(), Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'disabled', updated_at: new Date().toISOString() }),
      },
    );
    if (!res.ok) return { ok: false, reason: `${res.status}` };
    return { ok: true };
  } catch (err: any) {
    return { ok: false, reason: err?.message ?? String(err) };
  }
}

export function formatCatalogForChat(entries: McpServerCatalogEntry[]): string {
  if (entries.length === 0) return '(MCP catalog empty — admin needs to seed mcp_server_catalog.)';
  const byCategory = new Map<string, McpServerCatalogEntry[]>();
  for (const e of entries) {
    if (!byCategory.has(e.category)) byCategory.set(e.category, []);
    byCategory.get(e.category)!.push(e);
  }
  const out: string[] = [];
  for (const [cat, items] of byCategory) {
    out.push(`*${cat.toUpperCase()}*`);
    for (const e of items) {
      const auth = e.auth_kind === 'none' ? 'no auth' : `needs ${e.auth_kind}`;
      out.push(`  • ${e.display_name} (${e.server_slug}) — ${e.description} [${auth}]`);
    }
  }
  return out.join('\n');
}

/**
 * MCP tool discovery — joins per-tenant enabled MCP servers with their
 * advertised tool lists, transforms each tool into an AnthropicTool, and
 * returns the aggregated tool list ready to merge into iris-brain's tool
 * array.
 *
 * Cache: per-tenant tool list cached for 5 min. Re-fetching MCP tool
 * catalogs on every chat turn would add latency + load to upstream
 * servers. The 5-min TTL also matches the Anthropic prompt cache TTL
 * so cache misses align with breakpoint re-builds.
 *
 * Error handling: a single failing MCP server doesn't break discovery.
 * Failed servers are logged + their last_error reflected back into
 * tenant_mcp_servers so list_my_mcp_servers shows the failure to the
 * owner. The rest of the tools still flow through.
 *
 * Tool name namespacing: every MCP tool gets prefixed `mcp__<slug>__`
 * before being surfaced to Claude — this is what tells executeMcpTool
 * to route the call through the MCP client instead of looking up a
 * built-in handler. Matches the MCP server convention used elsewhere
 * (e.g. mcp__whatsapp__send_message).
 */

import { listTenantMcpServers, getMcpServerCatalogEntry } from './mcp-catalog';
import { listMcpTools } from './mcp-client';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supaHeaders = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

export const MCP_TOOL_PREFIX = 'mcp__';

export interface DiscoveredMcpTool {
  /** Full namespaced tool name surfaced to the model: mcp__<slug>__<name>. */
  fullName: string;
  /** The slug from the catalog (github, vercel, etc). */
  serverSlug: string;
  /** The unprefixed tool name as the MCP server returned it. */
  toolName: string;
  /** Anthropic tool definition ready to drop into the tools array. */
  anthropicTool: {
    name: string;
    description: string;
    input_schema: {
      type: 'object';
      properties: Record<string, any>;
      required?: string[];
    };
  };
  /** Resolved URL + auth so executeMcpTool can route without re-fetching. */
  serverUrl: string;
  authKind: 'none' | 'oauth' | 'api-token' | 'personal-access-token';
  authConfig: Record<string, any> | null;
}

interface TenantCacheEntry {
  ts: number;
  tools: DiscoveredMcpTool[];
}

const TENANT_CACHE_TTL_MS = 5 * 60_000;
const tenantToolCache = new Map<string, TenantCacheEntry>();

/**
 * Discover all MCP tools available to a tenant. Returns the aggregated
 * AnthropicTool array along with a routing map executeMcpTool uses to
 * find the right server for each call.
 */
export async function discoverMcpToolsForTenant(tenantPhone: string): Promise<DiscoveredMcpTool[]> {
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  const cached = tenantToolCache.get(cleanPhone);
  if (cached && Date.now() - cached.ts < TENANT_CACHE_TTL_MS) {
    return cached.tools;
  }

  const enabled = await listTenantMcpServers(cleanPhone);
  if (enabled.length === 0) {
    tenantToolCache.set(cleanPhone, { ts: Date.now(), tools: [] });
    return [];
  }

  const discovered: DiscoveredMcpTool[] = [];
  // Discover all enabled servers in parallel — one slow server shouldn't
  // serialize the others. Failures are isolated per server.
  await Promise.all(enabled.map(async (tenant) => {
    const catalog = await getMcpServerCatalogEntry(tenant.server_slug);
    if (!catalog || !catalog.default_url) {
      await markServerError(cleanPhone, tenant.server_slug, 'catalog_entry_missing_url');
      return;
    }
    const result = await listMcpTools({
      serverUrl: catalog.default_url,
      authKind: catalog.auth_kind,
      authConfig: tenant.auth_config,
    });
    if (!result.ok) {
      console.warn(`[mcp-discover] ${cleanPhone} ${tenant.server_slug}: ${result.reason}`);
      await markServerError(cleanPhone, tenant.server_slug, result.reason);
      return;
    }
    // Clear any prior error since this discovery succeeded.
    if (tenant.last_error) {
      void clearServerError(cleanPhone, tenant.server_slug);
    }
    for (const tool of result.tools) {
      const fullName = `${MCP_TOOL_PREFIX}${tenant.server_slug}__${tool.name}`;
      // Anthropic tool-name regex is [a-zA-Z0-9_-]{1,128}. MCP servers
      // sometimes use dots or slashes — sanitize.
      const safeName = fullName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
      // Coerce MCP inputSchema to Anthropic's required shape:
      // { type: 'object', properties: ..., required?: [...] }
      const rawSchema = tool.inputSchema ?? {};
      const properties = typeof rawSchema.properties === 'object' && rawSchema.properties !== null
        ? rawSchema.properties as Record<string, any>
        : {};
      const required = Array.isArray(rawSchema.required) ? rawSchema.required as string[] : undefined;
      const anthropicSchema: { type: 'object'; properties: Record<string, any>; required?: string[] } = {
        type: 'object',
        properties,
        ...(required ? { required } : {}),
      };
      discovered.push({
        fullName: safeName,
        serverSlug: tenant.server_slug,
        toolName: tool.name,
        anthropicTool: {
          name: safeName,
          description: `[${catalog.display_name} MCP] ${tool.description ?? `Calls ${tool.name} on ${catalog.display_name}.`}`,
          input_schema: anthropicSchema,
        },
        serverUrl: catalog.default_url,
        authKind: catalog.auth_kind,
        authConfig: tenant.auth_config,
      });
    }
  }));

  tenantToolCache.set(cleanPhone, { ts: Date.now(), tools: discovered });
  return discovered;
}

/**
 * Look up a discovered tool by its full namespaced name. Used by the
 * executor when the model calls an mcp__-prefixed tool to find the
 * right server + auth to route through. Re-runs discovery on miss
 * (cache may have expired between tool-list build and tool call).
 */
export async function resolveMcpTool(tenantPhone: string, fullName: string): Promise<DiscoveredMcpTool | null> {
  if (!fullName.startsWith(MCP_TOOL_PREFIX)) return null;
  const tools = await discoverMcpToolsForTenant(tenantPhone);
  return tools.find((t) => t.fullName === fullName) ?? null;
}

/** Force-refresh next call (after enable/disable/auth-rotation). */
export function invalidateMcpToolCache(tenantPhone: string): void {
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  tenantToolCache.delete(cleanPhone);
}

async function markServerError(tenantPhone: string, serverSlug: string, reason: string): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_mcp_servers?tenant_phone=eq.${tenantPhone}&server_slug=eq.${serverSlug}`,
      {
        method: 'PATCH',
        headers: { ...supaHeaders(), Prefer: 'return=minimal' },
        body: JSON.stringify({
          status: 'error',
          last_error: reason.slice(0, 500),
          updated_at: new Date().toISOString(),
        }),
      },
    );
  } catch {
    // Non-fatal — error logging shouldn't break discovery.
  }
}

async function clearServerError(tenantPhone: string, serverSlug: string): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_mcp_servers?tenant_phone=eq.${tenantPhone}&server_slug=eq.${serverSlug}`,
      {
        method: 'PATCH',
        headers: { ...supaHeaders(), Prefer: 'return=minimal' },
        body: JSON.stringify({
          status: 'enabled',
          last_error: null,
          updated_at: new Date().toISOString(),
        }),
      },
    );
  } catch {}
}

/**
 * Minimal HTTP MCP client — JSON-RPC 2.0 over HTTPS POST.
 *
 * Foundation [[mcp_server_catalog]] + [[tenant_mcp_servers]] tables let
 * owners enable MCP servers. This module is the execution layer:
 *
 *   • initializeMcpSession()  — opens the JSON-RPC session (per spec)
 *   • listMcpTools()          — fetches the server's tool catalog
 *   • callMcpTool()           — invokes one tool with args + auth
 *
 * Why a hand-rolled client instead of @modelcontextprotocol/sdk:
 *   - SDK targets stdio transport primarily; serverless can't fork procs.
 *   - HTTP MCP is a thin JSON-RPC layer; ~150 lines vs adding a dep.
 *   - We need fine-grained timeouts + per-call audit logging that the
 *     SDK doesn't expose cleanly.
 *
 * Auth model:
 *   - `none`           — no auth header
 *   - `api-token` / `personal-access-token` — Bearer header from
 *     tenant_mcp_servers.auth_config.token
 *   - `oauth`          — Bearer from .access_token; refresh flow is a
 *     future enhancement (not in this MVP — owners re-enable on expiry).
 *
 * Errors are returned as `{ ok: false, reason }` shapes rather than
 * thrown — the caller (iris-brain) needs to keep functioning even when
 * an MCP server is unreachable. Per-server failures get reflected back
 * into tenant_mcp_servers.last_error so list_my_mcp_servers shows them.
 */

const DEFAULT_TIMEOUT_MS = 8_000;

export interface McpToolDef {
  /** MCP tool name as the server returns it (no prefix). */
  name: string;
  description?: string;
  /** JSON Schema for tool args, per MCP spec — directly usable as
   *  Anthropic tool input_schema. */
  inputSchema?: Record<string, any>;
}

export interface McpCallResult {
  ok: boolean;
  /** Text content the MCP server returned (concatenated from
   *  content[].text blocks). */
  text?: string;
  /** Structured payload (content[].data or content[].resource blocks)
   *  when present — preserved for downstream chaining. */
  data?: any;
  reason?: string;
  /** HTTP / JSON-RPC error code when available, for logging. */
  errorCode?: number;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

function buildAuthHeaders(
  authKind: 'none' | 'oauth' | 'api-token' | 'personal-access-token',
  authConfig: Record<string, any> | null | undefined,
): Record<string, string> {
  if (authKind === 'none' || !authConfig) return {};
  if (authKind === 'oauth') {
    const token = authConfig.access_token ?? authConfig.token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }
  // api-token + personal-access-token — both use Bearer
  const token = authConfig.token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function jsonRpcCall(args: {
  url: string;
  method: string;
  params?: Record<string, any>;
  headers: Record<string, string>;
  timeoutMs?: number;
}): Promise<JsonRpcResponse> {
  const id = Math.floor(Math.random() * 1_000_000);
  const body = {
    jsonrpc: '2.0',
    id,
    method: args.method,
    ...(args.params ? { params: args.params } : {}),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(args.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...args.headers,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: res.status,
          message: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`,
        },
      };
    }
    const json = (await res.json()) as JsonRpcResponse;
    return json;
  } catch (err: any) {
    clearTimeout(timer);
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -1,
        message: err?.name === 'AbortError' ? `timeout after ${args.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms` : (err?.message ?? String(err)),
      },
    };
  }
}

/**
 * MCP `tools/list` — returns the server's tool catalog.
 *
 * We skip the `initialize` handshake for the MVP. The spec recommends
 * it but most HTTP MCP servers accept tools/list directly; if a server
 * rejects we surface the error and the caller falls back. Adding a
 * proper handshake is a one-line change when we hit a server that
 * requires it.
 */
export async function listMcpTools(args: {
  serverUrl: string;
  authKind: 'none' | 'oauth' | 'api-token' | 'personal-access-token';
  authConfig: Record<string, any> | null | undefined;
  timeoutMs?: number;
}): Promise<{ ok: true; tools: McpToolDef[] } | { ok: false; reason: string; errorCode?: number }> {
  const headers = buildAuthHeaders(args.authKind, args.authConfig);
  const resp = await jsonRpcCall({
    url: args.serverUrl,
    method: 'tools/list',
    headers,
    timeoutMs: args.timeoutMs,
  });
  if (resp.error) {
    return { ok: false, reason: resp.error.message, errorCode: resp.error.code };
  }
  const tools = Array.isArray(resp.result?.tools) ? resp.result.tools : [];
  // Normalize MCP tool shape → our McpToolDef. MCP spec uses
  // `inputSchema` (camelCase) which matches what Anthropic wants under
  // `input_schema` — we just rename the field at use site.
  const normalized: McpToolDef[] = tools.map((t: any) => ({
    name: String(t.name ?? ''),
    description: t.description ? String(t.description) : undefined,
    inputSchema: t.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : undefined,
  })).filter((t: McpToolDef) => t.name.length > 0);
  return { ok: true, tools: normalized };
}

/**
 * MCP `tools/call` — invoke one tool with args.
 *
 * MCP responses contain a `content` array of blocks (text, image,
 * resource). We flatten the text blocks into a single string for the
 * model and preserve structured data on `.data` for chaining.
 */
export async function callMcpTool(args: {
  serverUrl: string;
  authKind: 'none' | 'oauth' | 'api-token' | 'personal-access-token';
  authConfig: Record<string, any> | null | undefined;
  toolName: string;
  toolArgs: Record<string, any>;
  timeoutMs?: number;
}): Promise<McpCallResult> {
  const headers = buildAuthHeaders(args.authKind, args.authConfig);
  const resp = await jsonRpcCall({
    url: args.serverUrl,
    method: 'tools/call',
    params: {
      name: args.toolName,
      arguments: args.toolArgs,
    },
    headers,
    timeoutMs: args.timeoutMs,
  });
  if (resp.error) {
    return { ok: false, reason: resp.error.message, errorCode: resp.error.code };
  }
  const result = resp.result ?? {};
  // MCP-side error signaled by `isError: true` even when JSON-RPC succeeded.
  if (result.isError === true) {
    const errText = Array.isArray(result.content)
      ? result.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
      : 'tool returned isError=true with no content';
    return { ok: false, reason: errText.slice(0, 500) };
  }
  const contentBlocks: any[] = Array.isArray(result.content) ? result.content : [];
  const text = contentBlocks
    .filter((c) => c?.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('\n')
    .trim();
  const data = contentBlocks
    .filter((c) => c?.type === 'resource' || c?.type === 'image' || c?.type === 'data')
    .map((c) => c);
  return {
    ok: true,
    text: text.length > 0 ? text : undefined,
    data: data.length > 0 ? data : undefined,
  };
}

/**
 * Capability resolver + connection audit.
 *
 * The catalog declares per-role required_capabilities and optional_capabilities
 * as semantic slugs ("email", "calendar", "accounting", "deployments", etc.).
 * This module knows HOW to check each capability against a tenant's
 * actual connections:
 *   • First-party OAuth → oauth_connections table (provider+service rows)
 *   • Community MCP (future) → tenant_mcp_servers table (introduced when
 *     MCP ingestion ships; until then those capabilities return mcp_pending)
 *
 * Used by:
 *   • add_agent_to_team — pre-flight audit so the owner sees what the new
 *     agent needs before committing.
 *   • audit_agent_connections — post-provisioning re-check ("is Marcus
 *     ready to work?")
 *   • Future: workflow dispatcher could skip steps whose required tools
 *     aren't connected, and Iris could surface that to the owner.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

export type CapabilityStatus =
  | 'ready'         // satisfied — at least one matching connection is active
  | 'missing'       // capability is supported by the platform, owner just hasn't connected
  | 'mcp_pending';  // capability requires MCP ingestion (not yet shipped)

export interface CapabilityCheck {
  capability: string;
  status: CapabilityStatus;
  satisfied_by?: string;        // human-readable description ("Google email", "QuickBooks", "Vercel MCP")
  connect_hint?: string;        // what the owner needs to do to enable
}

interface OAuthConnRow {
  provider: string;
  service: string;
  status: string;
}

/**
 * Map each capability slug to a function that decides whether the tenant's
 * existing connections satisfy it. Returning the matching connection lets
 * the audit show "satisfied by: Google email" instead of just "ready".
 *
 * MCP-only capabilities return { status: 'mcp_pending', connect_hint }
 * until tenant_mcp_servers is wired in (project_mcp_ingestion.md).
 */
type Resolver = (conns: OAuthConnRow[]) => CapabilityCheck;

const FIRST_PARTY_BY_SERVICE = (service: string, providerLabels: Record<string, string>): Resolver =>
  (conns) => {
    const match = conns.find(c => c.service === service && c.status === 'active');
    if (match) {
      const label = providerLabels[match.provider] ?? match.provider;
      return { capability: '', status: 'ready', satisfied_by: `${label} ${service}` };
    }
    const supported = Object.values(providerLabels).join(' / ');
    return {
      capability: '',
      status: 'missing',
      connect_hint: `Connect ${supported} ${service} in the Command Deck's Connections tab.`,
    };
  };

const MCP_PENDING = (capability: string, hint: string): Resolver =>
  () => ({
    capability,
    status: 'mcp_pending',
    connect_hint: hint,
  });

// "spreadsheet" satisfied by EITHER Google Sheets OR Microsoft OneDrive
// Drive (which exposes Excel files). Owners running their finances out of
// Excel get credit for it even though they don't have QuickBooks. Devon's
// 2026-05-22 framing: "most just use a spreadsheet."
const RESOLVE_SPREADSHEET: Resolver = (conns) => {
  const sheets = conns.find(c => c.service === 'sheets' && c.status === 'active');
  if (sheets) return { capability: '', status: 'ready', satisfied_by: 'Google Sheets' };
  const oneDrive = conns.find(c => c.provider === 'microsoft' && c.service === 'drive' && c.status === 'active');
  if (oneDrive) return { capability: '', status: 'ready', satisfied_by: 'Microsoft OneDrive (Excel)' };
  return {
    capability: '',
    status: 'missing',
    connect_hint: 'Connect Google Sheets OR Microsoft OneDrive in the Command Deck — either gives spreadsheet access.',
  };
};

const RESOLVERS: Record<string, Resolver> = {
  // First-party OAuth-backed capabilities
  email: FIRST_PARTY_BY_SERVICE('email', { google: 'Google', microsoft: 'Microsoft', yahoo: 'Yahoo', apple: 'Apple', imap: 'IMAP' }),
  calendar: FIRST_PARTY_BY_SERVICE('calendar', { google: 'Google', microsoft: 'Microsoft', apple: 'Apple' }),
  drive: FIRST_PARTY_BY_SERVICE('drive', { google: 'Google', microsoft: 'OneDrive' }),
  sheets: FIRST_PARTY_BY_SERVICE('sheets', { google: 'Google' }),
  spreadsheet: RESOLVE_SPREADSHEET,
  accounting: FIRST_PARTY_BY_SERVICE('accounting', { google: 'QuickBooks', microsoft: 'QuickBooks' }), // QBO connects via various; provider lookup forgiving
  payments: FIRST_PARTY_BY_SERVICE('payments', { google: 'Stripe', microsoft: 'Stripe' }),
  instagram: FIRST_PARTY_BY_SERVICE('instagram', { meta: 'Meta/Instagram' }),
  booking: FIRST_PARTY_BY_SERVICE('booking', { google: 'Mindbody', microsoft: 'Mindbody' }),
  analytics: FIRST_PARTY_BY_SERVICE('analytics', { google: 'Google Analytics' }),
  'search-console': FIRST_PARTY_BY_SERVICE('search_console', { google: 'Google Search Console' }),

  // MCP-pending (no first-party adapter — needs MCP ingestion to enable)
  'version-control': MCP_PENDING('version-control', 'Requires GitHub MCP (ships with MCP ingestion).'),
  'deployments': MCP_PENDING('deployments', 'Requires Vercel MCP (ships with MCP ingestion).'),
  'error-tracking': MCP_PENDING('error-tracking', 'Requires Sentry MCP (ships with MCP ingestion).'),
  'project-mgmt': MCP_PENDING('project-mgmt', 'Requires Linear / Jira MCP (ships with MCP ingestion).'),
  'claude-code': MCP_PENDING('claude-code', 'Requires Claude Code MCP (ships with MCP ingestion).'),
  'fitness-tracker': MCP_PENDING('fitness-tracker', 'Requires Apple Health / Fitbit / Strava MCP (ships with MCP ingestion). Until then, the agent works from owner check-ins.'),
};

async function loadConnections(cleanPhone: string): Promise<OAuthConnRow[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/oauth_connections?phone_number=eq.${cleanPhone}&select=provider,service,status`,
      { headers: headers() },
    );
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export interface RoleAuditResult {
  ok: boolean;
  role_slug: string;
  required: CapabilityCheck[];
  optional: CapabilityCheck[];
  ready: boolean;          // true iff EVERY required capability is 'ready'
  ready_required_count: number;
  total_required_count: number;
  interpretation: string;
}

function runCapabilityCheck(slug: string, conns: OAuthConnRow[]): CapabilityCheck {
  const resolver = RESOLVERS[slug];
  if (!resolver) {
    return { capability: slug, status: 'mcp_pending', connect_hint: `Unknown capability "${slug}" — admin needs to register a resolver.` };
  }
  const out = resolver(conns);
  return { ...out, capability: slug };
}

/**
 * Audit a tenant's connections against a single role's capability list.
 * Returns ready/missing/mcp_pending per capability, plus an overall
 * "ready" flag (true iff every REQUIRED capability is satisfied).
 */
export async function auditRoleCapabilities(args: {
  tenantPhone: string;
  required: string[];
  optional?: string[];
  roleSlug?: string;
}): Promise<RoleAuditResult> {
  const cleanPhone = args.tenantPhone.replace(/[\s\-+()]/g, '');
  const conns = await loadConnections(cleanPhone);

  const required = (args.required ?? []).map(s => runCapabilityCheck(s, conns));
  const optional = (args.optional ?? []).map(s => runCapabilityCheck(s, conns));

  const readyRequired = required.filter(c => c.status === 'ready').length;
  const totalRequired = required.length;
  const allRequiredReady = readyRequired === totalRequired;

  const reqLines = required.map(c => {
    const badge = c.status === 'ready' ? '✓' : c.status === 'mcp_pending' ? '⏳' : '❌';
    const detail = c.status === 'ready'
      ? c.satisfied_by ? ` (${c.satisfied_by})` : ''
      : c.connect_hint ? ` — ${c.connect_hint}` : '';
    return `  ${badge} ${c.capability}${detail}`;
  });
  const optLines = optional.map(c => {
    const badge = c.status === 'ready' ? '✓' : c.status === 'mcp_pending' ? '⏳' : '○';
    const detail = c.status === 'ready'
      ? c.satisfied_by ? ` (${c.satisfied_by})` : ''
      : c.connect_hint ? ` — ${c.connect_hint}` : '';
    return `  ${badge} ${c.capability}${detail}`;
  });

  const headline = totalRequired === 0
    ? `No required connections for this role — agent will work out of the box.`
    : allRequiredReady
      ? `Ready to work — all ${totalRequired} required connection${totalRequired === 1 ? '' : 's'} are in place.`
      : `${readyRequired}/${totalRequired} required connections ready. The agent will be partially functional until the missing ones are connected.`;

  const sections = [headline];
  if (required.length > 0) sections.push(`\nREQUIRED:\n${reqLines.join('\n')}`);
  if (optional.length > 0) sections.push(`\nOPTIONAL (nice-to-have):\n${optLines.join('\n')}`);

  return {
    ok: true,
    role_slug: args.roleSlug ?? '(unknown)',
    required,
    optional,
    ready: allRequiredReady,
    ready_required_count: readyRequired,
    total_required_count: totalRequired,
    interpretation: sections.join('\n'),
  };
}

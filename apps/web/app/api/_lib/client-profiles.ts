/**
 * Client profiles — owner's customer records.
 *
 * Distinct from `known_people` (owner's personal network like attorney /
 * accountant / partner). Client profiles capture who the owner's BUSINESS
 * serves: visit history, preferences, satisfaction, notes.
 *
 * Agents call into these helpers from the iris-brain via the tool layer.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

export interface ClientProfile {
  id: string;
  tenant_phone: string;
  display_name: string;
  phone: string | null;
  email: string | null;
  preferences: Record<string, any>;
  notes: string | null;
  visit_count: number;
  first_visit_at: string | null;
  last_visit_at: string | null;
  satisfaction_signal: 'positive' | 'neutral' | 'negative' | null;
  vertical_label: string | null;
  source: 'owner_defined' | 'inferred' | 'imported';
  tags: string[];
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface ClientVisit {
  id: string;
  client_profile_id: string;
  tenant_phone: string;
  summary: string;
  channel: string | null;
  satisfaction: 'positive' | 'neutral' | 'negative' | null;
  notes: string | null;
  revenue_usd: number | null;
  occurred_at: string;
  created_at: string;
}

/** Insert or merge a client profile. Returns the profile_id. */
export async function upsertClientProfile(input: {
  tenantPhone: string;
  displayName: string;
  phone?: string;
  email?: string;
  preferences?: Record<string, any>;
  notes?: string;
  verticalLabel?: string;
  source?: 'owner_defined' | 'inferred' | 'imported';
  tags?: string[];
}): Promise<string | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/upsert_client_profile`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        p_tenant_phone: input.tenantPhone.replace(/[\s\-+()]/g, ''),
        p_display_name: input.displayName,
        p_phone: input.phone ?? null,
        p_email: input.email ?? null,
        p_preferences: input.preferences ?? null,
        p_notes: input.notes ?? null,
        p_vertical_label: input.verticalLabel ?? null,
        p_source: input.source ?? 'inferred',
        p_tags: input.tags ?? null,
      }),
    });
    if (!res.ok) {
      console.warn('[client-profiles] upsert failed:', await res.text());
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn('[client-profiles] upsert exception:', err);
    return null;
  }
}

/** Record a visit + bump profile aggregates. Returns visit_id. */
export async function recordClientVisit(input: {
  tenantPhone: string;
  clientProfileId: string;
  summary: string;
  channel?: string;
  satisfaction?: 'positive' | 'neutral' | 'negative';
  notes?: string;
  revenueUsd?: number;
  occurredAt?: string;
}): Promise<string | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/record_client_visit`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        p_tenant_phone: input.tenantPhone.replace(/[\s\-+()]/g, ''),
        p_client_profile_id: input.clientProfileId,
        p_summary: input.summary,
        p_channel: input.channel ?? null,
        p_satisfaction: input.satisfaction ?? null,
        p_notes: input.notes ?? null,
        p_revenue_usd: input.revenueUsd ?? null,
        p_occurred_at: input.occurredAt ?? null,
      }),
    });
    if (!res.ok) {
      console.warn('[client-profiles] record_visit failed:', await res.text());
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn('[client-profiles] record_visit exception:', err);
    return null;
  }
}

/** Fuzzy-find clients for this tenant by name or phone substring. */
export async function lookupClients(input: {
  tenantPhone: string;
  query: string;
  limit?: number;
}): Promise<ClientProfile[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const cleanTenant = input.tenantPhone.replace(/[\s\-+()]/g, '');
  const limit = input.limit ?? 10;
  const q = input.query.trim();
  if (!q) return [];
  // Use PostgREST OR filter: name ILIKE or phone substring
  const cleanQ = q.replace(/[\s\-+()]/g, '');
  const filter = `or=(display_name.ilike.*${encodeURIComponent(q)}*${cleanQ ? `,phone.ilike.*${encodeURIComponent(cleanQ)}*` : ''})`;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/client_profiles?tenant_phone=eq.${cleanTenant}&${filter}&order=last_visit_at.desc.nullslast&limit=${limit}&select=*`,
      { headers: headers() },
    );
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

/** List all client profiles for the tenant, ordered by recency of visit. */
export async function listClients(tenantPhone: string, limit = 50): Promise<ClientProfile[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const cleanTenant = tenantPhone.replace(/[\s\-+()]/g, '');
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/client_profiles?tenant_phone=eq.${cleanTenant}&order=last_visit_at.desc.nullslast&limit=${limit}&select=*`,
      { headers: headers() },
    );
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

/** Load a single client profile by id. */
export async function getClientProfile(profileId: string): Promise<ClientProfile | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/client_profiles?id=eq.${profileId}&select=*&limit=1`,
      { headers: headers() },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

/** Load recent visits for one client. */
export async function listClientVisits(profileId: string, limit = 25): Promise<ClientVisit[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/client_visits?client_profile_id=eq.${profileId}&order=occurred_at.desc&limit=${limit}&select=*`,
      { headers: headers() },
    );
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

/**
 * Render a short text summary of recent clients for the iris-brain
 * prompt. Keeps the team aware of who matters in the business without
 * exploding the context window.
 */
export function renderClientsForPrompt(clients: ClientProfile[]): string {
  if (clients.length === 0) {
    return 'CLIENT PROFILES: none on file yet. When the owner mentions a customer, capture them with add_or_update_client_profile.';
  }
  const lines = ['CLIENT PROFILES (recent visits first):'];
  for (const c of clients.slice(0, 15)) {
    const last = c.last_visit_at ? new Date(c.last_visit_at).toISOString().slice(0, 10) : 'no visits yet';
    const pref = Object.keys(c.preferences).length > 0
      ? ` · prefs: ${Object.entries(c.preferences).slice(0, 3).map(([k, v]) => `${k}=${typeof v === 'string' ? v.slice(0, 40) : JSON.stringify(v).slice(0, 40)}`).join(', ')}`
      : '';
    lines.push(`  • ${c.display_name} (${c.visit_count} visit${c.visit_count === 1 ? '' : 's'}, last ${last}${pref})`);
  }
  if (clients.length > 15) lines.push(`  …and ${clients.length - 15} more.`);
  return lines.join('\n');
}

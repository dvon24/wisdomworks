/**
 * Internal helper — regenerates the `documentation` ontology entity for
 * a tenant by re-running runAxisDiscovery against the current
 * agent_configs + oauth_connections.
 *
 * Called from:
 *   - /api/admin/regenerate-org-doc (admin route, with OWNER_API_TOKEN)
 *   - WhatsApp tools that mutate the team: add_agent_to_team,
 *     remove_agent_from_team, update_agent (rename). Without this,
 *     the deck's team_breakdown and the documentation entity stay
 *     frozen at last deployment and new agents don't appear.
 *
 * Fire-and-forget — failures log but don't throw, because the user-facing
 * mutation should not fail just because doc regen had a hiccup.
 */

import { runAxisDiscovery, type DerivedAgentConfig } from '@wisdomworks/shared';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

export interface RegenerateResult {
  ok: boolean;
  action?: 'insert' | 'update';
  agents_count?: number;
  integrations_count?: number;
  error?: string;
}

export async function regenerateOrgDoc(phone: string): Promise<RegenerateResult> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { ok: false, error: 'supabase not configured' };
  const cleanPhone = String(phone).replace(/[\s\-+()]/g, '');

  try {
    const tenantRes = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_configs?tenant_phone=eq.${cleanPhone}&select=deployment_spec,onboarding_structured&limit=1`,
      { headers: headers() },
    );
    const tenantRows = tenantRes.ok ? await tenantRes.json() : [];
    const tenant = tenantRows[0];
    if (!tenant?.deployment_spec) {
      return { ok: false, error: 'tenant_configs row not found or missing deployment_spec' };
    }

    const agentRes = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_configs?tenant_phone=eq.${cleanPhone}&select=agent_role,agent_name,model_routing,output_channels,governance_rules,status,config&order=created_at.asc`,
      { headers: headers() },
    );
    const agents: DerivedAgentConfig[] = agentRes.ok ? await agentRes.json() : [];

    const connRes = await fetch(
      `${SUPABASE_URL}/rest/v1/oauth_connections?phone_number=eq.${cleanPhone}&status=eq.active&select=provider,service,account_email,status`,
      { headers: headers() },
    );
    const connections = connRes.ok ? await connRes.json() : [];

    const discovery = runAxisDiscovery(
      tenant.deployment_spec,
      tenant.onboarding_structured ?? {},
      connections,
      agents.map((a) => ({
        agent_role: a.agent_role,
        agent_name: a.agent_name,
        model_routing: a.model_routing ?? {},
        output_channels: a.output_channels ?? [],
        governance_rules: a.governance_rules ?? [],
        entity_lookup_name: a.agent_name,
        entity_lookup_type: 'role',
        status: 'pending',
        config: a.config ?? {},
      })),
    );

    const docEntity = discovery.documentation;

    const findRes = await fetch(
      `${SUPABASE_URL}/rest/v1/ontology_entities?tenant_phone=eq.${cleanPhone}&entity_type=eq.documentation&select=id&order=updated_at.desc&limit=1`,
      { headers: headers() },
    );
    const existing = findRes.ok ? await findRes.json() : [];

    if (existing.length > 0) {
      const updateRes = await fetch(
        `${SUPABASE_URL}/rest/v1/ontology_entities?id=eq.${existing[0].id}`,
        {
          method: 'PATCH',
          headers: { ...headers(), Prefer: 'return=minimal' },
          body: JSON.stringify({
            name: docEntity.name,
            metadata: docEntity.metadata,
            source: docEntity.source,
            updated_at: new Date().toISOString(),
          }),
        },
      );
      if (!updateRes.ok) {
        return { ok: false, error: `Update failed: ${await updateRes.text()}` };
      }
      return { ok: true, action: 'update', agents_count: agents.length, integrations_count: discovery.integrations.length };
    } else {
      const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/ontology_entities`, {
        method: 'POST',
        headers: { ...headers(), Prefer: 'return=minimal' },
        body: JSON.stringify({
          tenant_phone: cleanPhone,
          entity_type: 'documentation',
          name: docEntity.name,
          metadata: docEntity.metadata,
          source: docEntity.source,
        }),
      });
      if (!insertRes.ok) {
        return { ok: false, error: `Insert failed: ${await insertRes.text()}` };
      }
      return { ok: true, action: 'insert', agents_count: agents.length, integrations_count: discovery.integrations.length };
    }
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

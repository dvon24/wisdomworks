/**
 * POST /api/admin/regenerate-org-doc
 *
 * Re-runs documentOrganization for a tenant without going through the
 * full deploy-complete flow. Useful when the doc generator's output
 * gets improved (grammar fixes, dedup logic, etc.) and we want existing
 * tenants to pick up the cleaner output without redeploying.
 *
 * Body: { phone: string }
 *
 * Loads: deployment_spec from tenant_configs, agents from agent_configs,
 * connections from oauth_connections. Re-runs runAxisDiscovery and upserts
 * the 'documentation' ontology entity.
 */

import { runAxisDiscovery, type DerivedAgentConfig } from '@wisdomworks/shared';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

export async function POST(request: Request) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return Response.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  try {
    const { phone } = await request.json();
    if (!phone) return Response.json({ error: 'phone required' }, { status: 400 });
    const cleanPhone = String(phone).replace(/[\s\-+()]/g, '');

    // 1. Deployment spec (Story 1.7) — JSONB in tenant_configs
    const tenantRes = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_configs?tenant_phone=eq.${cleanPhone}&select=deployment_spec,onboarding_structured&limit=1`,
      { headers: headers() },
    );
    const tenantRows = tenantRes.ok ? await tenantRes.json() : [];
    const tenant = tenantRows[0];
    if (!tenant?.deployment_spec) {
      return Response.json({ error: 'tenant_configs row not found or missing deployment_spec' }, { status: 404 });
    }

    // 2. Agent configs (Story 1.11)
    const agentRes = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_configs?tenant_phone=eq.${cleanPhone}&select=agent_role,agent_name,model_routing,output_channels,governance_rules,status,config&order=created_at.asc`,
      { headers: headers() },
    );
    const agents: DerivedAgentConfig[] = agentRes.ok ? await agentRes.json() : [];

    // 3. Active oauth connections
    const connRes = await fetch(
      `${SUPABASE_URL}/rest/v1/oauth_connections?phone_number=eq.${cleanPhone}&status=eq.active&select=provider,service,account_email,status`,
      { headers: headers() },
    );
    const connections = connRes.ok ? await connRes.json() : [];

    // 4. Re-run discovery
    const discovery = runAxisDiscovery(
      tenant.deployment_spec,
      tenant.onboarding_structured ?? {},
      connections,
      // Fill in missing optional fields with safe defaults so the type aligns
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

    // 5. Upsert the documentation entity. Match on (tenant_phone, entity_type='documentation')
    // — there should only be one per tenant; replace the metadata.
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
        return Response.json({ error: `Update failed: ${await updateRes.text()}` }, { status: 500 });
      }
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
        return Response.json({ error: `Insert failed: ${await insertRes.text()}` }, { status: 500 });
      }
    }

    return Response.json({
      success: true,
      preview: (docEntity.metadata as any).text,
      integrations_count: discovery.integrations.length,
      agents_count: agents.length,
    });
  } catch (err: any) {
    console.error('[regenerate-org-doc] error:', err);
    return Response.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}

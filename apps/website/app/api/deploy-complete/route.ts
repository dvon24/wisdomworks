/**
 * Deploy Complete — fires when a customer finishes onboarding.
 *
 * This is the single point where the tenant becomes real. Persists the
 * full Epic 1 pipeline to Supabase:
 *   1. whatsapp_contexts.profile.team (legacy + Command Deck consumers)
 *   2. tenant_configs (deployment_spec)
 *   3. ontology_entities + ontology_relationships (incl. documentation entity)
 *   4. agent_configs
 *   5. agent_instances (with operating_protocol)
 *   6. WhatsApp welcome message
 *
 * POST /api/deploy-complete
 * { phoneNumber, businessName, businessType, agentCount, agents,
 *   structured, collectedData }
 */

import {
  generateDeploymentSpec,
  extractOntology,
  deriveAgentConfigs,
  planProvisioning,
  runAxisDiscovery,
} from '@wisdomworks/shared';
import type {
  AxisDeploymentSpec,
  OnboardingData,
  ExtractedOntology,
  DerivedAgentConfig,
  InstancePayload,
  DiscoveryResult,
} from '@wisdomworks/shared';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const GRAPH_API = 'https://graph.facebook.com/v25.0';

// ─── Persistence helpers ────────────────────────────────────────────────────

/**
 * Wipe stale agent_configs / agent_instances / ontology_entities for the
 * tenant before re-running the persistence pipeline. Re-deploys with renamed
 * agents would otherwise coexist with their old config names — confusing for
 * the activity feed and for downstream consumers.
 */
async function resetTenantAgents(supabaseUrl: string, supabaseKey: string, cleanPhone: string): Promise<{ configs: number; ontology: number }> {
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/reset_tenant_agents`, {
      method: 'POST',
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_tenant_phone: cleanPhone }),
    });
    if (!res.ok) {
      console.warn('[deploy-complete] resetTenantAgents failed:', res.status, await res.text());
      return { configs: 0, ontology: 0 };
    }
    const rows = await res.json();
    const row = rows?.[0] ?? {};
    return { configs: row.configs_deleted ?? 0, ontology: row.ontology_deleted ?? 0 };
  } catch (err) {
    console.warn('[deploy-complete] resetTenantAgents error:', err);
    return { configs: 0, ontology: 0 };
  }
}

async function loadConnections(supabaseUrl: string, supabaseKey: string, cleanPhone: string) {
  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/oauth_connections?phone_number=eq.${cleanPhone}&status=eq.active&select=provider,service,account_email,status`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } },
    );
    return res.ok ? await res.json() : [];
  } catch {
    return [];
  }
}

async function saveDeploymentSpec(supabaseUrl: string, supabaseKey: string, cleanPhone: string, spec: AxisDeploymentSpec) {
  const res = await fetch(`${supabaseUrl}/rest/v1/tenant_configs`, {
    method: 'POST',
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({ tenant_phone: cleanPhone, config_type: 'deployment_spec', config: spec }),
  });
  if (!res.ok) console.warn('[deploy-complete] saveDeploymentSpec failed:', res.status, await res.text());
}

async function saveOntology(supabaseUrl: string, supabaseKey: string, cleanPhone: string, ontology: ExtractedOntology) {
  if (!ontology.entities.length && !ontology.relationships.length) return;
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/upsert_ontology`, {
    method: 'POST',
    headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_tenant_phone: cleanPhone, p_entities: ontology.entities, p_relationships: ontology.relationships }),
  });
  if (!res.ok) console.warn('[deploy-complete] saveOntology failed:', res.status, await res.text());
}

async function saveAgentConfigs(supabaseUrl: string, supabaseKey: string, cleanPhone: string, agents: DerivedAgentConfig[]) {
  if (agents.length === 0) return;
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/upsert_agent_configs`, {
    method: 'POST',
    headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_tenant_phone: cleanPhone, p_agents: agents }),
  });
  if (!res.ok) console.warn('[deploy-complete] saveAgentConfigs failed:', res.status, await res.text());
}

async function provisionAgents(supabaseUrl: string, supabaseKey: string, cleanPhone: string, instances: InstancePayload[]) {
  if (instances.length === 0) return;
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/provision_agents`, {
    method: 'POST',
    headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_tenant_phone: cleanPhone, p_instances: instances }),
  });
  if (!res.ok) console.warn('[deploy-complete] provisionAgents failed:', res.status, await res.text());
}

async function loadProtocolOverride(supabaseUrl: string, supabaseKey: string, cleanPhone: string): Promise<any | null> {
  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/tenant_configs?tenant_phone=eq.${cleanPhone}&config_type=eq.operating_protocol&select=config`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return rows[0]?.config ?? null;
  } catch {
    return null;
  }
}

/**
 * Run the full Epic 1 persistence pipeline. Order matters:
 * spec → ontology → discovery (refines spec) → agent_configs → provisioning.
 */
async function persistEpic1Pipeline(
  supabaseUrl: string,
  supabaseKey: string,
  cleanPhone: string,
  collectedData: OnboardingData,
  structured: any,
): Promise<{
  spec: AxisDeploymentSpec | null;
  ontologyCount: number;
  agentCount: number;
  instanceCount: number;
  discovery: DiscoveryResult | null;
  error: string | null;
}> {
  try {
    // Story 1.11 fix — wipe any stale agents/ontology from earlier deploys
    // so renamed agents (e.g. template defaults → AI-generated names) don't
    // pile up. tenant_configs is upserted-by-key so it overwrites cleanly.
    const reset = await resetTenantAgents(supabaseUrl, supabaseKey, cleanPhone);
    if (reset.configs > 0 || reset.ontology > 0) {
      console.log(`[deploy-complete] reset stale rows: configs=${reset.configs} ontology=${reset.ontology}`);
    }

    const spec = generateDeploymentSpec(collectedData);
    await saveDeploymentSpec(supabaseUrl, supabaseKey, cleanPhone, spec);

    // Ontology first so discovery's documentation entity can reference roles
    const ontology = extractOntology(structured ?? {}, spec);
    await saveOntology(supabaseUrl, supabaseKey, cleanPhone, ontology);

    // Agent configs (link to ontology by name in upsert)
    const derivedAgents = deriveAgentConfigs(spec, structured ?? {});
    await saveAgentConfigs(supabaseUrl, supabaseKey, cleanPhone, derivedAgents);

    // Discovery: fetch real connections, enrich integrations, write docs entity
    const connections = await loadConnections(supabaseUrl, supabaseKey, cleanPhone);
    const discovery = runAxisDiscovery(spec, structured ?? {}, connections, derivedAgents);
    spec.integrations = discovery.integrations;
    await saveDeploymentSpec(supabaseUrl, supabaseKey, cleanPhone, spec);
    await saveOntology(supabaseUrl, supabaseKey, cleanPhone, {
      entities: [discovery.documentation],
      relationships: spec.organization?.name
        ? [{
            from_type: 'department',
            from_name: spec.organization.name,
            to_type: 'documentation',
            to_name: discovery.documentation.name,
            relationship_type: 'owns',
          }]
        : [],
    });

    // Provisioning with operating-protocol override
    const protocolOverride = await loadProtocolOverride(supabaseUrl, supabaseKey, cleanPhone);
    const instances = planProvisioning(cleanPhone, spec, derivedAgents, protocolOverride);
    await provisionAgents(supabaseUrl, supabaseKey, cleanPhone, instances);

    // Auto-start: flip the freshly-provisioned 'ready' agents to 'running'
    // so the cron (and the user's first manual tick) actually fires them.
    // Otherwise users would have to know to call action='start' separately.
    try {
      await fetch(`${supabaseUrl}/rest/v1/agent_instances?tenant_phone=eq.${cleanPhone}&status=eq.ready`, {
        method: 'PATCH',
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ status: 'running' }),
      });
    } catch (err) {
      console.warn('[deploy-complete] auto-start failed (agents will start on first manual tick):', err);
    }

    return {
      spec,
      ontologyCount: ontology.entities.length,
      agentCount: derivedAgents.length,
      instanceCount: instances.length,
      discovery,
      error: null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[deploy-complete] Epic 1 pipeline failed:', msg);
    return { spec: null, ontologyCount: 0, agentCount: 0, instanceCount: 0, discovery: null, error: msg };
  }
}

// ─── Route ──────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      phoneNumber,
      businessName,
      businessType,
      agentCount,
      agents,
      structured,
      collectedData,
    } = body as {
      phoneNumber: string;
      businessName?: string;
      businessType?: string;
      agentCount?: number;
      agents?: any[];
      structured?: any;
      collectedData?: OnboardingData;
    };

    if (!phoneNumber) {
      return Response.json({ error: 'No phone number' }, { status: 400 });
    }

    const cleanPhone = phoneNumber.replace(/[\s\-\+\(\)]/g, '');
    const phoneId = process.env.WHATSAPP_PHONE_ID;
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    let pipelineResult: any = null;

    // 1. Persist tenant context (whatsapp_contexts) — legacy/profile team
    if (supabaseUrl && supabaseKey) {
      try {
        const ctxRes = await fetch(
          `${supabaseUrl}/rest/v1/whatsapp_contexts?phone_number=eq.${cleanPhone}&select=profile`,
          { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } },
        );
        const rows = ctxRes.ok ? await ctxRes.json() : [];
        const profile = rows[0]?.profile ?? { preferences: {}, activeTopics: [] };
        profile.team = agents ?? [];
        profile.businessName = businessName;
        profile.businessType = businessType;
        profile.agentCount = agentCount ?? (agents?.length ?? 0);
        profile.deployedAt = new Date().toISOString();
        profile.tenantStatus = 'active';
        profile.activatedAt = new Date().toISOString();

        const now = new Date().toISOString();
        const upsertRes = await fetch(`${supabaseUrl}/rest/v1/whatsapp_contexts`, {
          method: 'POST',
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates,return=minimal',
          },
          body: JSON.stringify({
            phone_number: cleanPhone,
            name: businessName,
            business_name: businessName,
            business_type: businessType,
            is_owner: true,
            conversation_history: [],
            profile,
            first_seen: now,
            last_seen: now,
            message_count: 0,
          }),
        });
        if (!upsertRes.ok) {
          console.error('[deploy-complete] whatsapp_contexts UPSERT failed:', await upsertRes.text());
        }

        // 2. Run the full Epic 1 persistence pipeline
        if (collectedData || structured) {
          // Reconstruct OnboardingData from whatever the client passed
          const onboardingData: OnboardingData = {
            ...(collectedData ?? {}),
            organizationName: collectedData?.organizationName ?? businessName,
            businessType: collectedData?.businessType ?? businessType,
            industry: collectedData?.industry ?? businessType,
          };
          pipelineResult = await persistEpic1Pipeline(
            supabaseUrl,
            supabaseKey,
            cleanPhone,
            onboardingData,
            structured,
          );
          if (pipelineResult.error) {
            console.warn('[deploy-complete] Epic 1 pipeline error:', pipelineResult.error);
          } else {
            console.log(
              `[deploy-complete] Epic 1 persisted: ontology=${pipelineResult.ontologyCount} agents=${pipelineResult.agentCount} instances=${pipelineResult.instanceCount}`,
            );
          }
        }
      } catch (e) {
        console.error('[deploy-complete] persistence error:', e);
      }
    }

    if (!phoneId || !accessToken) {
      console.warn('[deploy-complete] WhatsApp not configured');
      return Response.json({ success: true, welcomeSent: false, pipeline: pipelineResult });
    }

    // 3. WhatsApp welcome message
    const assistantName = agents?.[0]?.name ?? 'Your AI Assistant';
    const agentList = (agents ?? [])
      .slice(0, 5)
      .map((a: any) => `- ${a.name}: ${a.role}`)
      .join('\n');

    const welcome = [
      `Hi! I'm ${assistantName}, your personal AI assistant from WisdomWorks.`,
      ``,
      `Your AI team of ${agentCount ?? 'several'} agents is now live and working for ${businessName ?? 'your business'}.`,
      ``,
      `Here's your team:`,
      agentList || '- Your personal assistant (that\'s me!)',
      ``,
      `I'm available 24/7. Here's what I can do right now:`,
      `- Answer questions about your business`,
      `- Manage your schedule and appointments`,
      `- Draft emails and messages for your approval`,
      `- Send you a daily briefing every morning`,
      `- Find improvements and build solutions for you`,
      ``,
      `Try texting me something like:`,
      `"What's on my schedule today?"`,
      `"Draft a follow-up email for my last client"`,
      `"How can we get more bookings?"`,
      ``,
      `I'm here whenever you need me.`,
    ].join('\n');

    const sendResult = await fetch(`${GRAPH_API}/${phoneId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: cleanPhone,
        type: 'text',
        text: { body: welcome },
      }),
    });

    const sendData = await sendResult.json();
    const welcomeSent = sendResult.ok;
    if (!welcomeSent) console.error('[deploy-complete] Welcome message failed:', sendData);
    else console.log(`[deploy-complete] Welcome sent to ${cleanPhone} for ${businessName}`);

    return Response.json({
      success: true,
      welcomeSent,
      pipeline: pipelineResult,
      dashboardUrl: '/dashboard',
    });
  } catch (error) {
    console.error('[deploy-complete] Error:', error);
    return Response.json({ error: String(error) }, { status: 500 });
  }
}

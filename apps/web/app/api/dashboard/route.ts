/**
 * Command Deck data loader.
 *
 * GET /api/dashboard?phone=+491703604562
 *
 * Returns everything the Command Deck needs to render real data:
 * - User profile (business name, type)
 * - Active OAuth connections
 * - Today's calendar events (cached from calendar-sync cron)
 * - Pending email drafts (cached from email-sift cron)
 * - Conversation history (last messages with Iris)
 */

import { NextResponse } from 'next/server';
import { computeMonthlyUsage, evaluateBudget, recordOverageIfExceeded } from '../_lib/usage-tracker';
import { requireOwnerAuth } from '../_lib/api-auth';
import { listClients } from '../_lib/client-profiles';
import { listOpenInsights } from '../_lib/business-insights';

export const dynamic = 'force-dynamic';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const phone = url.searchParams.get('phone');

  // Story 6.1 deadbolt — must be authenticated as this tenant
  const denied = await requireOwnerAuth(request, phone);
  if (denied) return denied;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  // requireOwnerAuth guarantees phone is non-null on success
  const cleanPhone = phone!.replace(/[\s\-+()]/g, '');

  try {
    const headers = {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    };

    // Fetch everything in parallel — the new Epic 1 tables sit alongside
    // whatsapp_contexts so the deck can render real structural data.
    const [
      contextRes,
      connectionsRes,
      docRes,
      configsRes,
      instancesRes,
      runsRes,
    ] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${cleanPhone}&select=*`, { headers }),
      fetch(
        `${SUPABASE_URL}/rest/v1/oauth_connections?phone_number=eq.${cleanPhone}&status=eq.active&select=provider,service,account_email,account_name,scopes,created_at`,
        { headers },
      ),
      fetch(
        `${SUPABASE_URL}/rest/v1/ontology_entities?tenant_phone=eq.${cleanPhone}&entity_type=eq.documentation&select=name,metadata,updated_at&order=updated_at.desc&limit=1`,
        { headers },
      ),
      fetch(
        `${SUPABASE_URL}/rest/v1/agent_configs?tenant_phone=eq.${cleanPhone}&select=id,agent_name,agent_role,status,output_channels,model_routing,config`,
        { headers },
      ),
      fetch(
        `${SUPABASE_URL}/rest/v1/agent_instances?tenant_phone=eq.${cleanPhone}&select=id,agent_config_id,status,nats_subjects,signal_connections,metadata`,
        { headers },
      ),
      // Story 2.1b/c — recent agent_runs for the activity feed (incl. delegation)
      fetch(
        `${SUPABASE_URL}/rest/v1/agent_runs?tenant_phone=eq.${cleanPhone}&order=started_at.desc&limit=50&select=agent_instance_id,trigger,outcome,output_summary,metadata,started_at,duration_ms,tokens_in,tokens_out,delegated_to_lane,delegation_reason,delegation_status`,
        { headers },
      ),
    ]);

    const contextRows = contextRes.ok ? await contextRes.json() : [];
    const connections = connectionsRes.ok ? await connectionsRes.json() : [];
    const docRows = docRes.ok ? await docRes.json() : [];
    const agentConfigs = configsRes.ok ? await configsRes.json() : [];
    const agentInstances = instancesRes.ok ? await instancesRes.json() : [];
    const agentRunRows = runsRes.ok ? await runsRes.json() : [];
    const ctx = contextRows[0] ?? null;

    if (!ctx) {
      return NextResponse.json({
        error: 'No tenant found for that phone number',
        hint: 'Complete onboarding first',
      }, { status: 404 });
    }

    const profile = ctx.profile ?? {};
    const todaysCalendar = profile.todaysCalendar ?? [];
    const pendingEmailDrafts = profile.pendingEmailDrafts ?? [];

    // Build activity feed from real data
    const activity: Array<{ agent: string; action: string; time: string; ts: number }> = [];

    // Recent emails processed
    if (pendingEmailDrafts.length > 0) {
      activity.push({
        agent: 'Email Agent',
        action: `Drafted ${pendingEmailDrafts.length} replies awaiting your approval`,
        time: 'just now',
        ts: Date.now(),
      });
    }

    // Today's calendar fetched
    if (profile.todaysCalendarFetchedAt) {
      const fetched = new Date(profile.todaysCalendarFetchedAt);
      activity.push({
        agent: 'Calendar Agent',
        action: `Synced ${todaysCalendar.length} events for today`,
        time: timeAgo(fetched),
        ts: fetched.getTime(),
      });
    }

    // Recent OAuth connections
    for (const conn of connections.slice(0, 3)) {
      activity.push({
        agent: 'Setup',
        action: `Connected ${conn.provider} ${conn.service}`,
        time: timeAgo(new Date(conn.created_at)),
        ts: new Date(conn.created_at).getTime(),
      });
    }

    // Recent WhatsApp turns — surface under the personal-assistant slot.
    // conversation_history alternates user/assistant; pair them up so each
    // entry represents one exchange.
    const history = (ctx.conversation_history ?? []) as Array<{ role: string; content: string; timestamp?: string }>;
    const irisName = profile.team?.[0]?.name ?? 'Iris';
    // Walk from newest backward, take up to 5 most recent user→assistant pairs
    let pairs = 0;
    for (let i = history.length - 1; i > 0 && pairs < 5; i--) {
      const assistantTurn = history[i];
      const userTurn = history[i - 1];
      if (assistantTurn?.role !== 'assistant' || userTurn?.role !== 'user') continue;
      const ts = assistantTurn.timestamp ? new Date(assistantTurn.timestamp).getTime() : Date.now();
      const userPreview = userTurn.content.slice(0, 60).replace(/\s+/g, ' ').trim();
      activity.push({
        agent: irisName,
        action: `Replied to "${userPreview}${userTurn.content.length > 60 ? '…' : ''}" via WhatsApp`,
        time: timeAgo(new Date(ts)),
        ts,
      });
      pairs++;
      i--; // skip the user turn we just consumed
    }

    // Story 2.1b — agent_runs into the activity feed.
    // Build an instance_id → agent_name map by joining the two tables.
    const cfgById = new Map<string, any>();
    for (const c of agentConfigs) cfgById.set(c.id, c);
    const instanceIdToAgent = new Map<string, { name: string; role: string }>();
    for (const inst of agentInstances as any[]) {
      const cfg = cfgById.get(inst.agent_config_id);
      if (cfg) instanceIdToAgent.set(inst.id, { name: cfg.agent_name, role: cfg.agent_role });
    }

    // Build a richer agentRuns array (used by the deck for grouped view)
    // and ALSO push a few headline runs into the legacy activity array
    // so the existing flat fallback still has signal.
    const enrichedRuns = agentRunRows
      .map((run: any) => {
        const agent = instanceIdToAgent.get(run.agent_instance_id);
        if (!agent) return null;
        return {
          agentName: agent.name,
          agentRole: agent.role,
          agentId: (agent.name || '').toLowerCase().replace(/\s+/g, '-'),
          trigger: run.trigger,
          outcome: run.outcome,
          summary: run.output_summary ?? '',
          recommendation: run.metadata?.recommendation ?? null,
          escalationPriority: run.metadata?.escalation_priority ?? 'none',
          proposedAction: run.metadata?.proposed_action ?? null,
          category: run.metadata?.category ?? null,
          delegatedToLane: run.delegated_to_lane ?? null,
          delegationReason: run.delegation_reason ?? null,
          delegationStatus: run.delegation_status ?? null,
          tokensIn: run.tokens_in,
          tokensOut: run.tokens_out,
          durationMs: run.duration_ms,
          startedAt: run.started_at,
        };
      })
      .filter(Boolean);

    // Headline runs into legacy activity (skip no_op)
    const meaningfulRuns = agentRunRows.filter((r: any) => r.outcome !== 'no_op').slice(0, 8);
    for (const run of meaningfulRuns) {
      const agent = instanceIdToAgent.get(run.agent_instance_id);
      if (!agent) continue;
      const ts = new Date(run.started_at).getTime();
      const outcome = run.outcome;
      const delegated = run.delegated_to_lane ? ` → ${run.delegated_to_lane}` : '';
      const verb = outcome === 'escalated' ? '⚡ flagged'
        : outcome === 'proposed' ? 'proposed'
        : outcome === 'acted' ? 'did'
        : outcome === 'failed' ? '⚠ failed'
        : 'observed';
      const summary = (run.output_summary ?? '').replace(/\s+/g, ' ');
      activity.push({
        agent: agent.name,
        action: `${verb}${delegated}: ${summary}`,
        time: timeAgo(new Date(ts)),
        ts,
      });
    }

    // Sort by recency
    activity.sort((a, b) => b.ts - a.ts);

    // Build agent team summary from saved AI structured data (if available)
    const team = profile.team ?? null;

    // Story 1.13/1.14 surfacing — documentation entity + per-agent operating
    // protocol from the new Epic 1 tables.
    const documentation = docRows[0] ? {
      name: docRows[0].name,
      text: docRows[0].metadata?.text ?? '',
      generatedAt: docRows[0].metadata?.generated_at ?? docRows[0].updated_at,
    } : null;

    // Per-agent details keyed by hierarchy id (lowercased name with hyphens)
    // so the deck can look them up by selectedAgent.id without caring which
    // table holds what. Joins agent_configs to agent_instances by id.
    const instanceByConfigId = new Map<string, any>();
    for (const inst of agentInstances) instanceByConfigId.set(inst.agent_config_id, inst);

    // Story 2b.9 — connected projects per agent (Au7o, WisdomWorks, etc.)
    // so the deck can show "Connected: X" on each agent's detail panel.
    const projectsByConfigId = new Map<string, any[]>();
    try {
      const projRes = await fetch(
        `${SUPABASE_URL}/rest/v1/project_connections?tenant_phone=eq.${cleanPhone}&status=eq.active&select=id,project_name,provider,agent_config_id,last_synced_at,last_sync_error,metadata`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
      );
      if (projRes.ok) {
        const projs = await projRes.json();
        for (const p of projs) {
          if (!p.agent_config_id) continue;
          const list = projectsByConfigId.get(p.agent_config_id) ?? [];
          list.push({
            id: p.id,
            projectName: p.project_name,
            provider: p.provider,
            lastSyncedAt: p.last_synced_at,
            lastSyncError: p.last_sync_error,
            deployUrl: p.metadata?.deploy_url,
            repoUrl: p.metadata?.repo_url,
          });
          projectsByConfigId.set(p.agent_config_id, list);
        }
      }
    } catch (err) {
      console.warn('[dashboard] project_connections fetch failed:', err);
    }

    const agentDetails: Record<string, any> = {};
    for (const cfg of agentConfigs) {
      const key = (cfg.agent_name || '').toLowerCase().replace(/\s+/g, '-');
      const inst = instanceByConfigId.get(cfg.id);
      const proto = inst?.metadata?.operating_protocol ?? {};
      agentDetails[key] = {
        configId: cfg.id,
        agentName: cfg.agent_name,
        agentRole: cfg.agent_role,
        configStatus: cfg.status,
        outputChannels: cfg.output_channels,
        modelRouting: cfg.model_routing,
        tier: cfg.config?.tier,
        category: cfg.config?.category ?? null,
        categoryLabel: cfg.config?.category_label ?? null,
        categoryEmoji: cfg.config?.category_emoji ?? null,
        categoryDomain: cfg.config?.category_domain ?? null,
        instanceStatus: inst?.status ?? null,
        autonomyLevel: proto.autonomyLevel ?? null,
        topology: inst?.metadata?.topology ?? null,
        natsSubjects: inst?.nats_subjects ?? [],
        signalConnections: inst?.signal_connections ?? [],
        escalationTriggers: proto.escalationTriggers ?? [],
        projects: projectsByConfigId.get(cfg.id) ?? [],
      };
    }

    // Story 2.1c — usage + budget for the current calendar month.
    // Budget is the spec's monthlyBase from the saved deployment_spec
    // (falls back to $50 to match the deposit).
    let usage = null as any;
    let budget = null as any;
    try {
      const usageData = await computeMonthlyUsage(cleanPhone);
      if (usageData) {
        const specRes = await fetch(
          `${SUPABASE_URL}/rest/v1/tenant_configs?tenant_phone=eq.${cleanPhone}&config_type=eq.deployment_spec&select=config`,
          { headers },
        );
        const specRows = specRes.ok ? await specRes.json() : [];
        const monthlyBudget = specRows[0]?.config?.pricing?.monthlyBase ?? 50;
        usage = usageData;
        budget = evaluateBudget(usageData, monthlyBudget);
        // Emit overage event if we've crossed the included budget. Idempotent
        // by period — safe to call on every dashboard load.
        void recordOverageIfExceeded(cleanPhone, usageData, budget);
      }
    } catch (err) {
      console.warn('[dashboard] usage computation failed:', err);
    }

    // Adaptive ticking — record this deck visit as a user-activity signal
    // so the cron knows to stay in fast-tick band while Devon is using the deck.
    if (ctx) {
      try {
        const updatedProfile = { ...profile, lastDeckVisit: new Date().toISOString() };
        await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${cleanPhone}`, {
          method: 'PATCH',
          headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ profile: updatedProfile }),
        });
      } catch {
        // Non-fatal — activity tracking is opportunistic
      }
    }

    // Story 2b.2 — open insights (best-effort, non-fatal)
    let insights: any[] = [];
    try {
      const rows = await listOpenInsights(cleanPhone, 30);
      insights = rows.map((i) => ({
        id: i.id,
        detector: i.detector,
        severity: i.severity,
        title: i.title,
        why: i.why,
        recommendedAction: i.recommended_action,
        expectedImpact: i.expected_impact,
        confidence: i.confidence,
        payload: i.payload,
        status: i.status,
        detectedAt: i.detected_at,
        expiresAt: i.expires_at,
      }));
    } catch (err) {
      console.warn('[dashboard] insights fetch failed:', err);
    }

    // Story 2b.1 — load recent client profiles (best-effort, non-fatal)
    let clients: any[] = [];
    try {
      const rows = await listClients(cleanPhone, 50);
      clients = rows.map((c) => ({
        id: c.id,
        displayName: c.display_name,
        phone: c.phone,
        email: c.email,
        preferences: c.preferences,
        notes: c.notes,
        visitCount: c.visit_count,
        firstVisitAt: c.first_visit_at,
        lastVisitAt: c.last_visit_at,
        satisfactionSignal: c.satisfaction_signal,
        tags: c.tags,
        source: c.source,
      }));
    } catch (err) {
      console.warn('[dashboard] client profiles fetch failed:', err);
    }

    return NextResponse.json({
      user: {
        phone: cleanPhone,
        name: ctx.name,
        businessName: ctx.business_name,
        businessType: ctx.business_type,
        isOwner: ctx.is_owner,
      },
      verticalTemplate: profile.vertical_template ?? null,
      clients,
      insights,
      connections: connections.map((c: any) => ({
        provider: c.provider,
        service: c.service,
        accountEmail: c.account_email,
        accountName: c.account_name,
      })),
      todaysCalendar,
      pendingEmailDrafts: pendingEmailDrafts.map((d: any) => ({
        id: d.id,
        from: d.from,
        subject: d.subject,
        classification: d.classification,
      })),
      activity: activity.slice(0, 20),
      agentRuns: enrichedRuns,
      team,
      documentation,
      agentDetails,
      usage,
      budget,
      messageCount: ctx.message_count ?? 0,
      lastSeen: ctx.last_seen,
    });
  } catch (err) {
    console.error('[dashboard] Error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

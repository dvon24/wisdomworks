/**
 * POST /api/admin/health-check
 *
 * Single-shot diagnostic that introspects whether all the Epic 2a
 * features have actually fired in real activity. Counts what's in the
 * DB across every learning + observation system so we can either
 * celebrate (it's working) or find the bug (it's not).
 *
 * Body: { phone: string }
 * Returns: { ok, summary, details } — details is a nested report keyed by feature.
 */

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

async function count(path: string): Promise<number> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}&select=*`, {
      headers: { ...headers(), Prefer: 'count=exact', Range: '0-0' },
    });
    if (!res.ok) return -1;
    const range = res.headers.get('content-range') ?? '';
    const total = range.split('/')[1];
    return total ? parseInt(total, 10) : 0;
  } catch {
    return -1;
  }
}

async function list(path: string): Promise<any[]> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: headers() });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export async function POST(request: Request) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return Response.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  try {
    const { phone } = await request.json();
    if (!phone) return Response.json({ error: 'phone required' }, { status: 400 });
    const cleanPhone = String(phone).replace(/[\s\-+()]/g, '');
    const sinceDays7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const sinceDays1 = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const phoneFilter = `tenant_phone=eq.${cleanPhone}`;

    // ─── Agent runs (heartbeat) ─────────────────────────────────────────
    const [
      totalRuns7d, noOpRuns7d, observedRuns7d, proposedRuns7d, actedRuns7d, escalatedRuns7d, failedRuns7d,
      runsLast24h, runsToday,
    ] = await Promise.all([
      count(`agent_runs?${phoneFilter}&started_at=gte.${sinceDays7}`),
      count(`agent_runs?${phoneFilter}&started_at=gte.${sinceDays7}&outcome=eq.no_op`),
      count(`agent_runs?${phoneFilter}&started_at=gte.${sinceDays7}&outcome=eq.observed`),
      count(`agent_runs?${phoneFilter}&started_at=gte.${sinceDays7}&outcome=eq.proposed`),
      count(`agent_runs?${phoneFilter}&started_at=gte.${sinceDays7}&outcome=eq.acted`),
      count(`agent_runs?${phoneFilter}&started_at=gte.${sinceDays7}&outcome=eq.escalated`),
      count(`agent_runs?${phoneFilter}&started_at=gte.${sinceDays7}&outcome=eq.failed`),
      count(`agent_runs?${phoneFilter}&started_at=gte.${sinceDays1}`),
      count(`agent_runs?${phoneFilter}&started_at=gte.${new Date(new Date().setHours(0, 0, 0, 0)).toISOString()}`),
    ]);

    // ─── Story 2.11 — BMAD solution briefs ─────────────────────────────
    const solutionBriefs = await list(`agent_runs?${phoneFilter}&metadata->>solution_brief=not.is.null&order=started_at.desc&limit=5&select=started_at,output_summary,metadata`);

    // ─── Story 2.9 — Knowledge base ────────────────────────────────────
    const [kbChunks, kbEntities] = await Promise.all([
      count(`knowledge_chunks?${phoneFilter}`),
      count(`ontology_entities?${phoneFilter}`),
    ]);

    // ─── Story 2.10 — Recovery snapshots ───────────────────────────────
    const [snapshotsTotal, recoveryTestSnapshots] = await Promise.all([
      count(`agent_state_snapshots?${phoneFilter}`),
      count(`agent_state_snapshots?${phoneFilter}&reason=eq.recovery_test`),
    ]);

    // ─── Story 2.13 — Classification learning ──────────────────────────
    const [corrections, classifySamples] = await Promise.all([
      count(`email_classification_corrections?${phoneFilter}`),
      count(`email_classification_samples?${phoneFilter}&created_at=gte.${sinceDays7}`),
    ]);

    // ─── Story 2.14 — Process detection ────────────────────────────────
    const [processObserved, processProposed, processApproved, processAutomated] = await Promise.all([
      count(`process_records?${phoneFilter}&automation_status=eq.observed`),
      count(`process_records?${phoneFilter}&automation_status=eq.proposed`),
      count(`process_records?${phoneFilter}&automation_status=eq.approved`),
      count(`process_records?${phoneFilter}&automation_status=eq.automated`),
    ]);

    // ─── Story 2.15 — Skill formation ──────────────────────────────────
    const [skillsTotal, skillsRetired] = await Promise.all([
      count(`agent_skills?${phoneFilter}&retired_at=is.null`),
      count(`agent_skills?${phoneFilter}&retired_at=not.is.null`),
    ]);
    const topSkills = await list(`agent_skills?${phoneFilter}&retired_at=is.null&order=success_count.desc&limit=5&select=lane,technique_signature,description,success_count,failure_count`);

    // ─── Email intelligence ────────────────────────────────────────────
    const [voiceProfileRows, knownPeopleTotal, knownPeopleOwner, knownPeopleAuto, emailContacts, followups, followupsPending] = await Promise.all([
      list(`email_voice_profiles?${phoneFilter}&select=sample_size,last_built_at`),
      count(`known_people?${phoneFilter}`),
      count(`known_people?${phoneFilter}&source=eq.owner_defined`),
      count(`known_people?${phoneFilter}&source=neq.owner_defined`),
      count(`email_contacts?${phoneFilter}`),
      count(`email_followup_proposals?${phoneFilter}`),
      count(`email_followup_proposals?${phoneFilter}&status=eq.pending`),
    ]);

    // ─── Project connections (Au7o etc.) ───────────────────────────────
    const [projectConns, projectSnapshots] = await Promise.all([
      count(`project_connections?${phoneFilter}`),
      count(`project_snapshots?${phoneFilter}`),
    ]);

    // ─── Notification queue ────────────────────────────────────────────
    const [notifsTotal, notifsPending, notifsDelivered] = await Promise.all([
      count(`notification_queue?${phoneFilter}&created_at=gte.${sinceDays7}`),
      count(`notification_queue?${phoneFilter}&status=eq.pending`),
      count(`notification_queue?${phoneFilter}&status=eq.delivered&created_at=gte.${sinceDays7}`),
    ]);

    // ─── Tool call counts (which agent tools actually got used) ────────
    // Sample 100 recent runs and count which tools appeared
    const recentRuns = await list(`agent_runs?${phoneFilter}&started_at=gte.${sinceDays7}&order=started_at.desc&limit=100&select=metadata`);
    const toolCallCounts: Record<string, number> = {};
    for (const r of recentRuns) {
      const calls = r.metadata?.tool_calls;
      if (Array.isArray(calls)) {
        for (const c of calls) {
          const name = c?.name ?? c;
          if (typeof name === 'string') toolCallCounts[name] = (toolCallCounts[name] ?? 0) + 1;
        }
      }
    }

    const details = {
      agent_runtime: {
        runs_last_7d: totalRuns7d,
        runs_last_24h: runsLast24h,
        runs_today: runsToday,
        by_outcome_7d: {
          no_op: noOpRuns7d,
          observed: observedRuns7d,
          proposed: proposedRuns7d,
          acted: actedRuns7d,
          escalated: escalatedRuns7d,
          failed: failedRuns7d,
        },
      },
      bmad_solution_briefs: {
        produced: solutionBriefs.length,
        recent: solutionBriefs.slice(0, 3).map((r) => ({
          at: r.started_at,
          summary: r.output_summary?.slice(0, 100),
          brief: r.metadata?.solution_brief,
        })),
      },
      knowledge_base: {
        entities: kbEntities,
        chunks: kbChunks,
        status: kbChunks > 0 ? 'ingested' : 'empty',
      },
      recovery_snapshots: {
        total: snapshotsTotal,
        recovery_tests_run: recoveryTestSnapshots,
        status: recoveryTestSnapshots > 0 ? 'tested' : 'never tested',
      },
      classification_learning: {
        corrections: corrections,
        classifications_last_7d: classifySamples,
        status: corrections > 0 ? 'learning' : 'no corrections yet',
      },
      process_detection: {
        observed: processObserved,
        proposed: processProposed,
        approved: processApproved,
        automated: processAutomated,
        status: processProposed > 0 ? 'has surfaced proposals' : (processObserved > 0 ? 'observing, none proposed yet' : 'empty'),
      },
      skill_formation: {
        active: skillsTotal,
        retired: skillsRetired,
        top_5: topSkills,
        status: skillsTotal > 0 ? 'mining successfully' : 'empty',
      },
      email_intelligence: {
        voice_profile: voiceProfileRows[0] ? { sample_size: voiceProfileRows[0].sample_size, last_built_at: voiceProfileRows[0].last_built_at } : null,
        known_people: { total: knownPeopleTotal, owner_defined: knownPeopleOwner, auto_mined: knownPeopleAuto },
        contacts: emailContacts,
        followups: { total: followups, pending: followupsPending },
      },
      project_connections: {
        connections: projectConns,
        snapshots: projectSnapshots,
      },
      notifications: {
        last_7d: notifsTotal,
        pending: notifsPending,
        delivered_7d: notifsDelivered,
      },
      tool_call_counts_last_100_runs: toolCallCounts,
    };

    // Quick top-level summary
    const summary: { working: string[]; empty: string[]; alerts: string[] } = {
      working: [],
      empty: [],
      alerts: [],
    };
    if (totalRuns7d > 0) summary.working.push(`Agent runtime: ${totalRuns7d} runs in 7d`);
    if (skillsTotal > 0) summary.working.push(`Skill formation: ${skillsTotal} active skills`);
    if (kbChunks > 0) summary.working.push(`Knowledge base: ${kbChunks} chunks`);
    if (voiceProfileRows[0]) summary.working.push(`Voice profile: ${voiceProfileRows[0].sample_size} samples`);
    if (knownPeopleTotal > 0) summary.working.push(`Known people: ${knownPeopleTotal} (${knownPeopleOwner} owner-defined)`);
    if (followups > 0) summary.working.push(`Follow-ups: ${followups} (${followupsPending} pending)`);
    if (corrections > 0) summary.working.push(`Classification learning: ${corrections} corrections`);

    if (solutionBriefs.length === 0) summary.empty.push('No BMAD solution briefs produced yet');
    if (recoveryTestSnapshots === 0) summary.empty.push('Recovery test never run');
    if (processProposed === 0) summary.empty.push('No processes proposed for automation');
    if (projectConns === 0) summary.empty.push('No projects connected (Au7o + WisdomWorks need wiring)');

    if (failedRuns7d > totalRuns7d * 0.2 && totalRuns7d > 5) summary.alerts.push(`High failure rate: ${failedRuns7d}/${totalRuns7d} runs failed`);

    return Response.json({ ok: true, summary, details });
  } catch (err: any) {
    console.error('[health-check] error:', err);
    return Response.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}

/**
 * Marketing loop — L3/L4 proactive content cron.
 *
 * Once a day per tenant:
 *   1. Expire stale proposed drafts (older than expires_at).
 *   2. For each L3/L4 tenant, run draft detector on cadence.
 *   3. For L4 tenants, auto-execute drafts that pass the eligibility gate
 *      (channel allow-list + confidence threshold + per-day cap +
 *      blocked-words). Everything else stays in proposed for owner review.
 *
 * Schedule: vercel.json — '0 8 * * *' (08:00 UTC daily, just after the
 * morning briefing so proposed drafts can ride the next day's digest).
 */

import { NextResponse } from 'next/server';
import {
  runDraftDetector,
  expireStaleDrafts,
  listDrafts,
  loadAutonomyPrefs,
  evaluateAutoPublishEligibility,
  countAutoPublishedToday,
  approveDraft,
} from '../../_lib/marketing-drafts';
import { enqueueNotification } from '../../_lib/notifications';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) return new Response('Unauthorized', { status: 401 });
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  try {
    const expired = await expireStaleDrafts();

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/whatsapp_contexts?is_owner=eq.true&select=phone_number`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
    );
    const tenants: { phone_number: string }[] = res.ok ? await res.json() : [];

    let totalProposed = 0;
    let totalAutoPublished = 0;
    let totalAutoPublishBlocked = 0;
    const errors: string[] = [];

    for (const t of tenants) {
      // 1. Propose new drafts on cadence (L3+ only — runDraftDetector gates on level)
      try {
        const r = await runDraftDetector(t.phone_number);
        totalProposed += r.proposed;
        if (r.proposed > 0) {
          console.log(`[marketing-loop] ${t.phone_number}: proposed ${r.proposed} draft${r.proposed === 1 ? '' : 's'}`);
        }
      } catch (err: any) {
        console.warn(`[marketing-loop] detector failed for ${t.phone_number}:`, err);
        errors.push(`${t.phone_number}: detector ${err?.message ?? String(err)}`);
      }

      // 2. L4 auto-publish path — execute eligible drafts without waiting for owner
      try {
        const prefs = await loadAutonomyPrefs(t.phone_number);
        if (prefs.autonomy_level !== 'L4') continue;

        const open = await listDrafts(t.phone_number, 'proposed');
        if (open.length === 0) continue;

        const publishedToday = await countAutoPublishedToday(t.phone_number);
        let remainingCap = Math.max(0, prefs.max_auto_publish_per_day - publishedToday);

        // Sort highest-confidence first so the cap goes to the best ideas
        const sorted = [...open].sort((a, b) => {
          const ca = ((a.metadata as any)?.confidence ?? 0) as number;
          const cb = ((b.metadata as any)?.confidence ?? 0) as number;
          return cb - ca;
        });

        for (const draft of sorted) {
          if (remainingCap <= 0) break;

          const gate = evaluateAutoPublishEligibility(draft, prefs, publishedToday);
          if (!gate.eligible) {
            totalAutoPublishBlocked++;
            // Surface why so owner can adjust guardrails if it keeps blocking
            await enqueueNotification({
              tenantPhone: t.phone_number,
              kind: 'agent_observation',
              severity: 'low',
              title: `Auto-publish blocked: ${draft.topic.slice(0, 60)}`,
              body: `Reason${gate.reasons.length === 1 ? '' : 's'}: ${gate.reasons.join('; ')}.\nDraft stays in your inbox — approve or dismiss as usual.`,
              sourceAgent: 'marketing-loop',
              sourceId: draft.id,
            });
            continue;
          }

          const exec = await approveDraft(draft.id, { generate: true, autoPublish: true });
          if (exec.ok && exec.publishedPostId) {
            totalAutoPublished++;
            remainingCap--;
            await enqueueNotification({
              tenantPhone: t.phone_number,
              kind: 'agent_observation',
              severity: 'medium',
              title: `Auto-published: ${draft.topic.slice(0, 60)}`,
              body: `Posted to ${draft.channel}. Post id: ${exec.publishedPostId}.\nCaption: "${draft.caption.slice(0, 200)}"\n\nReply "regenerate ${draft.id.slice(0, 8)}" if you want to retry with a different angle.`,
              sourceAgent: 'marketing-loop',
              sourceId: draft.id,
            });
          } else {
            await enqueueNotification({
              tenantPhone: t.phone_number,
              kind: 'agent_observation',
              severity: 'high',
              title: `Auto-publish failed: ${draft.topic.slice(0, 60)}`,
              body: `Reason: ${exec.error ?? 'unknown'}. Draft moved to failed; you can re-propose.`,
              sourceAgent: 'marketing-loop',
              sourceId: draft.id,
            });
          }
        }
      } catch (err: any) {
        console.warn(`[marketing-loop] auto-publish failed for ${t.phone_number}:`, err);
        errors.push(`${t.phone_number}: auto-publish ${err?.message ?? String(err)}`);
      }
    }

    return NextResponse.json({
      ok: true,
      tenants: tenants.length,
      expired_drafts: expired,
      proposed_drafts: totalProposed,
      auto_published: totalAutoPublished,
      auto_publish_blocked: totalAutoPublishBlocked,
      errors,
    });
  } catch (err) {
    console.error('[marketing-loop] error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

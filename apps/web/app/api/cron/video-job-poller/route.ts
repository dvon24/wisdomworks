/**
 * Video job poller — completes the async video-generation pipeline.
 *
 * The WhatsApp webhook can't synchronously wait for Replicate (60s cap
 * vs 30-180s actual). The generate_marketing_video tool kicks off the
 * prediction and persists a video_generation_jobs row in status='pending'.
 * This cron polls Replicate for pending predictions every 2 minutes and:
 *   - On succeeded: sends the preview to the owner's WhatsApp + bumps
 *     style use_count + marks job 'delivered'
 *   - On failed / canceled: notifies owner + marks job 'failed'
 *   - On timeout (>20min stuck pending): marks 'timed_out' + notifies
 *
 * Schedule: every 2 minutes (low latency for the owner, light on
 * Replicate's API).
 */

import { NextResponse } from 'next/server';
import {
  getPredictionStatus,
  startVideoGeneration,
  getFallbackModelRef,
  getQualityTimeoutMinutes,
} from '../../_lib/integrations/replicate-video';
import { sendWhatsAppVideo } from '../../_lib/whatsapp-media-send';
import { recordStyleUsed } from '../../_lib/marketing-styles';
import { sendOwnerMessage } from '../../_lib/owner-message';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

interface PendingJob {
  id: string;
  tenant_phone: string;
  prediction_id: string;
  model_ref: string;
  quality: string;
  prompt: string;
  caption: string | null;
  style_id: string | null;
  style_name: string | null;
  estimated_cost_usd: number;
  timeout_at: string;
  started_at: string;
  draft_id: string | null;
  auto_publish: boolean;
  metadata?: Record<string, unknown>;
}

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
    // Pull pending jobs (oldest first so first-in-first-out delivery)
    const pendingRes = await fetch(
      `${SUPABASE_URL}/rest/v1/video_generation_jobs?status=eq.pending&order=started_at.asc&limit=20&select=*`,
      { headers: headers() },
    );
    const jobs: PendingJob[] = pendingRes.ok ? await pendingRes.json() : [];
    if (jobs.length === 0) {
      return NextResponse.json({ ok: true, pending: 0, delivered: 0, failed: 0, timed_out: 0 });
    }

    let delivered = 0;
    let failed = 0;
    let timedOut = 0;
    let fallbackRetried = 0;
    const errors: string[] = [];

    for (const job of jobs) {
      // Timeout check first — if stuck past timeout_at, abandon OR retry
      // with a fallback model. For "fast" tier we have an alternate model
      // configured (seedance → wan-2.1) so we don't waste the owner's
      // time when the primary model is hung.
      if (Date.now() > new Date(job.timeout_at).getTime()) {
        const quality = job.quality as 'fast' | 'standard' | 'premium';
        const fallbackRef = getFallbackModelRef(quality);
        const alreadyTriedFallback = !!(job.metadata && (job.metadata as any).fallback_attempted);

        if (fallbackRef && !alreadyTriedFallback) {
          // Auto-retry with the alt model. Same job row gets re-pointed
          // at the new prediction_id; metadata records what happened so
          // a second timeout doesn't loop forever.
          const retry = await startVideoGeneration({
            prompt: job.prompt,
            quality,
            modelRefOverride: fallbackRef,
          });
          if (retry.ok && retry.predictionId) {
            const newTimeoutAt = new Date(Date.now() + getQualityTimeoutMinutes(quality) * 60_000).toISOString();
            await markJob(job.id, {
              prediction_id: retry.predictionId,
              model_ref: retry.modelRef ?? fallbackRef,
              timeout_at: newTimeoutAt,
              metadata: {
                ...(job.metadata as any ?? {}),
                fallback_attempted: true,
                original_prediction_id: job.prediction_id,
                original_model_ref: job.model_ref,
              },
            });
            await notifyOwner(job, `⏱ ${job.model_ref} hung — auto-retrying with the fallback model (${retry.modelRef}). Should land in another 30-90 seconds.`);
            fallbackRetried++;
            continue;
          }
          // Fallback start itself failed — fall through to the regular timeout
          errors.push(`fallback start failed for ${job.id}: ${retry.error}`);
        }

        const timeoutLabel = job.quality === 'fast' ? '5 minutes' : job.quality === 'standard' ? '8 minutes' : '15 minutes';
        await markJob(job.id, { status: 'timed_out', error: `Stuck pending >${timeoutLabel}`, completed_at: new Date().toISOString() });
        await notifyOwner(job, `⏱ Video generation timed out (${job.model_ref}). The model didn't respond in ${timeoutLabel}${alreadyTriedFallback ? ' even after a fallback retry' : ''}. This is usually a Replicate-side capacity issue with that specific model — try again in a few minutes, or use a different quality tier.`);
        timedOut++;
        continue;
      }

      const status = await getPredictionStatus(job.prediction_id);
      if (!status.ok) {
        // Transient API failure — don't fail the job yet, just log
        errors.push(`${job.prediction_id}: ${status.error}`);
        continue;
      }

      if (status.status === 'succeeded' && status.videoUrl) {
        // If this job is linked to a draft, persist the video_url on the draft
        if (job.draft_id) {
          try {
            await fetch(`${SUPABASE_URL}/rest/v1/marketing_drafts?id=eq.${job.draft_id}`, {
              method: 'PATCH',
              headers: { ...headers(), Prefer: 'return=minimal' },
              body: JSON.stringify({ video_url: status.videoUrl }),
            });
          } catch (err) {
            console.warn('[video-job-poller] draft update failed:', err);
          }
        }

        // Bump style use_count once per successful generation
        if (job.style_id) void recordStyleUsed(job.style_id);

        // Auto-publish path (L4 draft approval) — call approveDraft with
        // autoPublish=true. The video_url is already on the draft so
        // approveDraft skips generation and goes straight to publish.
        if (job.draft_id && job.auto_publish) {
          try {
            const { approveDraft } = await import('../../_lib/marketing-drafts');
            const pubResult = await approveDraft(job.draft_id, { generate: false, autoPublish: true });
            await markJob(job.id, {
              status: 'delivered',
              video_url: status.videoUrl,
              completed_at: new Date().toISOString(),
              delivered_at: new Date().toISOString(),
              error: pubResult.ok ? null : `Auto-publish failed: ${pubResult.error}`,
            });
            await sendOwnerMessage({
              tenantPhone: job.tenant_phone,
              body: pubResult.ok
                ? `✓ Auto-published draft ${job.draft_id.slice(0, 8)} to Instagram. Post id: ${pubResult.publishedPostId ?? 'pending'}.`
                : `Generated draft ${job.draft_id.slice(0, 8)} but auto-publish failed: ${pubResult.error}. Reply "publish ${job.draft_id.slice(0, 8)}" to try again manually.`,
              source: 'marketing-loop',
            });
            delivered++;
            continue;
          } catch (err: any) {
            errors.push(`auto-publish ${job.id}: ${err?.message ?? String(err)}`);
          }
        }

        // Preview path — send the video to WhatsApp + a follow-up text
        // with next-step guidance.
        const captionText = job.caption ?? `Generated reel (${job.quality}, ~$${Number(job.estimated_cost_usd).toFixed(2)})`;
        const sent = await sendWhatsAppVideo({
          to: job.tenant_phone,
          videoUrl: status.videoUrl,
          caption: captionText,
        });
        await markJob(job.id, {
          status: sent.ok ? 'delivered' : 'failed',
          video_url: status.videoUrl,
          completed_at: new Date().toISOString(),
          delivered_at: sent.ok ? new Date().toISOString() : null,
          error: sent.ok ? null : `WhatsApp delivery failed: ${sent.error}`,
        });
        if (sent.ok) {
          delivered++;
          const styleLine = job.style_name ? `\nStyle: ${job.style_name}` : '';
          const nextStep = job.draft_id
            ? `Reply "publish ${job.draft_id.slice(0, 8)}" to post as a Reel, or "regenerate ${job.draft_id.slice(0, 8)} with <new angle>" to try again.`
            : `Reply "publish it" to post as an Instagram Reel, or "regenerate with <new angle>" to try again.`;
          await sendOwnerMessage({
            tenantPhone: job.tenant_phone,
            // source 'marketing-loop', NOT 'iris' — 'iris' maps to chat_reply
            // priority, which bypasses the outbound queue, the active-chat
            // hold AND the mute check for what is cron output.
            body: `✓ Video preview above. Quality: ${job.quality} · est. $${Number(job.estimated_cost_usd).toFixed(2)}${styleLine}\n\n${nextStep}`,
            source: 'marketing-loop',
          });
        } else {
          failed++;
        }
        continue;
      }

      if (status.status === 'failed' || status.status === 'canceled') {
        await markJob(job.id, {
          status: 'failed',
          error: status.error ?? `Replicate ${status.status}`,
          completed_at: new Date().toISOString(),
        });
        await notifyOwner(job, `❌ Video generation failed: ${status.error ?? status.status}. Try again or describe the scene differently.`);
        failed++;
        continue;
      }

      // Still 'starting' or 'processing' — leave pending, next tick
    }

    return NextResponse.json({
      ok: true,
      pending: jobs.length,
      delivered,
      failed,
      timed_out: timedOut,
      transient_errors: errors,
    });
  } catch (err) {
    console.error('[video-job-poller] error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

async function markJob(id: string, patch: Record<string, unknown>): Promise<void> {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/video_generation_jobs?id=eq.${id}`, {
      method: 'PATCH',
      headers: { ...headers(), Prefer: 'return=minimal' },
      body: JSON.stringify(patch),
    });
  } catch (err) {
    console.warn('[video-job-poller] markJob failed:', err);
  }
}

async function notifyOwner(job: PendingJob, message: string): Promise<void> {
  try {
    // 'marketing-loop' not 'iris' — cron output must not ride chat_reply priority.
    await sendOwnerMessage({ tenantPhone: job.tenant_phone, body: message, source: 'marketing-loop' });
  } catch (err) {
    console.warn('[video-job-poller] notifyOwner failed:', err);
  }
}

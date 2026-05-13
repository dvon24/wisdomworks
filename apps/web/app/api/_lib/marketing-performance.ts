/**
 * Marketing performance tracking + L4 autonomy safety net.
 *
 * Once a draft publishes, we snapshot engagement every ~12h for 7 days.
 * The data fuels two things:
 *   1. Owner-facing analytics ("here's what's working")
 *   2. Autonomy guard — if L4 auto-publishes underperform vs the tenant's
 *      baseline, the guard auto-drops L4 → L3 with a cooldown so the
 *      owner regains control before more bad posts go out.
 *
 * The performance score is intentionally simple: weighted sum of
 * likes + 2×comments + 3×saves + (reach/1000), normalized by hours since
 * publish so a 2-day-old post isn't unfairly compared to a 6h-old one.
 */

import { fetchInstagramPostMetrics } from './integrations/meta-business';
import { loadConnectionsForPhone, decryptToken } from '@wisdomworks/shared';
import { saveAutonomyPrefs, loadAutonomyPrefs } from './marketing-drafts';
import { enqueueNotification } from './notifications';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

export interface PostMetricsRow {
  id: string;
  tenant_phone: string;
  draft_id: string | null;
  channel: string;
  platform_post_id: string;
  auto_published: boolean;
  like_count: number;
  comments_count: number;
  reach: number | null;
  impressions: number | null;
  saves: number | null;
  performance_score: number | null;
  published_at: string;
  last_synced_at: string;
  metadata: Record<string, unknown>;
}

function computeScore(m: {
  like_count: number;
  comments_count: number;
  saves?: number | null;
  reach?: number | null;
  published_at: string;
}): number {
  const hoursSince = Math.max(1, (Date.now() - new Date(m.published_at).getTime()) / 3_600_000);
  const raw =
    m.like_count +
    2 * m.comments_count +
    3 * (m.saves ?? 0) +
    (m.reach ?? 0) / 1000;
  // Hour-discounted so 2d-old isn't unfairly compared to fresh posts
  return Number((raw / Math.sqrt(hoursSince)).toFixed(2));
}

/** Track a freshly-published post so future cron snapshots find it. */
export async function trackPostPublished(input: {
  tenantPhone: string;
  draftId?: string | null;
  channel: string;
  platformPostId: string;
  autoPublished: boolean;
  publishedAt?: string;
}): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  const cleanPhone = input.tenantPhone.replace(/[\s\-+()]/g, '');
  try {
    await fetch(
      `${SUPABASE_URL}/rest/v1/marketing_post_metrics?on_conflict=tenant_phone,platform_post_id`,
      {
        method: 'POST',
        headers: { ...headers(), Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({
          tenant_phone: cleanPhone,
          draft_id: input.draftId ?? null,
          channel: input.channel,
          platform_post_id: input.platformPostId,
          auto_published: input.autoPublished,
          published_at: input.publishedAt ?? new Date().toISOString(),
        }),
      },
    );
  } catch (err) {
    console.warn('[marketing-perf] trackPostPublished failed:', err);
  }
}

/**
 * Snapshot engagement for all tracked posts <8 days old. Designed to be
 * idempotent and cheap — only re-syncs posts whose last_synced_at is
 * older than ~12h.
 */
export async function snapshotAllRecent(tenantPhone: string): Promise<{
  synced: number;
  errors: number;
}> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { synced: 0, errors: 0 };
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');

  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
  const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();

  let rows: PostMetricsRow[] = [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/marketing_post_metrics?tenant_phone=eq.${cleanPhone}&published_at=gte.${eightDaysAgo}&or=(last_synced_at.lt.${twelveHoursAgo},performance_score.is.null)&select=*`,
      { headers: headers() },
    );
    if (res.ok) rows = await res.json();
  } catch {}

  if (rows.length === 0) return { synced: 0, errors: 0 };

  // Need IG access token for this tenant
  const connections = await loadConnectionsForPhone(cleanPhone);
  const igConn = (connections as any[]).find((c) => c.provider === 'meta' && c.service === 'instagram');
  if (!igConn) return { synced: 0, errors: 0 };

  let token: string;
  try {
    token = await decryptToken(igConn.access_token);
  } catch {
    return { synced: 0, errors: 0 };
  }

  let synced = 0;
  let errors = 0;
  for (const row of rows) {
    if (row.channel !== 'instagram_reel' && row.channel !== 'instagram_post') {
      // Facebook Page insights would need a separate path — skip for now
      continue;
    }
    const m = await fetchInstagramPostMetrics({ accessToken: token, mediaId: row.platform_post_id });
    if (!m.ok) {
      errors++;
      continue;
    }
    const updated = {
      like_count: m.likeCount ?? row.like_count,
      comments_count: m.commentsCount ?? row.comments_count,
      reach: m.reach ?? row.reach,
      impressions: m.impressions ?? row.impressions,
      saves: m.saves ?? row.saves,
      last_synced_at: new Date().toISOString(),
    };
    const score = computeScore({
      like_count: updated.like_count,
      comments_count: updated.comments_count,
      saves: updated.saves,
      reach: updated.reach,
      published_at: row.published_at,
    });
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/marketing_post_metrics?id=eq.${row.id}`, {
        method: 'PATCH',
        headers: { ...headers(), Prefer: 'return=minimal' },
        body: JSON.stringify({ ...updated, performance_score: score }),
      });
      synced++;
    } catch {
      errors++;
    }
  }
  return { synced, errors };
}

/**
 * Returns the tenant's typical post performance — median score of the
 * last 12 owner-approved (non-auto) posts. Used as the baseline for L4
 * comparison. Falls back to a reasonable default if not enough data.
 */
export async function computeBaseline(tenantPhone: string): Promise<{
  baseline: number;
  sampleSize: number;
}> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { baseline: 5, sampleSize: 0 };
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/marketing_post_metrics?tenant_phone=eq.${cleanPhone}&auto_published=eq.false&performance_score=not.is.null&order=published_at.desc&limit=12&select=performance_score`,
      { headers: headers() },
    );
    if (!res.ok) return { baseline: 5, sampleSize: 0 };
    const rows = (await res.json()) as { performance_score: number }[];
    if (rows.length < 3) return { baseline: 5, sampleSize: rows.length };
    const scores = rows.map((r) => r.performance_score).sort((a, b) => a - b);
    const mid = Math.floor(scores.length / 2);
    const median = scores.length % 2 === 0 ? (scores[mid - 1]! + scores[mid]!) / 2 : scores[mid]!;
    return { baseline: Number(median.toFixed(2)), sampleSize: scores.length };
  } catch {
    return { baseline: 5, sampleSize: 0 };
  }
}

/**
 * Autonomy guard — if the tenant is L4 and their last 3+ auto-published
 * posts are scoring <50% of baseline, demote to L3 with a 7-day cooldown.
 *
 * Returns the action taken so the caller (cron) can log + notify.
 */
export async function runAutonomyGuard(tenantPhone: string): Promise<{
  action: 'none' | 'demoted_l4_to_l3' | 'cooldown_active';
  reason?: string;
}> {
  const prefs = await loadAutonomyPrefs(tenantPhone);
  if (prefs.autonomy_level !== 'L4') return { action: 'none' };

  // If we recently demoted, hold off — don't oscillate
  const cooldownUntilRaw = (prefs as any).l4_cooldown_until as string | null | undefined;
  if (cooldownUntilRaw && new Date(cooldownUntilRaw).getTime() > Date.now()) {
    return { action: 'cooldown_active', reason: `cooldown until ${cooldownUntilRaw}` };
  }

  // Pull last 3 auto-published posts with scored metrics
  if (!SUPABASE_URL || !SUPABASE_KEY) return { action: 'none' };
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/marketing_post_metrics?tenant_phone=eq.${cleanPhone}&auto_published=eq.true&performance_score=not.is.null&order=published_at.desc&limit=3&select=performance_score,published_at`,
      { headers: headers() },
    );
    if (!res.ok) return { action: 'none' };
    const recent = (await res.json()) as { performance_score: number; published_at: string }[];
    if (recent.length < 3) return { action: 'none', reason: 'not enough auto-publish data yet' };

    // Only consider posts old enough to have meaningful engagement (>=24h)
    const matureCount = recent.filter((r) => Date.now() - new Date(r.published_at).getTime() >= 24 * 60 * 60 * 1000).length;
    if (matureCount < 3) return { action: 'none', reason: 'posts too fresh to evaluate' };

    const { baseline, sampleSize } = await computeBaseline(tenantPhone);
    if (sampleSize < 3) return { action: 'none', reason: 'not enough owner-approved baseline' };

    const allUnder = recent.every((r) => r.performance_score < baseline * 0.5);
    if (!allUnder) return { action: 'none' };

    // Demote: L4 → L3, set 7-day cooldown
    const cooldownUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const reason = `last 3 auto-published posts averaged ${(recent.reduce((s, r) => s + r.performance_score, 0) / 3).toFixed(1)} vs your baseline ${baseline} (50% threshold)`;
    await saveAutonomyPrefs(cleanPhone, {
      autonomy_level: 'L3',
      l4_cooldown_until: cooldownUntil,
      l4_cooldown_reason: reason,
    } as any);

    await enqueueNotification({
      tenantPhone: cleanPhone,
      kind: 'agent_observation',
      severity: 'high',
      title: 'Marketing autonomy paused (L4 → L3)',
      body: `${reason}. Auto-publishing is paused for 7 days; drafts will still come for your approval. To resume earlier, reply "raise marketing autonomy to L4".`,
      sourceAgent: 'marketing-perf',
    });

    return { action: 'demoted_l4_to_l3', reason };
  } catch (err: any) {
    return { action: 'none', reason: `error: ${err?.message ?? String(err)}` };
  }
}

/**
 * Pull the tenant's recent post performance for owner-facing dashboards
 * or chat queries ("how are my posts doing").
 */
export async function recentPerformance(tenantPhone: string, limit = 10): Promise<PostMetricsRow[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/marketing_post_metrics?tenant_phone=eq.${cleanPhone}&order=published_at.desc&limit=${limit}&select=*`,
      { headers: headers() },
    );
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

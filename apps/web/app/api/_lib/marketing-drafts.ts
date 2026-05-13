/**
 * Marketing drafts — L3 proactive content pipeline.
 *
 * Marketing-loop cron (or marketing agent on a tick) generates draft
 * reel/post concepts → stored here → surfaced in daily digest → owner
 * approves/dismisses via WhatsApp → approved drafts run through video
 * generation + publish flow.
 *
 * Lifecycle:
 *   proposed → approved → published    (happy path)
 *   proposed → dismissed                (owner declined)
 *   proposed → expired                  (7-day timeout, no action)
 *   proposed → failed                   (publish step errored)
 *
 * Autonomy ladder (per tenant in marketing_autonomy_prefs):
 *   L1 — manual only (owner triggers everything)
 *   L2 — draft + approve (default — Iris drafts on-demand, owner approves)
 *   L3 — propose proactively (cron generates drafts, owner approves)
 *   L4 — autonomous within guardrails (auto-publish if confidence ≥ threshold)
 */

import { generateVideo, estimateGenerationCost } from './integrations/replicate-video';
import { publishInstagramReel, publishFacebookPagePost } from './integrations/meta-business';
import { enqueueNotification } from './notifications';
import { findStyleByName, recordStyleUsed } from './marketing-styles';
import { loadConnectionsForPhone, decryptToken } from '@wisdomworks/shared';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

export type DraftSource = 'cadence' | 'event_driven' | 'owner_requested';
export type DraftChannel = 'instagram_reel' | 'instagram_post' | 'facebook_post' | 'tiktok';
export type DraftStatus = 'proposed' | 'approved' | 'dismissed' | 'published' | 'failed' | 'expired';
export type AutonomyLevel = 'L1' | 'L2' | 'L3' | 'L4';

export interface MarketingDraft {
  id: string;
  tenant_phone: string;
  source: DraftSource;
  channel: DraftChannel;
  topic: string;
  caption: string;
  prompt: string | null;
  hashtags: string[];
  style_id: string | null;
  estimated_cost_usd: number;
  video_url: string | null;
  published_post_id: string | null;
  status: DraftStatus;
  proposed_at: string;
  approved_at: string | null;
  dismissed_at: string | null;
  published_at: string | null;
  failed_at: string | null;
  failure_reason: string | null;
  expires_at: string;
  trigger_atom_ids: string[];
  metadata: Record<string, unknown>;
}

export interface AutonomyPrefs {
  tenant_phone: string;
  autonomy_level: AutonomyLevel;
  max_auto_publish_per_day: number;
  min_confidence_for_auto: number;
  blocked_words: string[];
  auto_publish_channels: DraftChannel[];
  draft_cadence_days: number;
  last_draft_at: string | null;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────

export interface ProposeDraftInput {
  tenantPhone: string;
  source?: DraftSource;
  channel?: DraftChannel;
  topic: string;
  caption: string;
  prompt?: string;
  hashtags?: string[];
  styleId?: string;
  estimatedCostUsd?: number;
  triggerAtomIds?: string[];
  metadata?: Record<string, unknown>;
}

export async function proposeDraft(input: ProposeDraftInput): Promise<MarketingDraft | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const cleanPhone = input.tenantPhone.replace(/[\s\-+()]/g, '');
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/marketing_drafts`, {
      method: 'POST',
      headers: { ...headers(), Prefer: 'return=representation' },
      body: JSON.stringify({
        tenant_phone: cleanPhone,
        source: input.source ?? 'cadence',
        channel: input.channel ?? 'instagram_reel',
        topic: input.topic.slice(0, 200),
        caption: input.caption.slice(0, 2200),
        prompt: input.prompt?.slice(0, 1500) ?? null,
        hashtags: input.hashtags ?? [],
        style_id: input.styleId ?? null,
        estimated_cost_usd: input.estimatedCostUsd ?? 0,
        trigger_atom_ids: input.triggerAtomIds ?? [],
        metadata: input.metadata ?? {},
        status: 'proposed',
      }),
    });
    if (!res.ok) {
      console.warn('[marketing-drafts] propose failed:', await res.text());
      return null;
    }
    const rows = await res.json();
    return rows[0] ?? null;
  } catch (err) {
    console.warn('[marketing-drafts] propose exception:', err);
    return null;
  }
}

export async function listDrafts(
  tenantPhone: string,
  status?: DraftStatus | DraftStatus[],
): Promise<MarketingDraft[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  let url = `${SUPABASE_URL}/rest/v1/marketing_drafts?tenant_phone=eq.${cleanPhone}&order=proposed_at.desc&select=*`;
  if (status) {
    const arr = Array.isArray(status) ? status : [status];
    url += `&status=in.(${arr.join(',')})`;
  }
  try {
    const res = await fetch(url, { headers: headers() });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export async function getDraft(id: string): Promise<MarketingDraft | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/marketing_drafts?id=eq.${id}&select=*&limit=1`,
      { headers: headers() },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

async function updateDraft(id: string, patch: Record<string, unknown>): Promise<MarketingDraft | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/marketing_drafts?id=eq.${id}`, {
      method: 'PATCH',
      headers: { ...headers(), Prefer: 'return=representation' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) return null;
    const rows = await res.json();
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function dismissDraft(id: string): Promise<MarketingDraft | null> {
  return updateDraft(id, { status: 'dismissed', dismissed_at: new Date().toISOString() });
}

export async function markFailed(id: string, reason: string): Promise<MarketingDraft | null> {
  return updateDraft(id, {
    status: 'failed',
    failed_at: new Date().toISOString(),
    failure_reason: reason.slice(0, 500),
  });
}

/**
 * Sweep drafts past their expires_at. Run from a cron (marketing-loop already
 * runs once a day so we piggyback). Returns the count expired.
 */
export async function expireStaleDrafts(): Promise<number> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return 0;
  try {
    const now = new Date().toISOString();
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/marketing_drafts?status=eq.proposed&expires_at=lt.${now}`,
      {
        method: 'PATCH',
        headers: { ...headers(), Prefer: 'return=representation' },
        body: JSON.stringify({ status: 'expired' }),
      },
    );
    if (!res.ok) return 0;
    const rows = await res.json();
    return Array.isArray(rows) ? rows.length : 0;
  } catch {
    return 0;
  }
}

// ─── Autonomy preferences ─────────────────────────────────────────────────

export async function loadAutonomyPrefs(tenantPhone: string): Promise<AutonomyPrefs> {
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  const fallback: AutonomyPrefs = {
    tenant_phone: cleanPhone,
    autonomy_level: 'L2',
    max_auto_publish_per_day: 0,
    min_confidence_for_auto: 0.85,
    blocked_words: [],
    auto_publish_channels: [],
    draft_cadence_days: 7,
    last_draft_at: null,
  };
  if (!SUPABASE_URL || !SUPABASE_KEY) return fallback;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/marketing_autonomy_prefs?tenant_phone=eq.${cleanPhone}&select=*&limit=1`,
      { headers: headers() },
    );
    if (!res.ok) return fallback;
    const rows = await res.json();
    return rows[0] ?? fallback;
  } catch {
    return fallback;
  }
}

export async function saveAutonomyPrefs(
  tenantPhone: string,
  patch: Partial<Omit<AutonomyPrefs, 'tenant_phone'>>,
): Promise<AutonomyPrefs | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/marketing_autonomy_prefs?on_conflict=tenant_phone`,
      {
        method: 'POST',
        headers: { ...headers(), Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({
          tenant_phone: cleanPhone,
          ...patch,
          updated_at: new Date().toISOString(),
        }),
      },
    );
    if (!res.ok) {
      console.warn('[marketing-drafts] saveAutonomyPrefs failed:', await res.text());
      return null;
    }
    const rows = await res.json();
    return rows[0] ?? null;
  } catch (err) {
    console.warn('[marketing-drafts] saveAutonomyPrefs exception:', err);
    return null;
  }
}

async function markLastDraftedNow(tenantPhone: string): Promise<void> {
  await saveAutonomyPrefs(tenantPhone, { last_draft_at: new Date().toISOString() } as any);
}

/**
 * Insert a marketing_post_metrics row for a just-published post so the
 * performance cron picks it up. Inlined here to avoid a circular import
 * with marketing-performance.ts (which needs loadAutonomyPrefs).
 */
async function recordPublishedPost(input: {
  tenantPhone: string;
  draftId: string | null;
  channel: string;
  platformPostId: string;
  autoPublished: boolean;
}): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    await fetch(
      `${SUPABASE_URL}/rest/v1/marketing_post_metrics?on_conflict=tenant_phone,platform_post_id`,
      {
        method: 'POST',
        headers: { ...headers(), Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({
          tenant_phone: input.tenantPhone.replace(/[\s\-+()]/g, ''),
          draft_id: input.draftId,
          channel: input.channel,
          platform_post_id: input.platformPostId,
          auto_published: input.autoPublished,
          published_at: new Date().toISOString(),
        }),
      },
    );
  } catch (err) {
    console.warn('[marketing-drafts] recordPublishedPost failed:', err);
  }
}

// ─── L3 detector: propose drafts on cadence ───────────────────────────────

/**
 * For a tenant on L3+ autonomy, decide whether the cadence window has
 * elapsed and, if so, draft N new content concepts. Each gets stored as a
 * proposed draft + a notification queued for the next digest so the owner
 * sees them with their morning brief.
 *
 * Returns count of drafts proposed.
 */
export async function runDraftDetector(tenantPhone: string): Promise<{
  proposed: number;
  skipped_reason?: string;
}> {
  const prefs = await loadAutonomyPrefs(tenantPhone);
  if (prefs.autonomy_level === 'L1' || prefs.autonomy_level === 'L2') {
    return { proposed: 0, skipped_reason: `autonomy ${prefs.autonomy_level} (proactive drafts disabled)` };
  }

  // Cadence gate — don't re-draft within the window
  if (prefs.last_draft_at) {
    const lastMs = new Date(prefs.last_draft_at).getTime();
    const windowMs = prefs.draft_cadence_days * 24 * 60 * 60 * 1000;
    if (Date.now() - lastMs < windowMs) {
      return { proposed: 0, skipped_reason: `next draft in ${Math.ceil((windowMs - (Date.now() - lastMs)) / (24 * 60 * 60 * 1000))}d` };
    }
  }

  // Don't pile on if the owner already has open drafts they haven't acted on
  const openDrafts = await listDrafts(tenantPhone, 'proposed');
  if (openDrafts.length >= 3) {
    return { proposed: 0, skipped_reason: `${openDrafts.length} proposed drafts already open` };
  }

  // Pull tenant context to seed concepts
  const concepts = await generateDraftConcepts(tenantPhone);
  if (concepts.length === 0) {
    return { proposed: 0, skipped_reason: 'no concepts generated' };
  }

  let count = 0;
  for (const c of concepts) {
    const est = estimateGenerationCost(c.quality);
    const draft = await proposeDraft({
      tenantPhone,
      source: 'cadence',
      channel: c.channel,
      topic: c.topic,
      caption: c.caption,
      prompt: c.prompt,
      hashtags: c.hashtags,
      estimatedCostUsd: est.costUsd,
      metadata: { quality: c.quality, model: est.modelRef, confidence: c.confidence },
    });
    if (!draft) continue;
    count++;

    // Dedup keys — topic + draft short id. If the owner already said
    // "dismiss <id>" or "no <topic>" recently, we drop this re-push.
    const topicKey = c.topic.split(/\s+/).filter((w) => w.length >= 4).slice(0, 2).join(' ');
    await enqueueNotification({
      tenantPhone,
      kind: 'agent_observation',
      severity: 'low',
      title: `Marketing draft: ${c.topic.slice(0, 80)}`,
      body: `${c.caption.slice(0, 240)}\n\n💰 ~$${est.costUsd.toFixed(2)} to generate. Reply "approve ${draft.id.slice(0, 8)}" to make it, or "dismiss ${draft.id.slice(0, 8)}".`,
      sourceAgent: 'marketing-loop',
      sourceId: draft.id,
      metadata: { draft_id: draft.id, channel: c.channel },
      topicKeywords: [draft.id.slice(0, 8), topicKey].filter((s) => s && s.length >= 3),
    });
  }

  if (count > 0) await markLastDraftedNow(tenantPhone);
  return { proposed: count };
}

/**
 * Pull the owner's last N captions that they approved or published — these
 * are the canonical "owner voice" examples. Used to anchor concept-gen
 * to their actual tone instead of generic AI phrasing. Falls back to []
 * for new tenants so first-time draft-gen still works.
 */
async function loadRecentApprovedCaptions(tenantPhone: string, limit: number): Promise<string[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/marketing_drafts?tenant_phone=eq.${cleanPhone}&status=in.(approved,published)&order=approved_at.desc.nullslast,proposed_at.desc&limit=${limit}&select=caption`,
      { headers: headers() },
    );
    if (!res.ok) return [];
    const rows = (await res.json()) as { caption: string }[];
    return rows
      .map((r) => (r.caption ?? '').slice(0, 400))
      .filter((c) => c.length > 0);
  } catch {
    return [];
  }
}

interface ConceptSeed {
  topic: string;
  caption: string;
  prompt: string;
  hashtags: string[];
  channel: DraftChannel;
  quality: 'fast' | 'standard' | 'premium';
  confidence: number;
}

/**
 * Ask Sonnet to brainstorm 1-2 reel concepts for this tenant based on
 * recent atoms (what's happening in the business), vertical template, and
 * marketing-lane focus. Returns 0-2 concepts.
 */
async function generateDraftConcepts(tenantPhone: string): Promise<ConceptSeed[]> {
  if (!ANTHROPIC_API_KEY || !SUPABASE_URL || !SUPABASE_KEY) return [];
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');

  // Pull a thin slice of context: tenant vertical, last 10 atoms (events/observations)
  let vertical = 'general business';
  let businessName = 'the business';
  try {
    const ctxRes = await fetch(
      `${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${cleanPhone}&select=onboarding_summary,industry,business_name&limit=1`,
      { headers: headers() },
    );
    if (ctxRes.ok) {
      const rows = await ctxRes.json();
      if (rows[0]) {
        vertical = rows[0].industry ?? rows[0].onboarding_summary?.industry ?? vertical;
        businessName = rows[0].business_name ?? rows[0].onboarding_summary?.business_name ?? businessName;
      }
    }
  } catch {}

  let recentAtoms = '';
  try {
    const atomsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/knowledge_atoms?tenant_phone=eq.${cleanPhone}&order=created_at.desc&limit=15&select=kind,title,summary,created_at`,
      { headers: headers() },
    );
    if (atomsRes.ok) {
      const atoms = await atomsRes.json();
      recentAtoms = atoms.map((a: any) => `- [${a.kind}] ${a.title}${a.summary ? `: ${a.summary.slice(0, 120)}` : ''}`).join('\n');
    }
  } catch {}

  // Voice learning — pull the last 5 captions the owner approved or
  // published so Sonnet matches their tone instead of inventing one.
  const approvedCaptions = await loadRecentApprovedCaptions(cleanPhone, 5);
  const voiceBlock = approvedCaptions.length > 0
    ? `\n\nOWNER'S VOICE (recent approved captions — match this tone exactly):\n${approvedCaptions.map((c, i) => `Example ${i + 1}: "${c}"`).join('\n')}`
    : '';

  const system = `You are the marketing strategist for ${businessName} (${vertical}). Propose 1-2 short-form video concepts (Instagram Reel, 5-8s) that the owner could publish this week. Each concept must be grounded in something concrete about the business — current promotions, recent reviews, services they offer, seasonal context. Avoid generic "engagement bait."${voiceBlock}

Output STRICT JSON:
{
  "concepts": [
    {
      "topic": "Short 5-12 word label for the owner to recognize the idea",
      "caption": "The Instagram caption (1-3 lines, emojis ok, ends with a soft CTA)",
      "prompt": "Visual prompt for the video model: scene, motion, lighting, mood. 2-3 sentences.",
      "hashtags": ["#tag1", "#tag2", "#tag3"],
      "channel": "instagram_reel",
      "quality": "fast",
      "confidence": 0.0-1.0
    }
  ]
}

Rules:
- 1-2 concepts max. Quality > quantity.
- confidence reflects how well-grounded the concept is in the business signal — 0.9 if it ties directly to a recent atom, 0.6 if generic-but-on-brand.
- Default channel "instagram_reel" and quality "fast" (cheapest tier; owner can upgrade per-draft).
- If you can't find a grounded angle, return {"concepts": []}.`;

  const userBlock = `Recent business signals:\n${recentAtoms || '(none yet — be conservative, prefer evergreen angles like services overview, behind-the-scenes)'}`;

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1200,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userBlock }],
      }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const text = data.content?.[0]?.text ?? '';
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    if (jsonStart < 0 || jsonEnd < jsonStart) return [];
    const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
    const out: ConceptSeed[] = (parsed.concepts ?? []).slice(0, 2).map((c: any) => ({
      topic: String(c.topic ?? '').slice(0, 200),
      caption: String(c.caption ?? '').slice(0, 2200),
      prompt: String(c.prompt ?? '').slice(0, 1500),
      hashtags: Array.isArray(c.hashtags) ? c.hashtags.slice(0, 12).map((h: any) => String(h)) : [],
      channel: c.channel === 'instagram_post' ? 'instagram_post' : 'instagram_reel',
      quality: c.quality === 'standard' ? 'standard' : c.quality === 'premium' ? 'premium' : 'fast',
      confidence: typeof c.confidence === 'number' ? Math.max(0, Math.min(1, c.confidence)) : 0.6,
    }));
    return out.filter((c) => c.topic && c.caption && c.prompt);
  } catch (err) {
    console.warn('[marketing-drafts] concept gen failed:', err);
    return [];
  }
}

// ─── Approval path: generate video + publish ──────────────────────────────

export interface ExecuteDraftResult {
  ok: boolean;
  draft?: MarketingDraft;
  videoUrl?: string;
  publishedPostId?: string;
  error?: string;
  costUsd?: number;
}

/**
 * Owner approved a draft → fire generation + publish. Updates draft as it
 * moves through approved → published (or failed). Caller (agent tool or
 * cron) decides whether to also send WhatsApp preview before publishing.
 *
 * For L4 autonomous mode set `autoPublish=true` to skip the WhatsApp
 * preview gate. For L2/L3 the typical caller flow is:
 *   1. approveDraft(id, { generate: true, autoPublish: false })
 *   2. send video preview to WhatsApp
 *   3. owner replies "publish" → call approveDraft again with autoPublish: true
 */
export async function approveDraft(
  id: string,
  opts: { generate?: boolean; autoPublish?: boolean; styleNameOverride?: string } = {},
): Promise<ExecuteDraftResult> {
  const draft = await getDraft(id);
  if (!draft) return { ok: false, error: 'Draft not found' };
  if (draft.status === 'published') return { ok: true, draft, videoUrl: draft.video_url ?? undefined, publishedPostId: draft.published_post_id ?? undefined };
  if (draft.status === 'dismissed' || draft.status === 'expired') {
    return { ok: false, error: `Draft was ${draft.status} — re-propose a new one` };
  }

  // Mark approved if not already
  if (draft.status === 'proposed') {
    await updateDraft(id, { status: 'approved', approved_at: new Date().toISOString() });
  }

  // 1. Generate video if not already done
  let videoUrl = draft.video_url;
  if (!videoUrl && opts.generate !== false) {
    let prompt = draft.prompt ?? '';
    if (opts.styleNameOverride) {
      const style = await findStyleByName(draft.tenant_phone, opts.styleNameOverride);
      if (style) {
        prompt = `${style.style_prompt}. ${prompt}`;
        void recordStyleUsed(style.id);
      }
    }
    const meta = (draft.metadata ?? {}) as any;
    const quality = (meta.quality as 'fast' | 'standard' | 'premium' | undefined) ?? 'fast';
    const gen = await generateVideo({ prompt, quality });
    if (!gen.ok || !gen.videoUrl) {
      await markFailed(id, gen.error ?? 'video generation failed');
      return { ok: false, error: gen.error ?? 'video generation failed', draft };
    }
    videoUrl = gen.videoUrl;
    await updateDraft(id, { video_url: videoUrl });
  }

  // 2. Publish if asked (auto-publish flow), else stop here so owner can preview
  if (!opts.autoPublish) {
    return { ok: true, draft: { ...draft, video_url: videoUrl, status: 'approved' }, videoUrl: videoUrl ?? undefined, costUsd: draft.estimated_cost_usd };
  }

  if (!videoUrl) {
    return { ok: false, error: 'Cannot publish without video_url', draft };
  }

  // 3. Publish via Meta — need tenant's IG connection
  const connections = await loadConnectionsForPhone(draft.tenant_phone);
  const igConn = (connections as any[]).find((c) => c.provider === 'meta' && c.service === 'instagram');
  if (!igConn) {
    await markFailed(id, 'Instagram not connected');
    return { ok: false, error: 'Instagram not connected', draft };
  }
  const igAccountId = igConn.metadata?.instagram_account_id;
  if (!igAccountId) {
    await markFailed(id, 'No Instagram Business Account linked');
    return { ok: false, error: 'No Instagram Business Account linked', draft };
  }

  try {
    const token = await decryptToken(igConn.access_token);
    if (draft.channel === 'instagram_reel') {
      const result = await publishInstagramReel({
        accessToken: token,
        igAccountId,
        videoUrl,
        caption: draft.caption,
        shareToFeed: true,
      });
      if (!result.ok) {
        await markFailed(id, result.error ?? 'reel publish failed');
        return { ok: false, error: result.error, draft };
      }
      await updateDraft(id, {
        status: 'published',
        published_at: new Date().toISOString(),
        published_post_id: result.postId,
      });
      if (result.postId) {
        void recordPublishedPost({
          tenantPhone: draft.tenant_phone,
          draftId: draft.id,
          channel: draft.channel,
          platformPostId: result.postId,
          autoPublished: true,
        });
      }
      return { ok: true, draft, videoUrl, publishedPostId: result.postId };
    }
    if (draft.channel === 'facebook_post') {
      const pageId = igConn.metadata?.page_id;
      if (!pageId) {
        await markFailed(id, 'No Facebook Page linked');
        return { ok: false, error: 'No Facebook Page linked', draft };
      }
      const result = await publishFacebookPagePost({
        pageAccessToken: token,
        pageId,
        message: draft.caption,
      });
      if (!result.ok) {
        await markFailed(id, result.error ?? 'facebook publish failed');
        return { ok: false, error: result.error, draft };
      }
      await updateDraft(id, {
        status: 'published',
        published_at: new Date().toISOString(),
        published_post_id: result.postId,
      });
      if (result.postId) {
        void recordPublishedPost({
          tenantPhone: draft.tenant_phone,
          draftId: draft.id,
          channel: draft.channel,
          platformPostId: result.postId,
          autoPublished: true,
        });
      }
      return { ok: true, draft, videoUrl, publishedPostId: result.postId };
    }
    await markFailed(id, `channel ${draft.channel} not yet supported for autonomous publish`);
    return { ok: false, error: `channel ${draft.channel} not yet supported`, draft };
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    await markFailed(id, msg);
    return { ok: false, error: msg, draft };
  }
}

// ─── L4 autonomous gate ───────────────────────────────────────────────────

/**
 * For an L4 tenant, decide whether a proposed draft is eligible for
 * auto-publish without owner approval. Returns reasons array if blocked
 * (so caller can surface them) and a boolean.
 */
export function evaluateAutoPublishEligibility(
  draft: MarketingDraft,
  prefs: AutonomyPrefs,
  todaysPublishCount: number,
): { eligible: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (prefs.autonomy_level !== 'L4') {
    reasons.push(`autonomy ${prefs.autonomy_level} (L4 required for auto-publish)`);
  }
  if (todaysPublishCount >= prefs.max_auto_publish_per_day) {
    reasons.push(`daily auto-publish cap reached (${prefs.max_auto_publish_per_day})`);
  }
  if (!prefs.auto_publish_channels.includes(draft.channel)) {
    reasons.push(`channel ${draft.channel} not in auto-publish allow-list`);
  }
  const meta = (draft.metadata ?? {}) as any;
  const confidence = typeof meta.confidence === 'number' ? meta.confidence : 0.5;
  if (confidence < prefs.min_confidence_for_auto) {
    reasons.push(`confidence ${confidence.toFixed(2)} < threshold ${prefs.min_confidence_for_auto}`);
  }
  if (prefs.blocked_words.length > 0) {
    const text = `${draft.topic} ${draft.caption}`.toLowerCase();
    const hit = prefs.blocked_words.find((w) => text.includes(w.toLowerCase()));
    if (hit) reasons.push(`blocked word matched: "${hit}"`);
  }
  return { eligible: reasons.length === 0, reasons };
}

/** Count today's auto-published drafts so the per-day cap can be enforced. */
export async function countAutoPublishedToday(tenantPhone: string): Promise<number> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return 0;
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/marketing_drafts?tenant_phone=eq.${cleanPhone}&status=eq.published&published_at=gte.${since}&select=id`,
      { headers: { ...headers(), Prefer: 'count=exact' } },
    );
    if (!res.ok) return 0;
    const range = res.headers.get('content-range'); // e.g. "0-9/42"
    if (range) {
      const total = range.split('/')[1];
      if (total) {
        const n = parseInt(total, 10);
        if (!Number.isNaN(n)) return n;
      }
    }
    const rows = await res.json();
    return Array.isArray(rows) ? rows.length : 0;
  } catch {
    return 0;
  }
}

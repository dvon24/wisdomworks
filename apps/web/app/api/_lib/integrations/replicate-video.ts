/**
 * Replicate video generation adapter.
 *
 * Owner says "make a reel about our balayage special" → marketing agent
 * calls generateVideo() → Replicate runs the model → we poll until done →
 * return a public HTTPS URL the publishInstagramReel flow consumes.
 *
 * Replicate is pay-per-use. We pick model based on `quality` tier:
 *   - 'fast'     → bytedance/seedance-1-lite (~$0.10/clip, 5s, decent)
 *   - 'standard' → minimax/video-01 (~$0.30-0.50/clip, 6s, polished)
 *   - 'premium'  → google/veo-3 (~$0.75-1.50/clip, 8s, best quality)
 *
 * Cost is surfaced to the owner via the third-party cost transparency rule
 * — the agent always mentions estimated cost before generating.
 */

const REPLICATE_API_BASE = 'https://api.replicate.com/v1';

interface ModelConfig {
  /** Replicate model ref, e.g. 'bytedance/seedance-1-lite' or 'org/model:version' */
  modelRef: string;
  /** Default duration in seconds (model-dependent) */
  defaultDurationSec: number;
  /** Rough cost per generation in USD — owner-facing estimate */
  costPerGenUsd: number;
  /** Default aspect ratio for Reels (most models accept aspect_ratio or width/height) */
  inputDefaults: Record<string, any>;
}

interface ModelConfigExt extends ModelConfig {
  /** How long should the poller wait before marking a job 'timed_out'.
   *  Should be ~3-4x typical generation time so transient Replicate
   *  slowness doesn't false-positive into a failure. */
  timeoutMinutes: number;
  /** Optional fallback model to retry with if this one times out. */
  fallbackModelRef?: string;
}

const MODELS: Record<'fast' | 'standard' | 'premium', ModelConfigExt> = {
  fast: {
    modelRef: 'bytedance/seedance-1-lite',
    defaultDurationSec: 5,
    costPerGenUsd: 0.10,
    inputDefaults: { aspect_ratio: '9:16', resolution: '480p' },
    timeoutMinutes: 5, // typical 30-60s; 5min gives ~5x headroom
    fallbackModelRef: 'wan-video/wan-2.1-1.3b', // alt fast text-to-video
  },
  standard: {
    // Bytedance's 720p variant — cleaner quality for the next tier up,
    // brand-consistent with the fast tier so look-and-feel matches when
    // owners upgrade a draft from fast to standard.
    modelRef: 'bytedance/seedance-1-pro',
    defaultDurationSec: 5,
    costPerGenUsd: 0.50,
    inputDefaults: { aspect_ratio: '9:16', resolution: '720p' },
    timeoutMinutes: 8, // typical 60-120s
    fallbackModelRef: 'minimax/video-01', // prior standard, kept as alt
  },
  premium: {
    modelRef: 'google/veo-3',
    defaultDurationSec: 8,
    costPerGenUsd: 1.25,
    inputDefaults: { aspect_ratio: '9:16' },
    timeoutMinutes: 15, // typical 90-180s
  },
};

/** Public helper — caller (job insert path) reads this to compute a
 *  per-quality timeout_at instead of relying on the migration's 20-min
 *  default which is too generous for the fast tier. */
export function getQualityTimeoutMinutes(quality: 'fast' | 'standard' | 'premium' = 'fast'): number {
  return MODELS[quality].timeoutMinutes;
}

/** The fallback model for a given tier, if any. The poller uses this to
 *  auto-retry a timed-out job with a different model rather than fail
 *  outright. Only `fast` has a fallback today (seedance → wan). */
export function getFallbackModelRef(quality: 'fast' | 'standard' | 'premium' = 'fast'): string | null {
  return MODELS[quality].fallbackModelRef ?? null;
}

export interface VideoGenResult {
  ok: boolean;
  videoUrl?: string;
  predictionId?: string;
  costEstimateUsd?: number;
  modelRef?: string;
  error?: string;
}

/**
 * Generate a video. Polls Replicate until the prediction is done.
 * Default poll budget is 4 minutes (Replicate jobs typically 30-120s).
 */
export async function generateVideo(input: {
  prompt: string;
  quality?: 'fast' | 'standard' | 'premium';
  durationSec?: number;
  aspectRatio?: '9:16' | '16:9' | '1:1';
  maxWaitMs?: number;
}): Promise<VideoGenResult> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    return { ok: false, error: 'REPLICATE_API_TOKEN not configured' };
  }
  const quality = input.quality ?? 'fast';
  const model = MODELS[quality];

  // Build inputs — most Replicate video models accept a `prompt` field;
  // duration + aspect ratio overrides per-model where supported.
  const modelInput: Record<string, any> = {
    ...model.inputDefaults,
    prompt: input.prompt.slice(0, 1500),
  };
  if (input.durationSec) modelInput.duration = input.durationSec;
  if (input.aspectRatio) modelInput.aspect_ratio = input.aspectRatio;

  try {
    // Replicate uses "model versions" for some refs and the alias-style
    // {owner}/{model} for hosted-models. We try the model-shortcut endpoint
    // first (works for official models), fall back to version-based.
    const createRes = await fetch(`${REPLICATE_API_BASE}/models/${model.modelRef}/predictions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Prefer: 'wait=60', // server-side wait up to 60s before returning
      },
      body: JSON.stringify({ input: modelInput }),
    });
    if (!createRes.ok) {
      const errBody = await createRes.text();
      return { ok: false, error: `Replicate create failed: ${createRes.status} ${errBody}` };
    }

    let prediction = await createRes.json();

    // If `Prefer: wait` returned the finished prediction, output is ready.
    // Otherwise poll until status reaches a terminal state.
    const maxWaitMs = input.maxWaitMs ?? 4 * 60_000;
    const start = Date.now();
    while (
      prediction.status &&
      prediction.status !== 'succeeded' &&
      prediction.status !== 'failed' &&
      prediction.status !== 'canceled' &&
      Date.now() - start < maxWaitMs
    ) {
      await new Promise((r) => setTimeout(r, 5000));
      const pollRes = await fetch(`${REPLICATE_API_BASE}/predictions/${prediction.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!pollRes.ok) {
        return { ok: false, error: `Replicate poll failed: ${pollRes.status}`, predictionId: prediction.id };
      }
      prediction = await pollRes.json();
    }

    if (prediction.status !== 'succeeded') {
      return {
        ok: false,
        predictionId: prediction.id,
        error: prediction.error ?? `Replicate prediction ${prediction.status} (no output)`,
      };
    }

    // Output shape varies by model — usually a string URL or array of URLs
    const output = prediction.output;
    const videoUrl: string | undefined = Array.isArray(output) ? output[0] : typeof output === 'string' ? output : undefined;
    if (!videoUrl) {
      return { ok: false, error: 'No video URL in Replicate output', predictionId: prediction.id };
    }

    return {
      ok: true,
      videoUrl,
      predictionId: prediction.id,
      costEstimateUsd: model.costPerGenUsd,
      modelRef: model.modelRef,
    };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

/** For surfacing to the owner before they trigger a generation. */
export function estimateGenerationCost(quality: 'fast' | 'standard' | 'premium' = 'fast'): {
  modelRef: string;
  costUsd: number;
  durationSec: number;
} {
  const m = MODELS[quality];
  return { modelRef: m.modelRef, costUsd: m.costPerGenUsd, durationSec: m.defaultDurationSec };
}

// ─── Async / job-queue path ───────────────────────────────────────────────
// The WhatsApp webhook is hard-capped at 60s but most video generations
// take 30-180s. We can't synchronously wait for the result without timing
// out. Instead: start the prediction, persist the job, return immediately.
// A poller cron (every 2 min) checks Replicate for completion and sends
// the preview.

export interface StartGenerationResult {
  ok: boolean;
  predictionId?: string;
  modelRef?: string;
  costEstimateUsd?: number;
  error?: string;
}

/**
 * Kick off a Replicate prediction WITHOUT waiting. Returns the
 * prediction id which the poller uses to check status.
 *
 * Pass `modelRefOverride` to use a specific model regardless of tier —
 * the poller uses this to retry a timed-out job with the tier's
 * fallback model (e.g. seedance hung → retry with wan-2.1).
 */
export async function startVideoGeneration(input: {
  prompt: string;
  quality?: 'fast' | 'standard' | 'premium';
  durationSec?: number;
  aspectRatio?: '9:16' | '16:9' | '1:1';
  modelRefOverride?: string;
}): Promise<StartGenerationResult> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) return { ok: false, error: 'REPLICATE_API_TOKEN not configured' };
  const quality = input.quality ?? 'fast';
  const model = MODELS[quality];
  const modelRef = input.modelRefOverride ?? model.modelRef;

  const modelInput: Record<string, any> = {
    ...model.inputDefaults,
    prompt: input.prompt.slice(0, 1500),
  };
  if (input.durationSec) modelInput.duration = input.durationSec;
  if (input.aspectRatio) modelInput.aspect_ratio = input.aspectRatio;

  try {
    // NO `Prefer: wait` header — fire and return immediately
    const res = await fetch(`${REPLICATE_API_BASE}/models/${modelRef}/predictions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: modelInput }),
    });
    if (!res.ok) {
      return { ok: false, error: `Replicate create failed: ${res.status} ${await res.text()}` };
    }
    const prediction = await res.json();
    if (!prediction.id) return { ok: false, error: 'Replicate returned no prediction id' };
    return {
      ok: true,
      predictionId: prediction.id,
      modelRef,
      costEstimateUsd: model.costPerGenUsd,
    };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

export interface PredictionStatus {
  ok: boolean;
  status?: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  videoUrl?: string;
  error?: string;
}

/** One-shot status check. Poller calls this. */
export async function getPredictionStatus(predictionId: string): Promise<PredictionStatus> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) return { ok: false, error: 'REPLICATE_API_TOKEN not configured' };
  try {
    const res = await fetch(`${REPLICATE_API_BASE}/predictions/${predictionId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { ok: false, error: `${res.status}: ${await res.text()}` };
    const prediction = await res.json();
    const status = prediction.status as PredictionStatus['status'];
    const output = prediction.output;
    const videoUrl: string | undefined = Array.isArray(output)
      ? output[0]
      : typeof output === 'string' ? output : undefined;
    return {
      ok: true,
      status,
      videoUrl,
      error: prediction.error ?? undefined,
    };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

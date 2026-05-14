/**
 * Photo analysis — sends a client photo to Claude with vision capability
 * and extracts a structured brief: description, tags, problem/diagnosis/
 * solution/tools (vertical-aware).
 *
 * The model is asked to return JSON; we tolerate prose-wrapped JSON and
 * extract the first JSON block.
 */

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const VISION_MODEL = 'claude-sonnet-4-6';

export interface PhotoBrief {
  description: string;
  tags: string[];
  /** Vertical-aware extraction: problem → diagnosis → solution → tools, OR
   *  service rendered for non-trades verticals. */
  entities: Record<string, string | string[]>;
}

function buildPrompt(verticalLabel?: string | null, caption?: string | null): string {
  const verticalGuide = verticalLabel === 'Electrician'
    ? "This is a service-trade business (electrician). Look for: problem (what went wrong), diagnosis (root cause), solution (what was done or recommended), tools/parts (specific gear), code-compliance flags."
    : verticalLabel === 'Salon'
    ? "This is a salon business. Look for: service rendered (cut/color/style), before/after state, products visible, technique notes."
    : verticalLabel === 'Restaurant'
    ? "This is a restaurant business. Look for: dish or scene captured, presentation notes, plate composition, any issues visible."
    : "Describe what you see and what business activity it captures.";

  const captionLine = caption
    ? `The owner attached this caption: "${caption.slice(0, 300)}". Use it for context but don't repeat it verbatim.`
    : 'No caption was provided.';

  return `Analyze this photo from a business owner's WhatsApp. ${verticalGuide}

${captionLine}

Return JSON ONLY (no markdown fences, no prose before/after) matching this shape:
{
  "description": "1-2 sentence factual description of what's in the photo",
  "tags": ["short", "lowercase_snake_case", "tags"],
  "entities": {
    "problem": "what was wrong, if anything",
    "diagnosis": "root cause if assessable from the photo",
    "solution": "what was done or what should be done",
    "tools": ["any specific tools / parts / products visible"],
    "service": "service rendered (use this for non-trade verticals instead of problem/diagnosis)"
  }
}

Only include entity fields you can actually infer. Drop fields you can't see evidence for.`;
}

function extractJson(raw: string): any | null {
  // First try direct parse
  try { return JSON.parse(raw); } catch {}
  // Strip code fences
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try { return JSON.parse(fenced[1]!); } catch {}
  }
  // Find the first balanced {...}
  const start = raw.indexOf('{');
  if (start >= 0) {
    let depth = 0;
    for (let i = start; i < raw.length; i++) {
      if (raw[i] === '{') depth++;
      else if (raw[i] === '}') {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(raw.slice(start, i + 1)); } catch {}
          break;
        }
      }
    }
  }
  return null;
}

export async function analyzePhoto(input: {
  imageBytes: Uint8Array;
  mimeType: string;
  verticalLabel?: string | null;
  caption?: string | null;
}): Promise<PhotoBrief | null> {
  if (!ANTHROPIC_API_KEY) {
    console.warn('[photo-analysis] ANTHROPIC_API_KEY not set');
    return null;
  }
  // Anthropic accepts only jpeg/png/gif/webp
  const cleanMime = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(input.mimeType)
    ? input.mimeType
    : 'image/jpeg';
  // Base64 encode
  let b64 = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < input.imageBytes.length; i += chunkSize) {
    b64 += String.fromCharCode(...input.imageBytes.subarray(i, i + chunkSize));
  }
  b64 = btoa(b64);

  const body = {
    model: VISION_MODEL,
    max_tokens: 800,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: cleanMime, data: b64 } },
          { type: 'text', text: buildPrompt(input.verticalLabel, input.caption) },
        ],
      },
    ],
  };

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn('[photo-analysis] anthropic error:', res.status, await res.text());
      return null;
    }
    const data = await res.json();
    const text = data.content?.find((b: any) => b.type === 'text')?.text ?? '';
    const parsed = extractJson(text);
    if (!parsed || typeof parsed !== 'object') {
      console.warn('[photo-analysis] could not parse vision response');
      return null;
    }
    return {
      description: String(parsed.description ?? '').slice(0, 500),
      tags: Array.isArray(parsed.tags) ? parsed.tags.map((t: any) => String(t)).slice(0, 20) : [],
      entities: typeof parsed.entities === 'object' && parsed.entities !== null ? parsed.entities : {},
    };
  } catch (err) {
    console.warn('[photo-analysis] exception:', err);
    return null;
  }
}

/** Persist the analyzed photo row. Returns photo_id on success. */
export async function saveClientPhoto(input: {
  tenantPhone: string;
  clientProfileId?: string;
  storagePath: string;
  displayUrl: string | null;
  brief: PhotoBrief;
  sourceMessageId?: string;
  sourceChannel?: string;
  caption?: string;
}): Promise<string | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const cleanPhone = input.tenantPhone.replace(/[\s\-+()]/g, '');
    const res = await fetch(`${SUPABASE_URL}/rest/v1/client_photos`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        tenant_phone: cleanPhone,
        client_profile_id: input.clientProfileId ?? null,
        storage_path: input.storagePath,
        display_url: input.displayUrl,
        analysis_text: input.brief.description,
        analysis_tags: input.brief.tags,
        extracted_entities: input.brief.entities,
        source_channel: input.sourceChannel ?? 'whatsapp',
        source_message_id: input.sourceMessageId ?? null,
        caption: input.caption ?? null,
        analyzed_at: new Date().toISOString(),
      }),
    });
    if (!res.ok) {
      console.warn('[photo-analysis] save failed:', await res.text());
      return null;
    }
    const rows = await res.json();
    return rows[0]?.id ?? null;
  } catch (err) {
    console.warn('[photo-analysis] save exception:', err);
    return null;
  }
}

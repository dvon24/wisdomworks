/**
 * Marketing styles — named templates the owner reuses across reel
 * generations. Each style has a `style_prompt` that gets prepended to
 * the user's per-reel prompt so brand voice stays consistent.
 *
 * Phase 1: owner-defined (they type the style description).
 * Phase 2: auto-analyzed (frame-extract a reference video → Claude vision
 * → distilled style description).
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

export interface MarketingStyle {
  id: string;
  tenant_phone: string;
  name: string;
  style_prompt: string;
  reference_video_url: string | null;
  reference_image_url: string | null;
  source: 'owner_defined' | 'auto_analyzed' | 'imported';
  default_quality: 'fast' | 'standard' | 'premium';
  use_count: number;
  last_used_at: string | null;
}

export async function saveMarketingStyle(input: {
  tenantPhone: string;
  name: string;
  stylePrompt: string;
  referenceVideoUrl?: string;
  referenceImageUrl?: string;
  defaultQuality?: 'fast' | 'standard' | 'premium';
}): Promise<MarketingStyle | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const cleanPhone = input.tenantPhone.replace(/[\s\-+()]/g, '');
  try {
    // Upsert by (tenant, lower(name))
    const res = await fetch(`${SUPABASE_URL}/rest/v1/marketing_styles?on_conflict=tenant_phone,name`, {
      method: 'POST',
      headers: { ...headers(), Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({
        tenant_phone: cleanPhone,
        name: input.name.slice(0, 100),
        style_prompt: input.stylePrompt.slice(0, 1500),
        reference_video_url: input.referenceVideoUrl ?? null,
        reference_image_url: input.referenceImageUrl ?? null,
        default_quality: input.defaultQuality ?? 'fast',
        source: 'owner_defined',
        updated_at: new Date().toISOString(),
      }),
    });
    if (!res.ok) {
      console.warn('[marketing-styles] save failed:', await res.text());
      return null;
    }
    const rows = await res.json();
    return rows[0] ?? null;
  } catch (err) {
    console.warn('[marketing-styles] save exception:', err);
    return null;
  }
}

export async function listMarketingStyles(tenantPhone: string): Promise<MarketingStyle[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/marketing_styles?tenant_phone=eq.${cleanPhone}&order=last_used_at.desc.nullslast&select=*`,
      { headers: headers() },
    );
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export async function findStyleByName(tenantPhone: string, name: string): Promise<MarketingStyle | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/marketing_styles?tenant_phone=eq.${cleanPhone}&name=ilike.${encodeURIComponent(name)}&select=*&limit=1`,
      { headers: headers() },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function deleteMarketingStyle(tenantPhone: string, name: string): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false;
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/marketing_styles?tenant_phone=eq.${cleanPhone}&name=ilike.${encodeURIComponent(name)}`,
      {
        method: 'DELETE',
        headers: { ...headers(), Prefer: 'return=minimal' },
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

/** Bump use_count + last_used_at on a style after a generation references it. */
export async function recordStyleUsed(styleId: string): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    const cur = await fetch(
      `${SUPABASE_URL}/rest/v1/marketing_styles?id=eq.${styleId}&select=use_count`,
      { headers: headers() },
    );
    if (!cur.ok) return;
    const rows = await cur.json();
    const used = rows[0]?.use_count ?? 0;
    await fetch(`${SUPABASE_URL}/rest/v1/marketing_styles?id=eq.${styleId}`, {
      method: 'PATCH',
      headers: { ...headers(), Prefer: 'return=minimal' },
      body: JSON.stringify({
        use_count: used + 1,
        last_used_at: new Date().toISOString(),
      }),
    });
  } catch {}
}

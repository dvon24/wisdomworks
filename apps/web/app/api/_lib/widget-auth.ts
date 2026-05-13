/**
 * Widget API key authentication.
 *
 * Tenants generate keys via Iris ("create a widget api key for my Wix
 * site"). Plain key shown ONCE; stored as SHA-256 hash. Widgets and
 * REST API clients pass the key via:
 *   - Header: `X-API-Key: wk_abc123...`
 *   - OR query string: `?api_key=wk_abc123...` (only for the JS embed)
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

export interface WidgetApiKey {
  id: string;
  tenant_phone: string;
  key_hash: string;
  key_prefix: string;
  label: string | null;
  scopes: string[];
  allowed_origins: string[];
  status: 'active' | 'revoked';
  use_count: number;
  last_used_at: string | null;
  created_at: string;
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function generatePlainKey(): string {
  // 32 url-safe random chars prefixed with wk_
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let key = '';
  for (const b of bytes) key += chars[b % chars.length];
  return `wk_${key}`;
}

/** Generate a new API key for a tenant. Returns the plain key (shown ONCE)
 *  + the row id. The plain key is never retrievable after this call. */
export async function createApiKey(input: {
  tenantPhone: string;
  label?: string;
  scopes?: string[];
  allowedOrigins?: string[];
}): Promise<{ plainKey: string; id: string } | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const plainKey = generatePlainKey();
  const keyHash = await sha256Hex(plainKey);
  const keyPrefix = plainKey.slice(0, 11); // "wk_" + 8 chars
  const cleanPhone = input.tenantPhone.replace(/[\s\-+()]/g, '');
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/widget_api_keys`, {
      method: 'POST',
      headers: { ...headers(), Prefer: 'return=representation' },
      body: JSON.stringify({
        tenant_phone: cleanPhone,
        key_hash: keyHash,
        key_prefix: keyPrefix,
        label: input.label ?? null,
        scopes: input.scopes ?? ['chat'],
        allowed_origins: input.allowedOrigins ?? [],
        status: 'active',
      }),
    });
    if (!res.ok) {
      console.warn('[widget-auth] create failed:', await res.text());
      return null;
    }
    const rows = await res.json();
    return { plainKey, id: rows[0]?.id };
  } catch (err) {
    console.warn('[widget-auth] create exception:', err);
    return null;
  }
}

/** Verify a plain API key from a widget/REST request. Returns the key row
 *  if active; null otherwise. */
export async function verifyApiKey(plainKey: string, requestOrigin?: string): Promise<WidgetApiKey | null> {
  if (!plainKey || !plainKey.startsWith('wk_')) return null;
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const keyHash = await sha256Hex(plainKey);
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/widget_api_keys?key_hash=eq.${keyHash}&status=eq.active&select=*&limit=1`,
      { headers: headers() },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    if (rows.length === 0) return null;
    const key = rows[0] as WidgetApiKey;

    // Origin whitelist check
    if (key.allowed_origins.length > 0 && requestOrigin) {
      const ok = key.allowed_origins.some((origin) => {
        if (origin === '*') return true;
        return requestOrigin === origin || requestOrigin.endsWith('.' + origin.replace(/^https?:\/\//, ''));
      });
      if (!ok) {
        console.warn(`[widget-auth] origin ${requestOrigin} not in allowlist for key ${key.key_prefix}`);
        return null;
      }
    }

    // Bump use counter (fire-and-forget)
    void fetch(`${SUPABASE_URL}/rest/v1/widget_api_keys?id=eq.${key.id}`, {
      method: 'PATCH',
      headers: { ...headers(), Prefer: 'return=minimal' },
      body: JSON.stringify({
        last_used_at: new Date().toISOString(),
        use_count: key.use_count + 1,
      }),
    });

    return key;
  } catch (err) {
    console.warn('[widget-auth] verify exception:', err);
    return null;
  }
}

export async function listApiKeysForTenant(tenantPhone: string): Promise<WidgetApiKey[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/widget_api_keys?tenant_phone=eq.${cleanPhone}&order=created_at.desc&select=*`,
      { headers: headers() },
    );
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export async function revokeApiKey(idOrPrefix: string, tenantPhone: string): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false;
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  try {
    // Accept full UUID or 8-char prefix (everything after wk_)
    const prefix = idOrPrefix.startsWith('wk_') ? idOrPrefix.slice(0, 11) : null;
    const filter = prefix
      ? `key_prefix=eq.${prefix}`
      : `id=eq.${idOrPrefix}`;
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/widget_api_keys?tenant_phone=eq.${cleanPhone}&${filter}`,
      {
        method: 'PATCH',
        headers: { ...headers(), Prefer: 'return=minimal' },
        body: JSON.stringify({
          status: 'revoked',
          revoked_at: new Date().toISOString(),
        }),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

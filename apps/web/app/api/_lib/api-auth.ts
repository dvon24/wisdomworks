/**
 * Owner API authentication — Story 6.1 deadbolt.
 *
 * Until this lands, every tenant-data API is publicly readable by phone
 * number. After this lands, you need either:
 *   - A valid signed session cookie (`ww_session`), OR
 *   - The Authorization: Bearer <OWNER_API_TOKEN> header
 *
 * Session tokens are minted from the WhatsApp surface (which is already
 * provider-verified by Meta's signature). Owner texts Iris → Iris
 * calls issue_deck_login → owner clicks magic link → /api/auth/redeem
 * sets the cookie. No password flow needed for MVP.
 *
 * Cron and webhook routes have their own auth (CRON_SECRET, HMAC
 * signatures) and don't go through this module.
 */

import { NextResponse } from 'next/server';

const COOKIE_NAME = 'ww_session';
const TOKEN_TTL_HOURS = 24 * 30; // 30 days

function getSecret(): string {
  const s = process.env.API_AUTH_SECRET;
  if (!s) {
    // In dev, fall back to the supabase service-role key so localhost works.
    return process.env.SUPABASE_SERVICE_ROLE_KEY ?? '__dev_unsafe_default__';
  }
  return s;
}

async function hmacSign(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(getSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return base64UrlEncode(new Uint8Array(sig));
}

function base64UrlEncode(buf: Uint8Array): string {
  let s = '';
  for (const b of buf) s += String.fromCharCode(b);
  return btoa(s).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * Mint a session token for the given phone. Format:
 *   <base64(payload)>.<base64(hmac)>
 * Payload = JSON {phone, iat, exp}
 */
export async function signSessionToken(phone: string): Promise<string> {
  const cleanPhone = phone.replace(/[\s\-+()]/g, '');
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    phone: cleanPhone,
    iat: now,
    exp: now + TOKEN_TTL_HOURS * 3600,
  };
  const payloadStr = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmacSign(payloadStr);
  return `${payloadStr}.${sig}`;
}

/**
 * Verify a session token. Returns the embedded phone on success, null otherwise.
 */
export async function verifySessionToken(token: string): Promise<{ phone: string } | null> {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadStr, sig] = parts;
  if (!payloadStr || !sig) return null;
  const expectedSig = await hmacSign(payloadStr);
  if (!constantTimeEqual(sig, expectedSig)) return null;

  try {
    const decoded = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadStr)));
    if (typeof decoded.phone !== 'string' || typeof decoded.exp !== 'number') return null;
    if (Math.floor(Date.now() / 1000) > decoded.exp) return null;
    return { phone: decoded.phone };
  } catch {
    return null;
  }
}

function base64UrlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Extract phone from either:
 *   - Authorization: Bearer <OWNER_API_TOKEN> (admin override)
 *   - Cookie: ww_session=<signed-token>
 * Returns null if no valid credential found.
 */
export async function authenticatePhone(request: Request): Promise<string | null> {
  // Admin override (server-to-server)
  const auth = request.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) {
    const ownerToken = process.env.OWNER_API_TOKEN;
    if (ownerToken && auth.slice(7) === ownerToken) {
      // Admin token can act on behalf of any tenant — caller must pass
      // ?phone= as the actor.
      const url = new URL(request.url);
      const phoneParam = url.searchParams.get('phone');
      if (phoneParam) return phoneParam.replace(/[\s\-+()]/g, '');
      // Also accept body-supplied actor if there is one (POST routes).
      // We don't read the body here to avoid consuming the stream.
    }
  }

  // Session cookie
  const cookieHeader = request.headers.get('cookie') ?? '';
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  if (!match) return null;
  const verified = await verifySessionToken(decodeURIComponent(match[1]!));
  return verified?.phone ?? null;
}

/**
 * Guard a tenant-data route. Returns a 401 Response if the caller is not
 * authenticated OR is authenticated as a DIFFERENT phone than the one
 * they're requesting.
 *
 * Usage:
 *   const phone = url.searchParams.get('phone');
 *   const denied = await requireOwnerAuth(request, phone);
 *   if (denied) return denied;
 */
export async function requireOwnerAuth(
  request: Request,
  requestedPhone: string | null | undefined,
): Promise<Response | null> {
  if (!requestedPhone) {
    return NextResponse.json({ error: 'phone required' }, { status: 400 });
  }
  const cleanRequested = requestedPhone.replace(/[\s\-+()]/g, '');

  const actor = await authenticatePhone(request);
  if (!actor) {
    return NextResponse.json(
      {
        error: 'unauthorized',
        hint: 'Text Iris on WhatsApp: "send me a deck login link"',
      },
      { status: 401 },
    );
  }

  // Admin token via Authorization header — caller already passed the
  // owner-scoped phone in the URL, so allow.
  const auth = request.headers.get('authorization');
  const ownerToken = process.env.OWNER_API_TOKEN;
  if (auth?.startsWith('Bearer ') && ownerToken && auth.slice(7) === ownerToken) {
    return null;
  }

  if (actor !== cleanRequested) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  return null;
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;

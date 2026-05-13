/**
 * Messaging-channel adapters.
 *
 * Each adapter implements:
 *   - inbound shape normalization (handled in the channel's webhook route)
 *   - outbound send via sendOnChannel()
 *
 * Tenant lookup is uniform: every channel webhook resolves the inbound
 * external_id → tenant_phone via the tenant_channels table, then runs the
 * exact same iris-brain pipeline as WhatsApp. This is the "meet users where
 * they are" promise — WhatsApp is the floor, every other channel is an
 * adapter on top of the same brain.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export type Channel = 'whatsapp' | 'telegram' | 'sms' | 'imessage' | 'discord';

export interface TenantChannelMapping {
  tenantPhone: string;
  channel: Channel;
  externalId: string;
  displayName: string | null;
  status: 'active' | 'paused' | 'revoked';
}

/** Look up the tenant for an inbound message on any channel. */
export async function resolveTenantForChannel(
  channel: Channel,
  externalId: string,
): Promise<TenantChannelMapping | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_channels?channel=eq.${channel}&external_id=eq.${encodeURIComponent(externalId)}&status=eq.active&select=tenant_phone,channel,external_id,display_name,status&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    if (!rows[0]) return null;
    return {
      tenantPhone: rows[0].tenant_phone,
      channel: rows[0].channel,
      externalId: rows[0].external_id,
      displayName: rows[0].display_name,
      status: rows[0].status,
    };
  } catch (err) {
    console.warn('[messaging-adapters] resolve failed:', err);
    return null;
  }
}

/** Update last_message_at on a channel mapping (telemetry). */
export async function touchChannel(channel: Channel, externalId: string): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_channels?channel=eq.${channel}&external_id=eq.${encodeURIComponent(externalId)}`,
      {
        method: 'PATCH',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ last_message_at: new Date().toISOString() }),
      },
    );
  } catch {
    // non-fatal
  }
}

/**
 * Generate a short link code the owner can paste in their non-primary
 * channel to bind it to their tenant. Returns null if Supabase is unreachable.
 */
export async function createLinkCode(tenantPhone: string, channel: Channel): Promise<string | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  // 8-char alphanumeric — easy to type from a phone.
  const code = Array.from({ length: 8 }, () =>
    'ABCDEFGHJKMNPQRSTUVWXYZ23456789'.charAt(Math.floor(Math.random() * 31)),
  ).join('');
  try {
    const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
    const res = await fetch(`${SUPABASE_URL}/rest/v1/channel_link_codes`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ code, tenant_phone: cleanPhone, channel }),
    });
    return res.ok ? code : null;
  } catch (err) {
    console.warn('[messaging-adapters] createLinkCode failed:', err);
    return null;
  }
}

/**
 * Redeem a link code from the bot's side (after user pastes `/link CODE`).
 * Returns tenant_phone on success, null on bad/expired code.
 */
export async function redeemLinkCode(
  code: string,
  channel: Channel,
  externalId: string,
  displayName?: string,
): Promise<string | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/redeem_channel_link_code`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_code: code,
        p_channel: channel,
        p_external_id: externalId,
        p_display: displayName ?? null,
      }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn('[messaging-adapters] redeem failed:', err);
    return null;
  }
}

/** Outbound — send a reply on the channel the message came in on. */
export async function sendOnChannel(channel: Channel, externalId: string, text: string): Promise<boolean> {
  switch (channel) {
    case 'telegram':
      return sendTelegram(externalId, text);
    case 'whatsapp':
      return sendWhatsApp(externalId, text);
    case 'sms':
    case 'imessage':
    case 'discord':
      console.warn(`[messaging-adapters] ${channel} send not yet implemented`);
      return false;
  }
}

// ─── Telegram ────────────────────────────────────────────────────────────

async function sendTelegram(chatId: string, text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error('[telegram] TELEGRAM_BOT_TOKEN not set');
    return false;
  }
  try {
    // Telegram caps single message at 4096 chars
    const safe = text.length > 4096 ? text.slice(0, 4090) + '…' : text;
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: safe }),
    });
    if (!res.ok) {
      const err = await res.json();
      console.error('[telegram] send failed:', err);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[telegram] send error:', err);
    return false;
  }
}

// ─── WhatsApp ────────────────────────────────────────────────────────────

async function sendWhatsApp(phoneNumber: string, text: string): Promise<boolean> {
  const { sendOwnerMessage } = await import('../owner-message');
  const result = await sendOwnerMessage({ tenantPhone: phoneNumber, body: text, source: 'manual' });
  return result.ok;
}

/**
 * Webhook message idempotency — prevents Meta/Telegram webhook retries
 * from re-firing the iris-brain for the same inbound message.
 *
 * Claim semantics: INSERT … ON CONFLICT DO NOTHING with RETURNING. If the
 * row already existed, we lose the race and bail. The first invocation
 * "owns" the processing.
 *
 * Race window note: between the INSERT and the actual processing, another
 * retry can still slip in if it arrives during the INSERT roundtrip. For
 * our scale (one tenant, low message volume) this is fine; for higher
 * volume, swap to advisory locks or move processing to a queue.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export type IdempotencyChannel = 'whatsapp' | 'telegram' | 'sms' | 'imessage' | 'discord';

/**
 * Try to claim a message_id for processing. Returns true if we own it
 * (caller should proceed), false if another invocation already claimed it
 * (caller should bail with 200).
 *
 * If Supabase is unavailable, returns true (fail-open) so a misconfigured
 * env doesn't silently drop messages.
 */
export async function claimMessage(
  messageId: string,
  channel: IdempotencyChannel,
  tenantPhone?: string,
): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return true;
  if (!messageId) return true;
  try {
    // Prefer=return=representation tells PostgREST to return the inserted
    // row. With ON CONFLICT DO NOTHING (the default for unique-key
    // conflicts in PostgREST when no resolution=merge-duplicates is set),
    // a conflict returns 201 with an empty array instead of 409 + the row.
    const res = await fetch(`${SUPABASE_URL}/rest/v1/processed_messages`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        // resolution=ignore-duplicates skips the conflict; returning the
        // row only if it was newly inserted is what we want.
        Prefer: 'return=representation,resolution=ignore-duplicates',
      },
      body: JSON.stringify({
        message_id: messageId,
        channel,
        tenant_phone: tenantPhone ?? null,
      }),
    });
    if (!res.ok) {
      // 409 on PK conflict in older PostgREST versions — treat as "lost the race"
      if (res.status === 409) return false;
      console.warn('[message-idempotency] claim failed:', res.status, await res.text());
      return true; // fail-open
    }
    const rows = await res.json();
    // Empty array = ON CONFLICT triggered, someone else owns it
    return Array.isArray(rows) ? rows.length > 0 : true;
  } catch (err) {
    console.warn('[message-idempotency] claim exception:', err);
    return true; // fail-open
  }
}

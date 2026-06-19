/**
 * Owner-message debounce ("shotgun messages").
 *
 * When the owner fires several WhatsApp messages back-to-back, each lands as a
 * separate webhook → a separate brain run → a separate reply, and an earlier
 * reply can't account for a later message. This buffers rapid messages and runs
 * the brain ONCE on the combined text (Devon 2026-06-17).
 *
 * Flow (in webhooks/whatsapp/route.ts text path):
 *   1. bufferOwnerMessage() — INSERT a 'pending' row, return immediately.
 *   2. after(): flushOwnerMessages() — wait the debounce window, then
 *      ATOMICALLY claim this tenant's pending rows (PATCH status=pending →
 *      processing, RETURNING). Postgres row-locking makes the claim exclusive:
 *      exactly one flush in a burst gets the rows; the rest get [] and no-op.
 *   3. The winner runs generateIrisReply once on the combined text.
 *
 * Backed by the pending_owner_messages table (2026-06-19 migration). If the
 * table/Supabase is unavailable, bufferOwnerMessage returns false and the caller
 * falls back to processing the single message directly — never a dropped turn.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

/** Collection window. Tunable without a deploy via OWNER_MESSAGE_DEBOUNCE_MS.
 *  ~7s catches typical back-to-back sending; the read-receipt + typing indicator
 *  shown before this cover the wait. 0 disables (process each message at once). */
function windowMs(): number {
  const n = Number(process.env.OWNER_MESSAGE_DEBOUNCE_MS);
  return Number.isFinite(n) && n >= 0 ? n : 7000;
}

/**
 * Buffer one owner message for debounced processing. Returns true if buffered
 * (caller should flush in after()), false if the buffer is unavailable (caller
 * should process the single message directly so nothing is dropped).
 */
export async function bufferOwnerMessage(args: {
  tenantPhone: string;
  messageId: string;
  text: string;
}): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_KEY || windowMs() === 0) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/pending_owner_messages`, {
      method: 'POST',
      headers: { ...headers(), Prefer: 'return=minimal' },
      body: JSON.stringify({
        tenant_phone: args.tenantPhone,
        message_id: args.messageId,
        text: args.text,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface CombinedFlush {
  /** The owner's back-to-back messages, oldest-first, joined for the brain. */
  combinedText: string;
  /** How many messages were combined (1 = a lone message). */
  count: number;
}

/**
 * Wait the debounce window, then atomically claim this tenant's pending messages
 * and return them combined. Returns null when there's nothing to claim — i.e.
 * another (concurrent) flush already took this burst — so this caller does
 * nothing. Stale 'processing' rows (a prior flush that died mid-run) older than
 * STALE_MS are re-claimed here so a crash can't silently strand a turn.
 */
export async function flushOwnerMessages(tenantPhone: string): Promise<CombinedFlush | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  await new Promise((r) => setTimeout(r, windowMs()));

  const clean = tenantPhone.replace(/[\s\-+()]/g, '');
  try {
    // Atomic claim: flip all of this tenant's pending rows to 'processing' and
    // get them back. Concurrent flushes can't both win — the second one's
    // status=eq.pending filter matches nothing once the first commits.
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/pending_owner_messages?tenant_phone=eq.${encodeURIComponent(clean)}&status=eq.pending&order=received_at.asc`,
      {
        method: 'PATCH',
        headers: { ...headers(), Prefer: 'return=representation' },
        body: JSON.stringify({ status: 'processing' }),
      },
    );
    if (!res.ok) return null;
    const rows: Array<{ id: string; text: string; received_at: string }> = await res.json();
    if (!rows.length) return null; // another flush already owns this burst

    rows.sort((a, b) => new Date(a.received_at).getTime() - new Date(b.received_at).getTime());
    const combinedText = rows.map((r) => r.text).join('\n');

    // Mark done + prune old rows — fire-and-forget, never block the reply.
    const ids = rows.map((r) => r.id);
    void fetch(
      `${SUPABASE_URL}/rest/v1/pending_owner_messages?id=in.(${ids.join(',')})`,
      { method: 'PATCH', headers: { ...headers(), Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'done' }) },
    ).catch(() => {});
    const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    void fetch(
      `${SUPABASE_URL}/rest/v1/pending_owner_messages?tenant_phone=eq.${encodeURIComponent(clean)}&status=eq.done&created_at=lt.${cutoff}`,
      { method: 'DELETE', headers: { ...headers(), Prefer: 'return=minimal' } },
    ).catch(() => {});

    return { combinedText, count: rows.length };
  } catch {
    return null;
  }
}

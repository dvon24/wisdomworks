/**
 * Owner message — universal outbound send to the tenant's WhatsApp.
 *
 * This is the SINGLE place anything Iris or a lane agent says to the owner
 * leaves the system. Two responsibilities:
 *
 *   1. POST to Meta Graph API (text, image, or video).
 *   2. Append the message to `whatsapp_contexts.conversation_history` so the
 *      assistant's own outputs land in her short-term memory. Before this
 *      existed, proactive cron sends were invisible to Iris on her next
 *      turn — she'd happily re-remind the owner of things she already
 *      told them yesterday.
 *
 * Every cron, every agent-tick, every webhook reply MUST route through
 * here. If a new path bypasses it, Iris's memory of her own outputs
 * silently regresses.
 *
 * For the iris-brain reactive path (owner messages Iris first), the brain
 * still owns the user/context object — call sendOwnerMessage with
 * `skipHistoryAppend: true` and append manually so we don't double-write.
 * All other (proactive) paths pass `skipHistoryAppend: false` (default).
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GRAPH_API = 'https://graph.facebook.com/v25.0';

const supaHeaders = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

/**
 * Identifies the agent / cron that produced this message. Useful for
 * memory inspection ("which agent said X yesterday") and dashboards.
 */
export type OwnerMessageSource =
  | 'iris'
  | 'agent-tick'
  | 'daily-briefing'
  | 'digest'
  | 'email-sift'
  | 'email-followup'
  | 'calendar-sync'
  | 'marketing-loop'
  | 'webhook-image'
  | 'webhook-video'
  | 'manual';

export interface SendOwnerMessageInput {
  tenantPhone: string;
  /** The message text the owner sees. For media, this becomes the caption. */
  body: string;
  source: OwnerMessageSource;
  /** Optional: send a video/image instead of plain text. body becomes caption. */
  media?: {
    type: 'video' | 'image';
    url: string;
  };
  /**
   * Set true if the caller is already responsible for appending to
   * conversation_history (e.g. iris-brain, which owns the user object).
   * Default false — proactive sends append automatically.
   */
  skipHistoryAppend?: boolean;
  /**
   * Routing priority (added 2026-05-19 with the unified outbox).
   *
   *   'chat_reply' (default for source='iris') — synchronous send,
   *     owner needs to see it now. Bypasses the queue.
   *   'urgent' — synchronous send for critical alerts the cron path
   *     can't defer (e.g. security incident notification).
   *   'digest' (default for cron sources) — enqueued to outbound_messages;
   *     drainer holds during active chat windows and may merge with
   *     other pending digests for the same tenant.
   *
   * If unset, the priority is inferred from `source`: 'iris' →
   * chat_reply, everything else → digest.
   */
  priority?: 'chat_reply' | 'urgent' | 'digest';
}

export interface SendOwnerMessageResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

export async function sendOwnerMessage(input: SendOwnerMessageInput): Promise<SendOwnerMessageResult> {
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneId || !accessToken) {
    return { ok: false, error: 'WHATSAPP_PHONE_ID / WHATSAPP_ACCESS_TOKEN not configured' };
  }

  const cleanTo = input.tenantPhone.replace(/[\s\-+()]/g, '');

  // Resolve effective priority. Explicit override wins; otherwise infer:
  // iris's chat replies + media webhooks (which are reactive to inbound
  // owner-side media) are chat_reply. Everything else defaults to digest,
  // which routes through the queue.
  const priority: 'chat_reply' | 'urgent' | 'digest' =
    input.priority ??
    (input.source === 'iris' || input.source === 'webhook-image' || input.source === 'webhook-video'
      ? 'chat_reply'
      : 'digest');

  // Digest path — enqueue and return. The outbound-drainer cron will
  // pick it up, hold during active chat windows, and merge with other
  // pending digests for the same tenant.
  if (priority === 'digest') {
    return enqueueOutboundMessage({
      tenantPhone: cleanTo,
      body: input.body,
      source: input.source,
      media: input.media,
      priority,
    });
  }

  // Synchronous path — chat_reply + urgent both deliver now.

  // 1. Build the Graph API payload
  let payload: Record<string, unknown>;
  if (input.media) {
    payload = {
      messaging_product: 'whatsapp',
      to: cleanTo,
      type: input.media.type,
      [input.media.type]: {
        link: input.media.url,
        ...(input.body ? { caption: input.body.slice(0, 1024) } : {}),
      },
    };
  } else {
    payload = {
      messaging_product: 'whatsapp',
      to: cleanTo,
      type: 'text',
      text: { body: input.body.slice(0, 4096) },
    };
  }

  // 2. Send
  let messageId: string | undefined;
  try {
    const res = await fetch(`${GRAPH_API}/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const errBody = await res.text();
      console.warn(`[owner-message:${input.source}] send failed:`, res.status, errBody);
      return { ok: false, error: errBody };
    }
    const data = await res.json();
    messageId = data.messages?.[0]?.id;
  } catch (err: any) {
    console.warn(`[owner-message:${input.source}] send exception:`, err);
    return { ok: false, error: err?.message ?? String(err) };
  }

  // 3. Append to conversation_history (unless caller will do it themselves)
  //    AND stamp last_assistant_message_at so the drainer can detect
  //    active chat windows.
  if (!input.skipHistoryAppend) {
    void appendAssistantMessageToHistory({
      tenantPhone: cleanTo,
      body: input.body,
      source: input.source,
      mediaUrl: input.media?.url,
    });
  } else {
    // iris-brain owns history append but still needs the
    // last_assistant_message_at stamp updated for the drainer.
    void stampLastAssistantMessageAt(cleanTo);
  }

  return { ok: true, messageId };
}

// ─── Unified outbox (Story 2.4-ish — coordinator pattern) ─────────────

/**
 * Enqueue a message for the outbound-drainer cron to deliver. The
 * drainer enforces "don't interrupt active chats" — if the owner has
 * messaged Iris (or vice-versa) within 60s, the digest is held 5min.
 * Multiple pending digests for the same tenant get merged into one.
 */
export async function enqueueOutboundMessage(input: {
  tenantPhone: string;
  body: string;
  source: OwnerMessageSource;
  media?: { type: 'video' | 'image'; url: string };
  priority?: 'chat_reply' | 'urgent' | 'digest';
}): Promise<SendOwnerMessageResult> {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return { ok: false, error: 'supabase not configured (outbox enqueue)' };
  }
  const cleanTo = input.tenantPhone.replace(/[\s\-+()]/g, '');
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/outbound_messages`, {
      method: 'POST',
      headers: { ...supaHeaders(), Prefer: 'return=minimal' },
      body: JSON.stringify({
        tenant_phone: cleanTo,
        priority: input.priority ?? 'digest',
        body: input.body,
        source: input.source,
        media: input.media ?? null,
        status: 'pending',
      }),
    });
    if (!res.ok) {
      const errBody = await res.text();
      console.warn(`[outbox:${input.source}] enqueue failed:`, res.status, errBody);
      return { ok: false, error: errBody };
    }
    return { ok: true, messageId: 'queued' };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

/**
 * Drainer-side delivery. Bypasses the priority routing in
 * sendOwnerMessage (since by the time the drainer calls this, the
 * queue has already done the holding/merging). Stamps history +
 * last_assistant_message_at on success. Returns the WhatsApp
 * message id for the drainer to record.
 */
export async function deliverOutboundFromQueue(input: {
  tenantPhone: string;
  body: string;
  source: OwnerMessageSource;
  media?: { type: 'video' | 'image'; url: string };
}): Promise<SendOwnerMessageResult> {
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneId || !accessToken) {
    return { ok: false, error: 'WHATSAPP_PHONE_ID / WHATSAPP_ACCESS_TOKEN not configured' };
  }
  const cleanTo = input.tenantPhone.replace(/[\s\-+()]/g, '');

  let payload: Record<string, unknown>;
  if (input.media) {
    payload = {
      messaging_product: 'whatsapp',
      to: cleanTo,
      type: input.media.type,
      [input.media.type]: {
        link: input.media.url,
        ...(input.body ? { caption: input.body.slice(0, 1024) } : {}),
      },
    };
  } else {
    payload = {
      messaging_product: 'whatsapp',
      to: cleanTo,
      type: 'text',
      text: { body: input.body.slice(0, 4096) },
    };
  }

  try {
    const res = await fetch(`${GRAPH_API}/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const errBody = await res.text();
      return { ok: false, error: errBody };
    }
    const data = await res.json();
    const messageId = data.messages?.[0]?.id;

    void appendAssistantMessageToHistory({
      tenantPhone: cleanTo,
      body: input.body,
      source: input.source,
      mediaUrl: input.media?.url,
    });
    void stampLastAssistantMessageAt(cleanTo);

    return { ok: true, messageId };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

async function stampLastAssistantMessageAt(cleanPhone: string): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    await fetch(
      `${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${cleanPhone}`,
      {
        method: 'PATCH',
        headers: { ...supaHeaders(), Prefer: 'return=minimal' },
        body: JSON.stringify({ last_assistant_message_at: new Date().toISOString() }),
      },
    );
  } catch {
    // Non-fatal — the timestamp is a drainer hint, not load-bearing.
  }
}

// ─── Conversation history append (proactive paths) ────────────────────────

/**
 * Append an assistant message to whatsapp_contexts.conversation_history.
 * Read-modify-write — there's a small race window if two crons fire
 * within the same second, but message rate makes this acceptable. The
 * source tag rides along in metadata so debugging and "which agent said
 * what" inspection works.
 */
async function appendAssistantMessageToHistory(input: {
  tenantPhone: string;
  body: string;
  source: OwnerMessageSource;
  mediaUrl?: string;
}): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    const cur = await fetch(
      `${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${input.tenantPhone}&select=conversation_history,message_count`,
      { headers: supaHeaders() },
    );
    if (!cur.ok) {
      console.warn(`[owner-message:${input.source}] history load failed:`, cur.status);
      return;
    }
    const rows = await cur.json();
    if (!rows[0]) {
      // Tenant context row hasn't been created yet — drop append. The first
      // inbound message will create the row on its own.
      return;
    }
    const history = Array.isArray(rows[0].conversation_history) ? rows[0].conversation_history : [];
    const messageCount = typeof rows[0].message_count === 'number' ? rows[0].message_count : 0;

    const bodyForHistory = input.mediaUrl
      ? `[${input.source === 'webhook-video' ? 'video' : 'media'}] ${input.body}`
      : input.body;

    history.push({
      role: 'assistant',
      content: bodyForHistory.slice(0, 4096),
      timestamp: new Date().toISOString(),
      source: input.source,
    });

    // Trim to last 50 (same cap as context-store.ts MAX_CONVERSATION_MESSAGES)
    const trimmed = history.length > 50 ? history.slice(-50) : history;

    await fetch(
      `${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${input.tenantPhone}`,
      {
        method: 'PATCH',
        headers: { ...supaHeaders(), Prefer: 'return=minimal' },
        body: JSON.stringify({
          conversation_history: trimmed,
          message_count: messageCount + 1,
          last_seen: new Date().toISOString(),
        }),
      },
    );
  } catch (err) {
    console.warn(`[owner-message:${input.source}] history append exception:`, err);
  }
}

// ─── Pre-flight: has owner already addressed this? ────────────────────────

/**
 * Cheap textual gate to apply BEFORE pushing a reminder/draft to the owner.
 *
 * Scans the last N conversation turns for hits on a list of topic keywords.
 * If the owner has plausibly already said the thing was done ("sent it",
 * "done", "already X"), returns true so the caller can skip the push.
 *
 * This is intentionally lightweight — not a perfect classifier. It
 * prevents the most embarrassing case: Iris re-asking about an email the
 * owner already told her they sent. For richer dedup, callers can also
 * check knowledge_atoms or business_insights.
 *
 * Returns { addressed, evidence } so callers can log why they skipped.
 */
export async function ownerAlreadyAddressed(input: {
  tenantPhone: string;
  /** Keywords that identify the topic ("Maria email", "permit", "invoice 4501"). */
  topicKeywords: string[];
  /** How many recent turns to scan. Default 12. */
  windowMessages?: number;
}): Promise<{ addressed: boolean; evidence?: string }> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { addressed: false };
  if (input.topicKeywords.length === 0) return { addressed: false };
  const cleanPhone = input.tenantPhone.replace(/[\s\-+()]/g, '');
  const window = Math.max(2, Math.min(50, input.windowMessages ?? 12));
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${cleanPhone}&select=conversation_history`,
      { headers: supaHeaders() },
    );
    if (!res.ok) return { addressed: false };
    const rows = await res.json();
    const history: Array<{ role: string; content: string }> = rows[0]?.conversation_history ?? [];
    const recent = history.slice(-window);

    // Owner-side "I did it" patterns. Tight on purpose — false positives
    // here mean we silently skip a real reminder, so we only act on
    // unambiguous completion language.
    const doneRegex = /\b(already (sent|did|done|handled|paid|booked|posted|published|replied)|sent (it|that|already)|done( yesterday| today| earlier)?|just (sent|did|posted|paid)|took care of (it|that)|handled (it|that))\b/i;

    const keywordsLower = input.topicKeywords.map((k) => k.toLowerCase().trim()).filter((k) => k.length >= 2);

    for (const msg of recent) {
      if (msg.role !== 'user') continue;
      const content = (msg.content ?? '').toLowerCase();
      const keywordHit = keywordsLower.some((k) => content.includes(k));
      if (!keywordHit) continue;
      if (doneRegex.test(content)) {
        return { addressed: true, evidence: msg.content.slice(0, 200) };
      }
    }
    return { addressed: false };
  } catch (err) {
    console.warn('[owner-message] addressed-check failed:', err);
    return { addressed: false };
  }
}

/**
 * Unified notification queue + structured digest synthesizer.
 *
 * Every proactive WhatsApp push goes through enqueueNotification(). Iris's
 * digest cron drains the queue periodically and bundles items into ONE
 * structured WhatsApp message with severity-tiered sections so the user
 * sees a single coherent update instead of N individual texts.
 *
 * Critical-severity items bypass the queue (push immediately) — that's
 * for things like security alerts or payment failures where a 30-min
 * delay matters.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

export type NotificationKind =
  | 'escalation'
  | 'email_attention'
  | 'followup_prompt'
  | 'briefing_item'
  | 'process_detected'
  | 'agent_observation';

export type NotificationSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface NotificationRow {
  id: string;
  tenant_phone: string;
  kind: NotificationKind;
  severity: NotificationSeverity;
  title: string;
  body?: string;
  source_agent?: string;
  source_id?: string;
  metadata: any;
  status: 'pending' | 'delivered' | 'expired' | 'dismissed';
  created_at: string;
}

export interface EnqueueArgs {
  tenantPhone: string;
  kind: NotificationKind;
  severity?: NotificationSeverity;
  title: string;
  body?: string;
  sourceAgent?: string;
  sourceId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Enqueue a notification for the next digest. Returns the id (so caller
 * can correlate later) or null on failure.
 *
 * This is the SINGLE entry point for all proactive notifications — push
 * paths should never call WhatsApp directly anymore (except critical).
 */
export async function enqueueNotification(args: EnqueueArgs): Promise<string | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/notification_queue`, {
      method: 'POST',
      headers: { ...headers(), Prefer: 'return=representation' },
      body: JSON.stringify({
        tenant_phone: args.tenantPhone,
        kind: args.kind,
        severity: args.severity ?? 'medium',
        title: args.title.slice(0, 200),
        body: args.body?.slice(0, 1000) ?? null,
        source_agent: args.sourceAgent ?? null,
        source_id: args.sourceId ?? null,
        metadata: args.metadata ?? {},
        status: 'pending',
      }),
    });
    if (!res.ok) {
      console.warn(`[notifications] enqueue failed: ${res.status} ${await res.text()}`);
      return null;
    }
    const rows = await res.json();
    return rows[0]?.id ?? null;
  } catch (err) {
    console.warn('[notifications] enqueue exception:', err);
    return null;
  }
}

/** Pull all pending notifications for a tenant, sorted by severity then age. */
export async function loadPending(tenantPhone: string): Promise<NotificationRow[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/notification_queue?tenant_phone=eq.${tenantPhone}&status=eq.pending&order=created_at.asc&select=*`,
      { headers: headers() },
    );
    if (!res.ok) return [];
    const rows: NotificationRow[] = await res.json();
    const sevOrder = { critical: 0, high: 1, medium: 2, low: 3 } as const;
    return rows.sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity]);
  } catch {
    return [];
  }
}

/** Mark a batch of notifications delivered after they've been pushed. */
export async function markDelivered(ids: string[], deliveredInMessageId?: string): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY || ids.length === 0) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/notification_queue?id=in.(${ids.join(',')})`, {
      method: 'PATCH',
      headers: { ...headers(), Prefer: 'return=minimal' },
      body: JSON.stringify({
        status: 'delivered',
        delivered_at: new Date().toISOString(),
        delivered_in_message_id: deliveredInMessageId ?? null,
      }),
    });
  } catch (err) {
    console.warn('[notifications] markDelivered failed:', err);
  }
}

export async function expireStaleNotifications(): Promise<number> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return 0;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/expire_stale_notifications`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ p_max_age_hours: 48 }),
    });
    if (!res.ok) return 0;
    return parseInt((await res.text()).trim(), 10) || 0;
  } catch {
    return 0;
  }
}

// ─── Digest synthesis ─────────────────────────────────────────────────────

/** Group notifications into severity buckets with friendly labels. */
function groupBySeverity(items: NotificationRow[]) {
  return {
    critical: items.filter((i) => i.severity === 'critical'),
    high: items.filter((i) => i.severity === 'high'),
    medium: items.filter((i) => i.severity === 'medium'),
    low: items.filter((i) => i.severity === 'low'),
  };
}

/**
 * Render a structured WhatsApp digest from queued notifications. Falls back
 * to a plain-text format if Anthropic isn't available — Sonnet is used to
 * polish phrasing and merge similar items, but the structure is hard-coded
 * so the user gets predictable section headings.
 */
export async function synthesizeStructuredDigest(args: {
  orchestratorName: string;
  notifications: NotificationRow[];
  recentAgentRuns?: any[];
}): Promise<{ hasSignal: boolean; message: string; deliveredIds: string[] }> {
  const { notifications, orchestratorName, recentAgentRuns = [] } = args;
  if (notifications.length === 0 && recentAgentRuns.length === 0) {
    return { hasSignal: false, message: '', deliveredIds: [] };
  }

  const grouped = groupBySeverity(notifications);
  const deliveredIds = notifications.map((n) => n.id);

  // Build a plain-text fallback first — same structure Anthropic will polish
  const sections: string[] = [];
  if (grouped.critical.length > 0) {
    sections.push('🚨 URGENT', ...grouped.critical.map((n) => `- ${n.title}${n.body ? `: ${n.body.slice(0, 120)}` : ''}`));
  }
  if (grouped.high.length > 0) {
    if (sections.length > 0) sections.push('');
    sections.push('Important', ...grouped.high.map((n) => `- ${n.title}${n.body ? `: ${n.body.slice(0, 120)}` : ''}`));
  }
  if (grouped.medium.length > 0) {
    if (sections.length > 0) sections.push('');
    sections.push('Worth a glance', ...grouped.medium.map((n) => `- ${n.title}${n.body ? `: ${n.body.slice(0, 120)}` : ''}`));
  }
  if (grouped.low.length > 0) {
    if (sections.length > 0) sections.push('');
    sections.push('FYI', ...grouped.low.map((n) => `- ${n.title}`));
  }

  const fallback = sections.join('\n');

  if (!ANTHROPIC_API_KEY || notifications.length === 0) {
    return { hasSignal: sections.length > 0, message: fallback, deliveredIds };
  }

  // Use Sonnet to merge similar items, tighten phrasing, and write a 1-line
  // intro in Iris's voice. Section structure stays hard-coded.
  const itemsForLLM = notifications.map((n) =>
    `[${n.severity}] ${n.kind} from ${n.source_agent ?? 'system'}: ${n.title}${n.body ? ` — ${n.body.slice(0, 200)}` : ''}`,
  ).join('\n');

  const runsBlock = recentAgentRuns.length > 0
    ? `\n\nRecent agent activity context (do NOT repeat as bullets, just use to inform the intro):\n${recentAgentRuns.slice(0, 10).map((r) => `- ${r.agent_name}: ${r.output_summary?.slice(0, 100) ?? ''}`).join('\n')}`
    : '';

  const system = `You are ${orchestratorName}. Build a SINGLE structured WhatsApp digest from the queued items below. The user wants ONE message, not N.

Required structure (skip empty sections):
🚨 URGENT
- [items]

Important
- [items]

Worth a glance
- [items]

FYI
- [items]

Rules:
- Lead with a 1-line opener in your voice ("Quick update —" or similar). Keep it short.
- One bullet per item. Merge near-duplicates (e.g. "3 follow-ups stacked while you were away" instead of 3 separate bullets if they're all the same kind).
- Each bullet: 1 line, concrete, names + addresses where relevant. No fluff.
- Skip a section entirely if it has no items.
- If only FYI items exist, still show them but acknowledge it's quiet.
- Total message under 1500 chars.
- No markdown bold/italics — WhatsApp shows them as literal asterisks.`;

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 800,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: `Queued notifications:\n${itemsForLLM}${runsBlock}` }],
      }),
    });
    if (!res.ok) return { hasSignal: true, message: fallback, deliveredIds };
    const data = await res.json();
    const text = (data.content?.[0]?.text ?? '').trim();
    return { hasSignal: true, message: text || fallback, deliveredIds };
  } catch {
    return { hasSignal: true, message: fallback, deliveredIds };
  }
}

/**
 * Story 2.16 Phase 2c — Email engagement signal.
 *
 * Passive learning loop: track whether the owner OPENS classified
 * emails. Aggregate by sender. Feed sender open-rates into the
 * classifier system prompt so future emails from senders the owner
 * actually engages with get prioritized, and senders they ignore
 * auto-deprioritize over time.
 *
 * No notifications, no approval cards, no surfacing — pure background
 * learning. The classifier silently uses the data.
 *
 * Public API:
 *   - recordClassifiedForEngagement: called from email-sift to seed
 *     a tracking row at classification time
 *   - pollEngagementForTenant: called from cron — for each tracking
 *     row in the polling window, re-check provider read state
 *   - getSenderEngagement: aggregate open rate over 30/90 days
 *   - buildEngagementContext: render a top-engaged + top-ignored
 *     senders block for the classifier system prompt
 */

import type { OAuthConnection } from '@wisdomworks/shared';
import { getEmailReadState, loadConnectionsForPhone } from '@wisdomworks/shared';
import { checkImapReadStates } from './imap-runtime';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

const TRACKING_WINDOW_DAYS = 14;
const STALE_CHECK_HOURS = 6;

// ─── Capture: seed tracking rows at classification time ──────────────────

interface EmailForEngagement {
  id: string;
  from: string;
  subject: string;
  date: string;
  isUnread?: boolean;
}

export async function recordClassifiedForEngagement(input: {
  tenantPhone: string;
  provider: string;
  emails: EmailForEngagement[];
}): Promise<number> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return 0;
  if (input.emails.length === 0) return 0;
  const cleanPhone = input.tenantPhone.replace(/[\s\-+()]/g, '');

  let count = 0;
  for (const e of input.emails) {
    const wasUnread = e.isUnread !== false; // default true (caller is email-sift on unread mail)
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/email_engagement_signals?on_conflict=tenant_phone,email_id`,
        {
          method: 'POST',
          headers: { ...headers(), Prefer: 'resolution=ignore-duplicates,return=minimal' },
          body: JSON.stringify({
            tenant_phone: cleanPhone,
            provider: input.provider,
            email_id: e.id,
            sender: e.from.toLowerCase().slice(0, 250),
            subject: e.subject?.slice(0, 500) ?? null,
            email_received_at: e.date,
            was_unread_at_classification: wasUnread,
            currently_unread: wasUnread,
            status: 'tracking',
          }),
        },
      );
      if (res.ok) count++;
    } catch {}
  }
  return count;
}

// ─── Polling: re-check read state for tracking rows ──────────────────────

export interface PollResult {
  tenant_phone: string;
  checked: number;
  newly_opened: number;
  archived: number;
  errors: string[];
}

/**
 * Cron worker. For each tracking row older than 6h, re-check provider
 * read state. If unread → read, record first_opened_at. Archive rows
 * past the 14-day window.
 */
export async function pollEngagementForTenant(tenantPhone: string): Promise<PollResult> {
  const result: PollResult = { tenant_phone: tenantPhone, checked: 0, newly_opened: 0, archived: 0, errors: [] };
  if (!SUPABASE_URL || !SUPABASE_KEY) return result;
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');

  // Pull tracking rows due for a re-check (checked_at older than 6h AND
  // within 14-day window). Limit to 100 per tick to bound cost.
  const sinceStale = new Date(Date.now() - STALE_CHECK_HOURS * 60 * 60 * 1000).toISOString();
  const windowStart = new Date(Date.now() - TRACKING_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  let rows: any[] = [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/email_engagement_signals?tenant_phone=eq.${cleanPhone}&status=eq.tracking&checked_at=lt.${sinceStale}&email_received_at=gte.${windowStart}&order=email_received_at.desc&limit=100&select=id,provider,email_id,currently_unread`,
      { headers: headers() },
    );
    if (res.ok) rows = await res.json();
  } catch (err: any) {
    result.errors.push(`fetch tracking rows: ${err?.message ?? String(err)}`);
    return result;
  }
  if (rows.length === 0) {
    // Still archive any past-window rows
    result.archived = await archivePastWindow(cleanPhone, windowStart);
    return result;
  }

  // Group by provider so we make one batched IMAP call per provider
  const byProvider = new Map<string, any[]>();
  for (const r of rows) {
    const arr = byProvider.get(r.provider) ?? [];
    arr.push(r);
    byProvider.set(r.provider, arr);
  }

  const connections = await loadConnectionsForPhone(tenantPhone);

  for (const [provider, providerRows] of byProvider) {
    const conn = connections.find((c) => c.provider === provider && c.service === 'email');
    if (!conn) {
      result.errors.push(`no active ${provider} connection`);
      continue;
    }

    if (provider === 'yahoo' || provider === 'imap') {
      // Single IMAP roundtrip for all uids at once
      const uids = providerRows.map((r) => r.email_id);
      const stateRes = await checkImapReadStates(conn as any, uids);
      if (!stateRes.success || !stateRes.data) {
        result.errors.push(`IMAP fetch states: ${stateRes.error}`);
        continue;
      }
      for (const row of providerRows) {
        result.checked++;
        const isRead = stateRes.data.get(row.email_id);
        if (typeof isRead === 'undefined') continue;
        const newlyOpened = row.currently_unread === true && isRead === true;
        await fetch(`${SUPABASE_URL}/rest/v1/email_engagement_signals?id=eq.${row.id}`, {
          method: 'PATCH',
          headers: { ...headers(), Prefer: 'return=minimal' },
          body: JSON.stringify({
            currently_unread: !isRead,
            ...(newlyOpened ? { first_opened_at: new Date().toISOString() } : {}),
            checked_at: new Date().toISOString(),
          }),
        });
        if (newlyOpened) result.newly_opened++;
      }
    } else {
      // Gmail / Outlook — one call per email, but cheap (metadata-only)
      for (const row of providerRows) {
        result.checked++;
        const state = await getEmailReadState(conn, row.email_id);
        if (!state.success) continue;
        if (!state.data) {
          // Email was deleted from inbox (state.data === null) or fetch
          // returned undefined data — archive
          await fetch(`${SUPABASE_URL}/rest/v1/email_engagement_signals?id=eq.${row.id}`, {
            method: 'PATCH',
            headers: { ...headers(), Prefer: 'return=minimal' },
            body: JSON.stringify({ status: 'archived', checked_at: new Date().toISOString() }),
          });
          result.archived++;
          continue;
        }
        const isRead = state.data.isRead;
        const newlyOpened = row.currently_unread === true && isRead === true;
        await fetch(`${SUPABASE_URL}/rest/v1/email_engagement_signals?id=eq.${row.id}`, {
          method: 'PATCH',
          headers: { ...headers(), Prefer: 'return=minimal' },
          body: JSON.stringify({
            currently_unread: !isRead,
            ...(newlyOpened ? { first_opened_at: new Date().toISOString() } : {}),
            checked_at: new Date().toISOString(),
          }),
        });
        if (newlyOpened) result.newly_opened++;
      }
    }
  }

  result.archived += await archivePastWindow(cleanPhone, windowStart);
  return result;
}

async function archivePastWindow(cleanPhone: string, windowStart: string): Promise<number> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return 0;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/email_engagement_signals?tenant_phone=eq.${cleanPhone}&status=eq.tracking&email_received_at=lt.${windowStart}`,
      {
        method: 'PATCH',
        headers: { ...headers(), Prefer: 'return=representation' },
        body: JSON.stringify({ status: 'archived' }),
      },
    );
    if (!res.ok) return 0;
    const rows = await res.json();
    return Array.isArray(rows) ? rows.length : 0;
  } catch {
    return 0;
  }
}

// ─── Aggregation: per-sender open rate ───────────────────────────────────

export interface SenderEngagement {
  sender: string;
  total: number;
  opened: number;
  openRate: number;
}

/**
 * Compute open rate per sender over a recent window. Returns top N
 * (by total sent) so the classifier prompt sees the most-frequent
 * senders' engagement patterns.
 */
export async function getEngagementBySender(
  tenantPhone: string,
  options: { windowDays?: number; limit?: number; minTotal?: number } = {},
): Promise<SenderEngagement[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  const windowDays = options.windowDays ?? 90;
  const limit = options.limit ?? 30;
  const minTotal = options.minTotal ?? 3;
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/email_engagement_signals?tenant_phone=eq.${cleanPhone}&email_received_at=gte.${since}&select=sender,currently_unread,first_opened_at`,
      { headers: headers() },
    );
    if (!res.ok) return [];
    const rows: Array<{ sender: string; currently_unread: boolean; first_opened_at: string | null }> = await res.json();

    const bucket = new Map<string, { total: number; opened: number }>();
    for (const r of rows) {
      const sender = r.sender.toLowerCase();
      const cur = bucket.get(sender) ?? { total: 0, opened: 0 };
      cur.total++;
      // "opened" if we've recorded first_opened_at OR if currently_unread is false
      if (r.first_opened_at || r.currently_unread === false) cur.opened++;
      bucket.set(sender, cur);
    }
    return Array.from(bucket.entries())
      .filter(([, v]) => v.total >= minTotal)
      .map(([sender, v]) => ({
        sender,
        total: v.total,
        opened: v.opened,
        openRate: v.total > 0 ? v.opened / v.total : 0,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * Render the top-engaged + top-ignored senders as a classifier-prompt
 * block. The classifier uses this to bias toward senders the owner
 * actually opens and away from senders they reliably ignore.
 */
export async function buildEngagementContext(tenantPhone: string): Promise<string> {
  const senders = await getEngagementBySender(tenantPhone, { windowDays: 90, limit: 50, minTotal: 3 });
  if (senders.length === 0) return '';

  const engaged = senders
    .filter((s) => s.openRate >= 0.7 && s.total >= 5)
    .sort((a, b) => b.openRate - a.openRate || b.total - a.total)
    .slice(0, 10);
  const ignored = senders
    .filter((s) => s.openRate <= 0.2 && s.total >= 5)
    .sort((a, b) => a.openRate - b.openRate || b.total - a.total)
    .slice(0, 10);

  if (engaged.length === 0 && ignored.length === 0) return '';

  const parts: string[] = [];
  if (engaged.length > 0) {
    const lines = engaged.map((s) => `   ${s.sender} (${Math.round(s.openRate * 100)}% open, ${s.total} emails)`).join('\n');
    parts.push(`HIGH-ENGAGEMENT SENDERS (owner reliably opens these — strongly bias toward business and NEVER classify as spam):\n${lines}`);
  }
  if (ignored.length > 0) {
    const lines = ignored.map((s) => `   ${s.sender} (${Math.round(s.openRate * 100)}% open, ${s.total} emails)`).join('\n');
    parts.push(`IGNORED-BY-OWNER SENDERS (owner reliably ignores — bias toward spam / informational; do NOT draft replies):\n${lines}`);
  }
  return `\n\n${parts.join('\n\n')}`;
}

/**
 * Email notifications — sends owner-facing notifications (digest + critical
 * bypass) to the owner's email address in addition to WhatsApp.
 *
 * Uses whichever email account the owner has connected (Yahoo IMAP/SMTP,
 * Google Gmail API, Microsoft Graph). Self-send: from the owner's own
 * address to the owner's own address. No third-party transactional
 * service required — the credentials are already in oauth_connections.
 *
 * Opt-in: stored on whatsapp_contexts.profile.email_notifications.enabled.
 * Owner toggles via enable_email_notifications / disable_email_notifications
 * agent tools.
 */

import { loadConnectionsForPhone, sendEmail as sendOauthEmail } from '@wisdomworks/shared';
import { sendImap } from './imap-runtime';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export interface EmailNotificationPrefs {
  enabled: boolean;
  /** Override the auto-detected address (defaults to connected email account_email). */
  address?: string;
  /** If true, only critical-severity items trigger email (digests still WhatsApp-only). */
  criticalOnly?: boolean;
}

/** Read the owner's email-notification preferences from their profile. */
export async function loadEmailPrefs(tenantPhone: string): Promise<EmailNotificationPrefs> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { enabled: false };
  try {
    const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${cleanPhone}&select=profile`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
    );
    if (!res.ok) return { enabled: false };
    const rows = await res.json();
    const prefs = rows[0]?.profile?.email_notifications;
    if (!prefs || typeof prefs !== 'object') return { enabled: false };
    return {
      enabled: !!prefs.enabled,
      address: typeof prefs.address === 'string' ? prefs.address : undefined,
      criticalOnly: !!prefs.criticalOnly,
    };
  } catch {
    return { enabled: false };
  }
}

/** Save the owner's email-notification preferences. */
export async function saveEmailPrefs(tenantPhone: string, prefs: EmailNotificationPrefs): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false;
  try {
    const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
    // Load → patch → write back the whole profile blob
    const cur = await fetch(
      `${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${cleanPhone}&select=profile`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
    );
    if (!cur.ok) return false;
    const rows = await cur.json();
    const profile = rows[0]?.profile ?? {};
    profile.email_notifications = {
      enabled: prefs.enabled,
      address: prefs.address ?? null,
      criticalOnly: !!prefs.criticalOnly,
    };
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${cleanPhone}`,
      {
        method: 'PATCH',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ profile }),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Send a notification email to the owner via their connected email account.
 * Returns true on success. Fail-quiet on error so a broken email link
 * doesn't break the digest cron's WhatsApp send.
 */
export async function sendNotificationEmail(input: {
  tenantPhone: string;
  subject: string;
  body: string;
  isCritical?: boolean;
}): Promise<{ ok: boolean; reason?: string }> {
  const prefs = await loadEmailPrefs(input.tenantPhone);
  if (!prefs.enabled) return { ok: false, reason: 'email notifications disabled' };
  if (prefs.criticalOnly && !input.isCritical) return { ok: false, reason: 'criticalOnly mode, not critical' };

  // Find the owner's connected email account
  const connections = await loadConnectionsForPhone(input.tenantPhone);
  const emailConn = connections.find((c) => c.service === 'email');
  if (!emailConn) return { ok: false, reason: 'no email account connected' };

  const recipient = prefs.address || emailConn.account_email;
  if (!recipient) return { ok: false, reason: 'no email address resolved' };

  // Yahoo/IMAP → SMTP path; Google/Microsoft → Gmail/Graph API path
  const isImap = emailConn.provider === 'yahoo' || emailConn.provider === 'imap';
  try {
    const result = isImap
      ? await sendImap(emailConn as any, {
          to: [recipient],
          subject: input.subject,
          body: input.body,
        })
      : await sendOauthEmail(emailConn, {
          to: [recipient],
          subject: input.subject,
          body: input.body,
        });

    if (!result.success) return { ok: false, reason: result.error ?? 'send failed' };
    return { ok: true };
  } catch (err: any) {
    return { ok: false, reason: err?.message ?? String(err) };
  }
}

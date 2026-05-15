/**
 * Disconnect an OAuth connection from the deck.
 *
 * POST /api/connections/disconnect
 * Body: { phone, provider, service }
 *
 * Soft-revoke: marks the row status='revoked' instead of deleting. Keeps
 * the audit trail intact. The actual third-party token at Google/Microsoft/
 * etc. is NOT revoked here — owner must do that at the provider's
 * settings page if they want full revocation. We surface that in the
 * response.
 *
 * Audit-logged via the hash-chained ledger so disconnects are
 * tamper-evident.
 *
 * Auth: requires the deck session cookie matching the requested phone
 * (requireOwnerAuth) — owner can only disconnect their own services.
 */

import { NextResponse } from 'next/server';
import { requireOwnerAuth } from '../../_lib/api-auth';
import { logAuditEvent } from '../../_lib/audit-log';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const PROVIDER_REVOKE_URLS: Record<string, string> = {
  google: 'https://myaccount.google.com/permissions',
  microsoft: 'https://account.microsoft.com/privacy/app-access',
  meta: 'https://accounts.facebook.com/business_apps',
  stripe: 'https://dashboard.stripe.com/settings/apps',
  square: 'https://app.squareup.com/dashboard/account/preferences',
  calendly: 'https://calendly.com/integrations',
  mindbody: 'https://clients.mindbodyonline.com/manage/account',
};

export async function POST(request: Request) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  const body = await request.json().catch(() => ({}));
  const { phone, provider, service } = body as { phone?: string; provider?: string; service?: string };
  if (!phone || !provider || !service) {
    return NextResponse.json({ error: 'phone, provider, and service required' }, { status: 400 });
  }
  const cleanPhone = String(phone).replace(/[\s\-+()]/g, '');

  const denied = await requireOwnerAuth(request, cleanPhone);
  if (denied) return denied;

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/oauth_connections?phone_number=eq.${cleanPhone}&provider=eq.${provider}&service=eq.${service}`,
      {
        method: 'PATCH',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          status: 'revoked',
          updated_at: new Date().toISOString(),
        }),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `update failed: ${text}` }, { status: 500 });
    }

    // Audit the disconnect.
    void logAuditEvent({
      tenantPhone: cleanPhone,
      actor: cleanPhone,
      actorType: 'owner',
      action: 'admin.config_change',
      resource: `${provider}/${service}`,
      outcome: 'success',
      payload: { operation: 'disconnect_service', provider, service },
      redact: false,
    });

    return NextResponse.json({
      ok: true,
      provider,
      service,
      status: 'revoked',
      next_step_at_provider: PROVIDER_REVOKE_URLS[provider]
        ?? 'Visit your provider\'s settings to fully revoke the OAuth grant.',
      note: `Disconnected at WisdomWorks. The ${provider} token is no longer used by us, but ${provider} still has the OAuth grant on file. To FULLY revoke (so even a leaked token couldn't be used), visit the provider link above and remove WisdomWorks from your authorized apps.`,
    });
  } catch (err: any) {
    console.error('[disconnect] error:', err);
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}

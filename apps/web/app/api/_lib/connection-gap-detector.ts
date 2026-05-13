/**
 * Connection gap detector — Iris-as-onboarding-concierge.
 *
 * Compares what the owner's vertical recommends against what's actually
 * connected, identifies high-value gaps, generates one-tap OAuth links
 * the owner can approve via WhatsApp. Zero dashboard, zero API-key
 * hunting, zero tab-switching.
 */

import { INTEGRATION_CATALOG, catalogForVertical, liveProviders, type IntegrationDescriptor } from './integration-catalog';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

export interface ConnectionGap {
  provider: IntegrationDescriptor;
  /** One-tap OAuth URL with phone signed into state */
  oneTapUrl: string;
  /** Why this gap matters for the owner's vertical */
  reason: string;
}

/** Pull the list of currently-connected providers for a tenant. */
async function loadConnectedProviders(tenantPhone: string): Promise<Set<string>> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return new Set();
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/oauth_connections?phone_number=eq.${cleanPhone}&status=eq.active&select=provider`,
      { headers: headers() },
    );
    if (!res.ok) return new Set();
    const rows = await res.json();
    return new Set(rows.map((r: any) => r.provider));
  } catch {
    return new Set();
  }
}

/** Pull the owner's vertical template label from their profile. */
async function loadVerticalLabel(tenantPhone: string): Promise<string | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${cleanPhone}&select=profile,business_type`,
      { headers: headers() },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return rows[0]?.profile?.vertical_template?.label ?? null;
  } catch {
    return null;
  }
}

/**
 * Detect gaps between what the owner's vertical recommends and what they
 * have connected. Returns gaps in priority order with one-tap OAuth URLs.
 *
 * Only includes providers that are LIVE in this environment (envVars set)
 * — no point offering Stripe if we haven't configured Stripe yet.
 */
export async function detectConnectionGaps(tenantPhone: string): Promise<ConnectionGap[]> {
  const [connected, verticalLabel] = await Promise.all([
    loadConnectedProviders(tenantPhone),
    loadVerticalLabel(tenantPhone),
  ]);

  const liveSet = new Set(liveProviders().map((p) => p.provider));
  const candidates = verticalLabel
    ? catalogForVertical(verticalLabel)
    : INTEGRATION_CATALOG.filter((i) => !i.hidden);

  const apiBase = process.env.NEXT_PUBLIC_APP_BASE_URL || 'https://wisdomworks.vercel.app';
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');

  const gaps: ConnectionGap[] = [];
  for (const provider of candidates) {
    if (connected.has(provider.provider)) continue;
    if (!liveSet.has(provider.provider)) continue;
    if (provider.authMethod === 'app_password') continue; // never auto-offer keyed flows

    // Each OAuth route signs its own state from the phone — we just pass phone.
    const oneTapUrl = `${apiBase}${provider.oauthPath}?phone=${encodeURIComponent(cleanPhone)}`;
    gaps.push({
      provider,
      oneTapUrl,
      reason: `${provider.tagline} — recommended for ${verticalLabel ?? 'your business'}`,
    });
  }

  // Priority order: payments > booking > calendar > email > social > crm > rest
  const priority = ['payments', 'booking', 'calendar', 'email', 'social', 'crm', 'marketing', 'accounting'];
  gaps.sort((a, b) => {
    const aP = priority.findIndex((c) => a.provider.categories.includes(c as any));
    const bP = priority.findIndex((c) => b.provider.categories.includes(c as any));
    return (aP === -1 ? 99 : aP) - (bP === -1 ? 99 : bP);
  });

  return gaps;
}

/**
 * Tenant sites — multi-tenant website data model.
 *
 * One row per tenant. Renders at /sites/[slug] today; future subdomain
 * routing layered on without schema changes.
 *
 * createTenantSite auto-provisions a widget API key (with chat + booking
 * scopes) and links it via widget_api_key_id so the embedded widgets
 * work the moment the site is live.
 */

import { createApiKey as createWidgetApiKey } from './widget-auth';
import { listClients } from './client-profiles';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

export interface TenantSite {
  id: string;
  tenant_phone: string;
  slug: string;
  status: 'draft' | 'published' | 'archived';
  business_name: string;
  hero_title: string | null;
  hero_subtitle: string | null;
  hero_image_url: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
  hours: Record<string, { open: string; close: string } | null>;
  services: Array<{ name: string; description?: string; durationMinutes?: number; priceUsd?: number; square_id?: string }>;
  theme: { accent?: string; vertical?: string; layout?: string };
  widget_api_key_id: string | null;
  widget_api_key_plain: string | null;
  custom_domain: string | null;
  meta_description: string | null;
  gallery: Array<{ url: string; caption?: string }>;
  testimonials: Array<{ author: string; quote: string }>;
  published_at: string | null;
}

const VERTICAL_DEFAULTS: Record<string, { accent: string; heroTitle: (biz: string) => string; heroSubtitle: string }> = {
  Salon: {
    accent: '#be185d',
    heroTitle: (biz) => `Welcome to ${biz}`,
    heroSubtitle: 'Book your next appointment in 30 seconds.',
  },
  Electrician: {
    accent: '#ca8a04',
    heroTitle: (biz) => `${biz} — Licensed Electricians`,
    heroSubtitle: 'Reliable wiring, repairs, and installations. Free estimates.',
  },
  Restaurant: {
    accent: '#dc2626',
    heroTitle: (biz) => `${biz}`,
    heroSubtitle: 'Reserve your table or order online.',
  },
  'HVAC / Plumbing': {
    accent: '#1d4ed8',
    heroTitle: (biz) => `${biz}`,
    heroSubtitle: 'Same-day service. Licensed and insured.',
  },
  'Cleaning Service': {
    accent: '#0891b2',
    heroTitle: (biz) => `${biz}`,
    heroSubtitle: 'Trusted cleaning, every visit. Book online.',
  },
  'Fitness / Personal Training': {
    accent: '#16a34a',
    heroTitle: (biz) => `${biz}`,
    heroSubtitle: 'Train smarter. Book your session.',
  },
  'Consulting / Coaching': {
    accent: '#0f766e',
    heroTitle: (biz) => `${biz}`,
    heroSubtitle: 'Book a discovery call to see if we\'re a fit.',
  },
  'Legal / Accounting': {
    accent: '#1e3a8a',
    heroTitle: (biz) => `${biz}`,
    heroSubtitle: 'Schedule a consultation with our team.',
  },
  'Photography / Video': {
    accent: '#7c3aed',
    heroTitle: (biz) => `${biz}`,
    heroSubtitle: 'View the portfolio. Book your session.',
  },
  'Real Estate': {
    accent: '#b91c1c',
    heroTitle: (biz) => `${biz}`,
    heroSubtitle: 'Buy. Sell. Find your home.',
  },
};

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'site';
}

/** Allocate a unique slug. Adds -2, -3 etc. if the base is taken. */
async function allocateSlug(base: string): Promise<string> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return base;
  let candidate = base;
  let suffix = 1;
  while (suffix < 100) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_sites?slug=eq.${candidate}&select=id&limit=1`,
      { headers: headers() },
    );
    if (!res.ok) return candidate;
    const rows = await res.json();
    if (rows.length === 0) return candidate;
    suffix++;
    candidate = `${base}-${suffix}`;
  }
  return `${base}-${Date.now()}`;
}

export async function getTenantSiteBySlug(slug: string): Promise<TenantSite | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_sites?slug=eq.${slug}&status=eq.published&select=*&limit=1`,
      { headers: headers() },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function getTenantSiteByTenant(tenantPhone: string): Promise<TenantSite | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_sites?tenant_phone=eq.${cleanPhone}&select=*&limit=1`,
      { headers: headers() },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export interface CreateTenantSiteInput {
  tenantPhone: string;
  businessName: string;
  /** Vertical template label ('Salon', 'Electrician', etc.) used to pick defaults */
  verticalLabel?: string;
  /** Optional pre-filled fields — anything not supplied uses sensible defaults */
  contactEmail?: string;
  contactPhone?: string;
  heroTitle?: string;
  heroSubtitle?: string;
  services?: TenantSite['services'];
  /** Auto-pull services from connected Square account (default true if set) */
  pullSquareServices?: boolean;
}

/** Create + publish a tenant site. Auto-provisions a widget API key for
 *  embedded chat + booking. Returns the site row. */
export async function createTenantSite(input: CreateTenantSiteInput): Promise<TenantSite | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const cleanPhone = input.tenantPhone.replace(/[\s\-+()]/g, '');
  const slugBase = slugify(input.businessName);
  const slug = await allocateSlug(slugBase);

  const defaults = (input.verticalLabel && VERTICAL_DEFAULTS[input.verticalLabel]) || {
    accent: '#0f766e',
    heroTitle: (biz: string) => biz,
    heroSubtitle: 'Welcome — get in touch.',
  };

  // Provision widget API key for booking + chat
  const widgetKey = await createWidgetApiKey({
    tenantPhone: cleanPhone,
    label: `Generated site: ${input.businessName}`,
    scopes: ['chat', 'booking'],
    allowedOrigins: [],
  });

  // Pull services from Square if connected
  let services = input.services ?? [];
  if (services.length === 0) {
    try {
      const { loadActiveBookingConnections } = await import('./booking-adapters/customer-sync');
      const { squareAdapter } = await import('./booking-adapters/square');
      const { decryptToken } = await import('@wisdomworks/shared');
      const conns = await loadActiveBookingConnections(cleanPhone);
      const sq = conns.find((c) => c.provider === 'square');
      if (sq && squareAdapter.listServices) {
        const token = await decryptToken(sq.access_token);
        const sqServices = await squareAdapter.listServices(token, { merchantId: sq.metadata?.merchant_id });
        services = sqServices.slice(0, 12).map((s) => ({
          name: s.name,
          description: s.description,
          durationMinutes: s.durationMinutes,
          priceUsd: s.priceUsd,
          square_id: s.externalId,
        }));
      }
    } catch (err) {
      console.warn('[tenant-sites] square service pull failed:', err);
    }
  }

  const body = {
    tenant_phone: cleanPhone,
    slug,
    status: 'published',
    business_name: input.businessName,
    hero_title: input.heroTitle ?? defaults.heroTitle(input.businessName),
    hero_subtitle: input.heroSubtitle ?? defaults.heroSubtitle,
    contact_email: input.contactEmail ?? null,
    contact_phone: input.contactPhone ?? null,
    services,
    theme: {
      accent: defaults.accent,
      vertical: input.verticalLabel,
      layout: 'standard',
    },
    widget_api_key_id: widgetKey?.id ?? null,
    widget_api_key_plain: widgetKey?.plainKey ?? null,
    meta_description: `${input.businessName} — ${defaults.heroSubtitle}`,
    published_at: new Date().toISOString(),
  };

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/tenant_sites?on_conflict=tenant_phone`, {
      method: 'POST',
      headers: { ...headers(), Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn('[tenant-sites] create failed:', await res.text());
      return null;
    }
    const rows = await res.json();
    return rows[0] ?? null;
  } catch (err) {
    console.warn('[tenant-sites] create exception:', err);
    return null;
  }
}

/** Build the embed <script> tags for a site's chat + booking widgets.
 *  The key is public (appears in rendered HTML); origin allowlist on
 *  widget_api_keys is the actual security boundary. */
export function buildEmbedScriptTag(plainKey: string, apiBase: string): {
  chat: string;
  booking: string;
} {
  return {
    chat: `<script src="${apiBase}/api/widget/embed.js?key=${plainKey}" defer></script>`,
    booking: `<script src="${apiBase}/api/widget/booking.js?key=${plainKey}" defer></script>`,
  };
}

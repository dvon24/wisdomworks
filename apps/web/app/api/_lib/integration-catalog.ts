/**
 * Integration catalog — the single source of truth for which third-party
 * services WisdomWorks can OAuth-connect, what they do, which verticals
 * value them, and which env vars they need to be live.
 *
 * Used by:
 *   - /api/integrations/catalog (dashboard + onboarding picker)
 *   - connection-gap-detector → Iris-as-onboarding-concierge
 *   - vertical templates (cross-reference for recommendedTools)
 */

export type IntegrationCategory =
  | 'email'
  | 'calendar'
  | 'booking'
  | 'payments'
  | 'accounting'
  | 'crm'
  | 'marketing'
  | 'social'
  | 'storage'
  | 'docs'
  | 'messaging'
  | 'analytics'
  | 'automation';

export interface IntegrationDescriptor {
  /** Stable id matching oauth_connections.provider */
  provider: string;
  /** Display name */
  label: string;
  /** Emoji or short visual marker for cards */
  emoji: string;
  /** What this does in one short line */
  tagline: string;
  /** Service value on oauth_connections.service */
  service: IntegrationCategory | string;
  /** Categories used for filtering / matching to vertical needs */
  categories: IntegrationCategory[];
  /** OAuth init path (relative to apps/web base) — '/api/oauth/<provider>' */
  oauthPath: string;
  /** Auth method (drives UX) */
  authMethod: 'oauth' | 'app_password' | 'partner';
  /** Env vars required for this to be live in the environment */
  envVars: string[];
  /** Verticals where this is recommended (matches vertical-templates labels) */
  recommendedFor: string[];
  /** Third-party cost note (per the cost-transparency rule) */
  costNote?: string;
  /** If true, hide from the gap detector but keep in catalog (e.g. coming soon) */
  hidden?: boolean;
}

export const INTEGRATION_CATALOG: IntegrationDescriptor[] = [
  // ─── Email + Calendar ─────────────────────────────────────────────────
  {
    provider: 'google',
    label: 'Google Workspace',
    emoji: '🟦',
    tagline: 'Gmail + Google Calendar in one connection',
    service: 'email',
    categories: ['email', 'calendar', 'storage', 'docs'],
    oauthPath: '/api/oauth/google',
    authMethod: 'oauth',
    envVars: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    recommendedFor: ['Electrician', 'HVAC / Plumbing', 'Restaurant', 'Salon', 'Fitness / Personal Training', 'Cleaning Service', 'Consulting / Coaching', 'Legal / Accounting', 'Photography / Video', 'Real Estate', 'Other Small Business'],
  },
  {
    provider: 'microsoft',
    label: 'Microsoft 365',
    emoji: '🟧',
    tagline: 'Outlook + Office Calendar',
    service: 'email',
    categories: ['email', 'calendar', 'storage', 'docs'],
    oauthPath: '/api/oauth/microsoft',
    authMethod: 'oauth',
    envVars: ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET'],
    recommendedFor: ['Legal / Accounting', 'Consulting / Coaching', 'Real Estate', 'Other Small Business'],
  },
  {
    provider: 'yahoo',
    label: 'Yahoo Mail',
    emoji: '🟣',
    tagline: 'IMAP/SMTP via app password (legacy)',
    service: 'email',
    categories: ['email'],
    oauthPath: '/api/connections/yahoo',
    authMethod: 'app_password',
    envVars: [],
    recommendedFor: [],
  },
  {
    provider: 'apple',
    label: 'Apple iCloud',
    emoji: '⚫',
    tagline: 'CalDAV calendar via app-specific password',
    service: 'calendar',
    categories: ['calendar'],
    oauthPath: '/api/connections/apple',
    authMethod: 'app_password',
    envVars: [],
    recommendedFor: [],
  },

  // ─── Booking ───────────────────────────────────────────────────────────
  {
    provider: 'square',
    label: 'Square Appointments',
    emoji: '🟫',
    tagline: 'Bookings, customers, services, payments',
    service: 'booking',
    categories: ['booking', 'payments'],
    oauthPath: '/api/oauth/square',
    authMethod: 'oauth',
    envVars: ['SQUARE_APP_ID', 'SQUARE_APP_SECRET'],
    recommendedFor: ['Salon', 'Fitness / Personal Training', 'Electrician', 'HVAC / Plumbing', 'Cleaning Service', 'Photography / Video'],
    costNote: 'Square processing fees apply (2.6% + $0.10 per card transaction)',
  },
  {
    provider: 'calendly',
    label: 'Calendly',
    emoji: '🔵',
    tagline: 'Discovery calls + scheduled events',
    service: 'booking',
    categories: ['booking'],
    oauthPath: '/api/oauth/calendly',
    authMethod: 'oauth',
    envVars: ['CALENDLY_CLIENT_ID', 'CALENDLY_CLIENT_SECRET'],
    recommendedFor: ['Consulting / Coaching', 'Photography / Video', 'Real Estate', 'Legal / Accounting'],
  },
  {
    provider: 'mindbody',
    label: 'Mindbody',
    emoji: '🟢',
    tagline: 'Class + appointment management',
    service: 'booking',
    categories: ['booking'],
    oauthPath: '/api/oauth/mindbody',
    authMethod: 'partner',
    envVars: ['MINDBODY_API_KEY'],
    recommendedFor: ['Fitness / Personal Training', 'Salon'],
    costNote: 'Mindbody monthly plan required (varies by tier)',
  },

  // ─── Payments + Accounting ────────────────────────────────────────────
  {
    provider: 'stripe',
    label: 'Stripe',
    emoji: '💳',
    tagline: 'Payments + invoicing + recurring billing',
    service: 'payments',
    categories: ['payments'],
    oauthPath: '/api/oauth/stripe',
    authMethod: 'oauth',
    envVars: ['STRIPE_CLIENT_ID', 'STRIPE_SECRET_KEY'],
    recommendedFor: ['Electrician', 'HVAC / Plumbing', 'Cleaning Service', 'Fitness / Personal Training', 'Consulting / Coaching', 'Photography / Video', 'Salon', 'Other Small Business'],
    costNote: 'Stripe charges 2.9% + $0.30 per transaction',
  },
  {
    provider: 'quickbooks',
    label: 'QuickBooks Online',
    emoji: '📊',
    tagline: 'Accounting + invoicing + reports',
    service: 'accounting',
    categories: ['accounting'],
    oauthPath: '/api/oauth/quickbooks',
    authMethod: 'oauth',
    envVars: ['QUICKBOOKS_CLIENT_ID', 'QUICKBOOKS_CLIENT_SECRET'],
    recommendedFor: ['Legal / Accounting', 'Electrician', 'HVAC / Plumbing', 'Cleaning Service', 'Photography / Video', 'Restaurant', 'Real Estate'],
    costNote: 'QuickBooks Online subscription required ($30+/mo)',
    hidden: true,
  },

  // ─── Marketing + Social ───────────────────────────────────────────────
  {
    provider: 'meta',
    label: 'Meta Business (Instagram + Facebook)',
    emoji: '📸',
    tagline: 'Post content, monitor reviews, capture leads',
    service: 'social',
    categories: ['social', 'marketing'],
    oauthPath: '/api/oauth/meta',
    authMethod: 'oauth',
    envVars: ['META_APP_ID', 'META_APP_SECRET'],
    recommendedFor: ['Salon', 'Restaurant', 'Photography / Video', 'Fitness / Personal Training', 'Real Estate'],
    hidden: true,
  },
  {
    provider: 'mailchimp',
    label: 'Mailchimp',
    emoji: '📧',
    tagline: 'Email marketing + segmentation',
    service: 'marketing',
    categories: ['marketing', 'email'],
    oauthPath: '/api/oauth/mailchimp',
    authMethod: 'oauth',
    envVars: ['MAILCHIMP_CLIENT_ID', 'MAILCHIMP_CLIENT_SECRET'],
    recommendedFor: ['Salon', 'Fitness / Personal Training', 'Restaurant', 'Photography / Video'],
    costNote: 'Mailchimp free up to 500 contacts, paid plans from $13/mo',
    hidden: true,
  },

  // ─── CRM ──────────────────────────────────────────────────────────────
  {
    provider: 'hubspot',
    label: 'HubSpot',
    emoji: '🟠',
    tagline: 'Contacts + deals + sequences',
    service: 'crm',
    categories: ['crm', 'marketing'],
    oauthPath: '/api/oauth/hubspot',
    authMethod: 'oauth',
    envVars: ['HUBSPOT_CLIENT_ID', 'HUBSPOT_CLIENT_SECRET'],
    recommendedFor: ['Consulting / Coaching', 'Real Estate'],
    costNote: 'HubSpot free CRM available; paid features from $20/mo',
    hidden: true,
  },
];

/** Filter the catalog for a given vertical's recommended providers. */
export function catalogForVertical(verticalLabel: string): IntegrationDescriptor[] {
  return INTEGRATION_CATALOG.filter((i) => !i.hidden && i.recommendedFor.includes(verticalLabel));
}

/** Returns providers that are LIVE in this environment (env vars set). */
export function liveProviders(): IntegrationDescriptor[] {
  return INTEGRATION_CATALOG.filter((i) => {
    if (i.hidden) return false;
    if (i.envVars.length === 0) return true; // app-password providers are always usable
    return i.envVars.every((v) => !!process.env[v]);
  });
}

export function getProvider(providerId: string): IntegrationDescriptor | undefined {
  return INTEGRATION_CATALOG.find((i) => i.provider === providerId);
}

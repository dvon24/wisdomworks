/**
 * Vertical Templates — pre-tuned bundles for specific industries.
 *
 * Layered ON TOP of the deployment spec, not in place of it. Where the
 * industry-templates define the broad agent roster, vertical templates
 * supply the small, specific things that make agents useful from minute
 * one:
 *   - Connected-tool suggestions tuned to the trade
 *   - Sample workflows seeded as knowledge atoms
 *   - Common goals + constraints
 *   - Lane-specific operating-protocol hints
 *
 * Three verticals shipped first (May 2026), chosen to differentiate
 * against Viktor (Slack-only) by targeting trades and service businesses
 * that live on WhatsApp:
 *   - electrician
 *   - restaurant
 *   - salon
 */

export interface VerticalTemplate {
  /** Canonical business-type IDs this template applies to */
  matches: string[];
  /** Short label shown in the deck */
  label: string;
  /** Tools we recommend the owner connect (rendered as suggestion chips) */
  recommendedTools: { id: string; label: string; why: string }[];
  /** Sample workflows seeded as knowledge atoms (kind=goal) */
  sampleWorkflows: { content: string; tags: string[] }[];
  /** Common constraints seeded as knowledge atoms (kind=constraint) */
  commonConstraints: { content: string; tags: string[] }[];
  /** Common goals seeded as knowledge atoms (kind=goal) */
  commonGoals: { content: string; tags: string[] }[];
  /** Per-lane operating-protocol hints — guides escalation thresholds */
  laneHints: Record<string, string>;
}

/** Electrician / electrical-contractor template */
export const ELECTRICIAN_TEMPLATE: VerticalTemplate = {
  matches: ['electrician', 'electrical_contractor', 'electrical'],
  label: 'Electrician',
  recommendedTools: [
    { id: 'google_calendar', label: 'Google Calendar', why: 'Jobs and dispatch' },
    { id: 'google_maps', label: 'Google Maps', why: 'Route between jobs' },
    { id: 'stripe', label: 'Stripe', why: 'On-site invoicing and payments' },
    { id: 'google_reviews', label: 'Google Business Profile', why: 'Review monitoring after each job' },
    { id: 'quickbooks', label: 'QuickBooks', why: 'Job costing and bookkeeping' },
  ],
  sampleWorkflows: [
    {
      content: 'New service call → confirm with customer, add to calendar, send arrival window 30 min before',
      tags: ['workflow', 'dispatch', 'electrician'],
    },
    {
      content: 'Job completion → photo of work, generate invoice via Stripe, request Google review',
      tags: ['workflow', 'billing', 'electrician'],
    },
    {
      content: 'Permit inspection scheduled → block calendar, add prep checklist 1 day before',
      tags: ['workflow', 'compliance', 'electrician'],
    },
  ],
  commonConstraints: [
    {
      content: 'Licensed work — code compliance is non-negotiable; never auto-respond to permit/inspection emails without owner review',
      tags: ['compliance', 'electrician', 'general'],
    },
    {
      content: 'On-call rotation — emergency calls outside business hours must reach the owner directly',
      tags: ['communication', 'electrician', 'general'],
    },
  ],
  commonGoals: [
    {
      content: 'Maximize billable hours: minimize gaps between jobs, route efficiently, keep dispatch tight',
      tags: ['business_goal', 'electrician', 'general'],
    },
    {
      content: 'Build reputation through Google reviews after every completed job',
      tags: ['business_goal', 'electrician', 'marketing'],
    },
  ],
  laneHints: {
    scheduler: 'Optimize routing between jobs; flag conflicts that cost drive-time',
    customer_service: 'Send arrival window 30 min before each appointment; follow up for reviews after completion',
    marketing: 'Focus on Google reviews and local SEO; avoid generic social-media broadcasting',
    finance: 'Job-level cost tracking; flag jobs running over estimated hours',
  },
};

/** Restaurant / cafe template */
export const RESTAURANT_TEMPLATE: VerticalTemplate = {
  matches: ['restaurant', 'cafe', 'bistro', 'food_service', 'eatery'],
  label: 'Restaurant',
  recommendedTools: [
    { id: 'opentable', label: 'OpenTable / Resy', why: 'Reservations and waitlist' },
    { id: 'square', label: 'Square / Toast', why: 'POS, gift cards, hours' },
    { id: 'google_reviews', label: 'Google Business Profile', why: 'Review responses' },
    { id: 'instagram', label: 'Instagram', why: 'Daily specials and menu posts' },
    { id: 'doordash', label: 'DoorDash / UberEats', why: 'Delivery order monitoring' },
  ],
  sampleWorkflows: [
    {
      content: 'New reservation → confirm, send pre-arrival reminder with parking/dietary info collection',
      tags: ['workflow', 'reservations', 'restaurant'],
    },
    {
      content: 'Negative Google/Yelp review → flag to owner immediately; draft apology + win-back offer',
      tags: ['workflow', 'reputation', 'restaurant'],
    },
    {
      content: 'Daily special → owner photo + caption → post to Instagram/Facebook before 11am',
      tags: ['workflow', 'marketing', 'restaurant'],
    },
    {
      content: 'Slow night detected → owner-approved discount push to repeat customers within 5mi',
      tags: ['workflow', 'marketing', 'restaurant'],
    },
  ],
  commonConstraints: [
    {
      content: 'Food allergies — never invent ingredients; always defer to kitchen for allergy questions',
      tags: ['compliance', 'restaurant', 'general'],
    },
    {
      content: 'Reservation policies — never confirm bookings the system says are full; owner must approve overrides',
      tags: ['policy', 'restaurant', 'general'],
    },
  ],
  commonGoals: [
    {
      content: 'Fill seats: optimize reservation conversion, reduce no-shows, drive repeat visits',
      tags: ['business_goal', 'restaurant', 'general'],
    },
    {
      content: 'Maintain 4.5+ star rating across Google, Yelp, OpenTable',
      tags: ['business_goal', 'restaurant', 'reputation'],
    },
  ],
  laneHints: {
    scheduler: 'Reservation system is source of truth; coordinate with kitchen capacity',
    customer_service: 'Respond to reviews within 24h; acknowledge every negative review personally',
    marketing: 'Photo-driven content (daily specials, dishes); local-area targeting only',
    finance: 'Track average ticket size, table turnover, food cost ratio',
  },
};

/** Salon / spa / barbershop template */
export const SALON_TEMPLATE: VerticalTemplate = {
  matches: ['salon', 'hair_salon', 'beauty_salon', 'barbershop', 'barber', 'spa', 'nail_salon', 'cosmetician'],
  label: 'Salon',
  recommendedTools: [
    { id: 'square_appointments', label: 'Square Appointments / Booksy', why: 'Bookings and stylist schedules' },
    { id: 'instagram', label: 'Instagram', why: 'Before/after content and bookings' },
    { id: 'google_reviews', label: 'Google Business Profile', why: 'Review monitoring' },
    { id: 'stripe', label: 'Stripe', why: 'Deposits and no-show policy enforcement' },
    { id: 'mailchimp', label: 'Email/SMS marketing', why: 'Re-booking reminders' },
  ],
  sampleWorkflows: [
    {
      content: 'New booking → confirm, send 24h reminder, deposit request for first-time clients',
      tags: ['workflow', 'bookings', 'salon'],
    },
    {
      content: 'Client hasn\'t booked in 8 weeks → auto-send "we miss you" rebook invite',
      tags: ['workflow', 'retention', 'salon'],
    },
    {
      content: 'After-service follow-up → request Instagram tag of result + Google review',
      tags: ['workflow', 'marketing', 'salon'],
    },
    {
      content: 'No-show / last-minute cancel → enforce deposit policy, offer same-day rebook',
      tags: ['workflow', 'policy', 'salon'],
    },
  ],
  commonConstraints: [
    {
      content: 'Stylist-specific bookings — never reassign clients to a different stylist without explicit owner approval',
      tags: ['policy', 'salon', 'general'],
    },
    {
      content: 'Allergy/sensitivity intake — first-time chemical services require completed patch test on file',
      tags: ['compliance', 'salon', 'general'],
    },
  ],
  commonGoals: [
    {
      content: 'Maximize chair utilization across all stylists; reduce no-shows and gaps',
      tags: ['business_goal', 'salon', 'general'],
    },
    {
      content: 'Drive Instagram-led bookings through before/after content; tag clients with consent',
      tags: ['business_goal', 'salon', 'marketing'],
    },
  ],
  laneHints: {
    scheduler: 'Per-stylist schedules; enforce deposit policy on first-time clients',
    customer_service: 'Personalized follow-up; remember preferred stylist and product allergies',
    marketing: 'Instagram-first; before/after content; encourage client tagging',
    finance: 'Track per-stylist revenue, retail attach rate, deposit recovery',
  },
};

export const VERTICAL_TEMPLATES: VerticalTemplate[] = [
  ELECTRICIAN_TEMPLATE,
  RESTAURANT_TEMPLATE,
  SALON_TEMPLATE,
];

/** Find a vertical template for a given business type. Case-insensitive. */
export function findVerticalTemplate(businessType: string | undefined): VerticalTemplate | null {
  if (!businessType) return null;
  const normalized = businessType.toLowerCase().replace(/[^a-z]/g, '_');
  for (const t of VERTICAL_TEMPLATES) {
    for (const m of t.matches) {
      if (normalized === m || normalized.includes(m) || m.includes(normalized)) return t;
    }
  }
  return null;
}

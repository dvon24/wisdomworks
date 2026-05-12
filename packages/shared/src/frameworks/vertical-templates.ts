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

export interface VerticalAgent {
  /** Canonical role name used downstream in agent_configs */
  role: string;
  /** Display name shown to owner ("Dispatcher", "Reviews & Reputation") */
  name: string;
  /** Tier hint — drives model routing in pricing-calculator */
  tier: 'Haiku' | 'Sonnet' | 'Opus';
  /** One-line description shown in the team-preview UI */
  description: string;
  /** Whether this agent is essential for the vertical (vs. optional add-on) */
  required: boolean;
  /** Lane this agent occupies — drives the categorization in agent-runtime */
  lane: 'orchestrator' | 'scheduler' | 'customer_service' | 'marketing' | 'finance' | 'operations' | 'analytics' | 'specialist';
  /** Output channels this agent uses */
  channels: string[];
}

export interface VerticalTemplate {
  /** Canonical business-type IDs this template applies to */
  matches: string[];
  /** Short label shown in the deck and onboarding picker */
  label: string;
  /** One-line marketing hook for the onboarding picker card */
  tagline: string;
  /** Emoji glyph for the picker card */
  emoji: string;
  /** Pre-built agent team tuned for this vertical. Owner can customize
   *  during onboarding (add/remove/rename) but this is the starting set. */
  defaultAgents: VerticalAgent[];
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
  /** Suggestion pills shown in onboarding chat as the first conversational
   *  warmup. Pre-templated so the user can skip free-form typing. */
  onboardingPills: string[];
}

/** The orchestrator is always Iris — same name across verticals so the
 *  WhatsApp brand stays consistent. Other agents are vertical-specific. */
const IRIS_ORCHESTRATOR: VerticalAgent = {
  role: 'orchestrator',
  name: 'Iris',
  tier: 'Sonnet',
  description: 'Your assistant — talks to you on WhatsApp, coordinates the team',
  required: true,
  lane: 'orchestrator',
  channels: ['whatsapp', 'telegram', 'email'],
};

/** Electrician / electrical-contractor template */
export const ELECTRICIAN_TEMPLATE: VerticalTemplate = {
  matches: ['electrician', 'electrical_contractor', 'electrical'],
  label: 'Electrician',
  tagline: 'Dispatch, jobs, reviews — runs from your phone between calls',
  emoji: '⚡',
  onboardingPills: [
    'Solo electrician, residential work',
    'Electrical contractor, 5-person crew',
    'Commercial electrician, mostly retrofits',
    'New build wiring + service calls',
  ],
  defaultAgents: [
    IRIS_ORCHESTRATOR,
    { role: 'dispatcher', name: 'Dispatcher', tier: 'Sonnet', required: true, lane: 'scheduler',
      description: 'Books jobs, routes between calls, sends ETA windows', channels: ['whatsapp', 'sms', 'calendar'] },
    { role: 'invoicer', name: 'Invoice & Payments', tier: 'Haiku', required: true, lane: 'finance',
      description: 'Generates invoices after each job, chases unpaid balances', channels: ['email', 'sms'] },
    { role: 'reviews', name: 'Reviews & Reputation', tier: 'Haiku', required: true, lane: 'marketing',
      description: 'Requests Google reviews after completed jobs, drafts responses', channels: ['email', 'sms'] },
    { role: 'permits', name: 'Permits & Compliance', tier: 'Sonnet', required: false, lane: 'operations',
      description: 'Tracks permit deadlines, inspection prep, code-compliance flags', channels: ['email', 'dashboard'] },
  ],
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
  tagline: 'Reservations, specials, reviews — never miss a booking again',
  emoji: '🍽️',
  onboardingPills: [
    'Family restaurant, dinner-only',
    'Cafe with breakfast + lunch',
    'Bistro, 40 seats, weekend brunch',
    'Restaurant + delivery via DoorDash',
  ],
  defaultAgents: [
    IRIS_ORCHESTRATOR,
    { role: 'reservations', name: 'Reservations', tier: 'Sonnet', required: true, lane: 'scheduler',
      description: 'Confirms bookings, sends reminders, manages waitlist', channels: ['whatsapp', 'sms', 'email'] },
    { role: 'reviews', name: 'Reviews & Reputation', tier: 'Sonnet', required: true, lane: 'marketing',
      description: 'Monitors Google/Yelp reviews, drafts responses to negatives within 24h', channels: ['email', 'dashboard'] },
    { role: 'specials_social', name: 'Specials & Social', tier: 'Sonnet', required: true, lane: 'marketing',
      description: 'Posts daily specials to IG/FB before 11am, runs slow-night promotions', channels: ['instagram', 'facebook'] },
    { role: 'allergies', name: 'Allergies & Dietary', tier: 'Sonnet', required: false, lane: 'customer_service',
      description: 'Captures dietary needs from reservations, escalates to kitchen', channels: ['email', 'whatsapp'] },
  ],
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
  tagline: 'Bookings, no-shows, rebookings — auto-managed across stylists',
  emoji: '💇',
  onboardingPills: [
    'Solo stylist, 1 chair',
    'Hair salon, 3 stylists',
    'Barbershop with 5 chairs',
    'Nail salon + lash extensions',
  ],
  defaultAgents: [
    IRIS_ORCHESTRATOR,
    { role: 'bookings', name: 'Bookings & Reminders', tier: 'Sonnet', required: true, lane: 'scheduler',
      description: 'Per-stylist scheduling, 24h reminders, deposit enforcement for first-timers', channels: ['whatsapp', 'sms'] },
    { role: 'rebookings', name: 'Rebooking & Retention', tier: 'Sonnet', required: true, lane: 'customer_service',
      description: 'Auto "we miss you" at 8 weeks, lapsed-client detection', channels: ['whatsapp', 'sms', 'email'] },
    { role: 'reviews_social', name: 'Reviews & Social', tier: 'Sonnet', required: true, lane: 'marketing',
      description: 'IG-driven content (with client consent), Google review responses', channels: ['instagram', 'google_reviews'] },
    { role: 'no_show_recovery', name: 'No-Show Recovery', tier: 'Haiku', required: false, lane: 'operations',
      description: 'Same-day rebook offers when slots open from cancels', channels: ['whatsapp', 'sms'] },
  ],
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

/** HVAC / plumbing / handyman — extends the electrician pattern for other trades */
export const HVAC_PLUMBING_TEMPLATE: VerticalTemplate = {
  matches: ['hvac', 'plumber', 'plumbing', 'handyman', 'hvac_tech', 'mechanical_contractor'],
  label: 'HVAC / Plumbing',
  tagline: 'Dispatch, on-call rotation, photo invoicing from the truck',
  emoji: '🔧',
  onboardingPills: [
    'Solo plumber, residential service calls',
    'HVAC company, 4 trucks',
    'Handyman, mix of small jobs',
    'Plumbing + drain cleaning, on-call',
  ],
  defaultAgents: [
    IRIS_ORCHESTRATOR,
    { role: 'dispatcher', name: 'Dispatcher', tier: 'Sonnet', required: true, lane: 'scheduler',
      description: 'Routes jobs, sends ETA windows, handles emergency calls', channels: ['whatsapp', 'sms', 'calendar'] },
    { role: 'invoicer', name: 'Invoice & Payments', tier: 'Haiku', required: true, lane: 'finance',
      description: 'Generates job invoices, tracks unpaid balances', channels: ['email', 'sms'] },
    { role: 'reviews', name: 'Reviews & Reputation', tier: 'Haiku', required: true, lane: 'marketing',
      description: 'Post-job review requests and response drafting', channels: ['email', 'sms'] },
    { role: 'on_call', name: 'After-Hours Triage', tier: 'Sonnet', required: false, lane: 'customer_service',
      description: 'Routes emergency calls outside business hours, escalates urgent ones', channels: ['whatsapp', 'sms'] },
  ],
  recommendedTools: [
    { id: 'google_calendar', label: 'Google Calendar', why: 'Job dispatch and scheduling' },
    { id: 'google_maps', label: 'Google Maps', why: 'Route between calls' },
    { id: 'stripe', label: 'Stripe', why: 'On-site card payments' },
    { id: 'google_reviews', label: 'Google Business Profile', why: 'Post-job review requests' },
    { id: 'quickbooks', label: 'QuickBooks', why: 'Job costing and bookkeeping' },
  ],
  sampleWorkflows: [
    { content: 'New service call → confirm with customer, ETA window 30 min before arrival', tags: ['workflow', 'dispatch', 'trades'] },
    { content: 'Emergency after-hours call → priority alert, dispatch nearest tech', tags: ['workflow', 'emergency', 'trades'] },
    { content: 'Job complete → photo of work, invoice via Stripe, review request', tags: ['workflow', 'billing', 'trades'] },
  ],
  commonConstraints: [
    { content: 'Licensed work — permit and code compliance matters; never auto-respond to inspection emails without owner review', tags: ['compliance', 'trades', 'general'] },
    { content: 'On-call rotation — emergency calls must reach the on-call tech directly', tags: ['communication', 'trades', 'general'] },
  ],
  commonGoals: [
    { content: 'Tighten dispatch — minimize drive time between jobs, group by area', tags: ['business_goal', 'trades', 'general'] },
    { content: 'Maximize Google reviews — request after every completed job', tags: ['business_goal', 'trades', 'marketing'] },
  ],
  laneHints: {
    scheduler: 'Route-optimize between jobs; respect emergency-priority rules',
    customer_service: 'ETA windows + arrival texts; post-job review follow-up',
    marketing: 'Google reviews + local SEO; skip generic social',
    finance: 'Job-level cost tracking; flag overruns',
  },
};

/** Cleaning service template */
export const CLEANING_TEMPLATE: VerticalTemplate = {
  matches: ['cleaning', 'cleaning_service', 'house_cleaning', 'commercial_cleaning', 'janitorial', 'maid_service'],
  label: 'Cleaning Service',
  tagline: 'Recurring clients, route planning, easy rebooking',
  emoji: '🧹',
  onboardingPills: [
    'Solo house cleaner',
    'Cleaning company, 3 teams',
    'Commercial cleaning, after-hours',
    'Airbnb turnover specialist',
  ],
  defaultAgents: [
    IRIS_ORCHESTRATOR,
    { role: 'recurring_scheduler', name: 'Recurring Scheduler', tier: 'Sonnet', required: true, lane: 'scheduler',
      description: 'Manages weekly/biweekly client schedules and reminders', channels: ['whatsapp', 'sms', 'calendar'] },
    { role: 'auto_billing', name: 'Auto-Billing', tier: 'Haiku', required: true, lane: 'finance',
      description: 'Charges on completion, flags failed payments', channels: ['email'] },
    { role: 'route_optimizer', name: 'Route Optimizer', tier: 'Haiku', required: false, lane: 'operations',
      description: 'Groups jobs by area, minimizes drive time', channels: ['dashboard'] },
  ],
  recommendedTools: [
    { id: 'google_calendar', label: 'Google Calendar', why: 'Recurring job schedules' },
    { id: 'stripe', label: 'Stripe', why: 'Auto-billing for recurring clients' },
    { id: 'google_reviews', label: 'Google Business Profile', why: 'Reviews + lead capture' },
    { id: 'instagram', label: 'Instagram', why: 'Before/after content' },
  ],
  sampleWorkflows: [
    { content: 'Recurring weekly client → auto-confirm 24h before, charge on completion', tags: ['workflow', 'recurring', 'cleaning'] },
    { content: 'Airbnb turnover → guest checkout alert → dispatch + photo confirmation', tags: ['workflow', 'turnover', 'cleaning'] },
    { content: 'New client first job → walkthrough notes captured for future visits', tags: ['workflow', 'onboarding', 'cleaning'] },
  ],
  commonConstraints: [
    { content: 'Trust matters — always document any damage or unusual situation with photos', tags: ['policy', 'cleaning', 'general'] },
  ],
  commonGoals: [
    { content: 'Build recurring base — convert one-time jobs into weekly/biweekly contracts', tags: ['business_goal', 'cleaning', 'general'] },
  ],
  laneHints: {
    scheduler: 'Recurring patterns; group geographic clusters',
    customer_service: 'Reminders 24h before; capture preferences per home',
    marketing: 'Visual content (before/after); referral-driven',
    finance: 'Auto-billing on completion; minimize manual invoicing',
  },
};

/** Personal trainer / fitness studio */
export const FITNESS_TEMPLATE: VerticalTemplate = {
  matches: ['personal_trainer', 'fitness', 'gym', 'yoga', 'pilates', 'fitness_studio', 'crossfit'],
  label: 'Fitness / Personal Training',
  tagline: 'Class bookings, member retention, recurring billing',
  emoji: '💪',
  onboardingPills: [
    'Solo personal trainer, in-home + gym',
    'Yoga studio, 3 daily classes',
    'CrossFit box, group + 1:1',
    'Online coach + in-person',
  ],
  defaultAgents: [
    IRIS_ORCHESTRATOR,
    { role: 'class_bookings', name: 'Class Bookings', tier: 'Sonnet', required: true, lane: 'scheduler',
      description: 'Manages class signups, waitlists, cancel-then-rebook', channels: ['whatsapp', 'sms'] },
    { role: 'member_retention', name: 'Member Retention', tier: 'Sonnet', required: true, lane: 'customer_service',
      description: 'Catches members skipping for 2+ weeks, sends reset offers', channels: ['whatsapp', 'email'] },
    { role: 'billing', name: 'Membership Billing', tier: 'Haiku', required: true, lane: 'finance',
      description: 'Recurring charges, failed-payment recovery', channels: ['email'] },
    { role: 'content_social', name: 'Content & Social', tier: 'Sonnet', required: false, lane: 'marketing',
      description: 'Member transformations, schedule promotion', channels: ['instagram'] },
  ],
  recommendedTools: [
    { id: 'square_appointments', label: 'Square / Mindbody', why: 'Class + 1:1 bookings' },
    { id: 'stripe', label: 'Stripe', why: 'Recurring memberships' },
    { id: 'instagram', label: 'Instagram', why: 'Workout content + transformations' },
    { id: 'google_reviews', label: 'Google Business Profile', why: 'Local discovery' },
  ],
  sampleWorkflows: [
    { content: 'New member intake → goals + injury notes captured, recurring billing set up', tags: ['workflow', 'onboarding', 'fitness'] },
    { content: 'Member missed 2 weeks → check-in message, offer schedule reset', tags: ['workflow', 'retention', 'fitness'] },
    { content: 'Class fully booked → waitlist + auto-notify on cancel', tags: ['workflow', 'bookings', 'fitness'] },
  ],
  commonConstraints: [
    { content: 'Track injuries and physical limitations per client — never override owner judgment on programming', tags: ['safety', 'fitness', 'general'] },
  ],
  commonGoals: [
    { content: 'Reduce churn — catch members who are skipping before they cancel', tags: ['business_goal', 'fitness', 'retention'] },
    { content: 'Fill class waitlists fast — convert cancellations into bookings', tags: ['business_goal', 'fitness', 'bookings'] },
  ],
  laneHints: {
    scheduler: 'Class capacity + waitlist mgmt; respect 1:1 vs group split',
    customer_service: 'Check-ins for at-risk members; intake for new members',
    marketing: 'Member transformations + social proof; refer-a-friend',
    finance: 'Recurring membership billing; flag failed payments fast',
  },
};

/** Consulting / coaching / freelance professional */
export const CONSULTING_TEMPLATE: VerticalTemplate = {
  matches: ['consultant', 'consulting', 'coach', 'coaching', 'freelancer', 'advisor', 'agency'],
  label: 'Consulting / Coaching',
  tagline: 'Discovery calls, proposals, project management — solo-scale',
  emoji: '🎯',
  onboardingPills: [
    'Solo consultant, B2B advisory',
    'Executive coach, weekly clients',
    'Marketing agency, 3 retainer clients',
    'Freelance designer + project mix',
  ],
  defaultAgents: [
    IRIS_ORCHESTRATOR,
    { role: 'discovery_funnel', name: 'Discovery & Proposals', tier: 'Sonnet', required: true, lane: 'customer_service',
      description: 'Routes new leads → discovery → proposal draft', channels: ['email', 'calendar'] },
    { role: 'client_notes', name: 'Client Notes & Follow-up', tier: 'Sonnet', required: true, lane: 'operations',
      description: 'Captures meeting notes, drafts follow-up summaries with next steps', channels: ['email', 'dashboard'] },
    { role: 'retainer_ops', name: 'Retainer Ops', tier: 'Haiku', required: false, lane: 'finance',
      description: 'Monthly invoicing, scope-creep flags, status reports', channels: ['email'] },
    { role: 'content_distribution', name: 'Content & LinkedIn', tier: 'Sonnet', required: false, lane: 'marketing',
      description: 'Distributes thought leadership content; tracks lead source', channels: ['linkedin'] },
  ],
  recommendedTools: [
    { id: 'google_calendar', label: 'Google Calendar', why: 'Discovery + ongoing calls' },
    { id: 'calendly', label: 'Calendly / Cal.com', why: 'Self-serve discovery booking' },
    { id: 'stripe', label: 'Stripe', why: 'Invoicing + recurring retainers' },
    { id: 'linkedin', label: 'LinkedIn', why: 'Lead source + content distribution' },
    { id: 'notion', label: 'Notion / Docs', why: 'Client deliverables and notes' },
  ],
  sampleWorkflows: [
    { content: 'New lead → discovery call → proposal draft → contract', tags: ['workflow', 'sales', 'consulting'] },
    { content: 'Client meeting → notes capture → follow-up summary + next steps', tags: ['workflow', 'delivery', 'consulting'] },
    { content: 'Retainer client monthly → invoice + scope check + status report', tags: ['workflow', 'recurring', 'consulting'] },
  ],
  commonConstraints: [
    { content: 'Confidentiality — client info is privileged; never share across clients or make public', tags: ['compliance', 'consulting', 'general'] },
  ],
  commonGoals: [
    { content: 'Convert more discoveries to clients — follow up promptly with tailored proposals', tags: ['business_goal', 'consulting', 'sales'] },
    { content: 'Build recurring revenue via retainers over one-shot projects', tags: ['business_goal', 'consulting', 'revenue'] },
  ],
  laneHints: {
    scheduler: 'Discovery vs delivery time-blocking; protect focus time',
    customer_service: 'Per-client conversation history; follow-up after every meeting',
    marketing: 'LinkedIn-first; thought leadership over generic posts',
    finance: 'Track utilization, retainer renewals, scope-creep flags',
  },
};

/** Legal / accounting / professional services */
export const PROFESSIONAL_SERVICES_VERTICAL: VerticalTemplate = {
  matches: ['attorney', 'lawyer', 'accountant', 'cpa', 'bookkeeper', 'tax_preparer', 'law_firm', 'accounting_firm'],
  label: 'Legal / Accounting',
  tagline: 'Intake, scheduling, deadline tracking — compliance-aware',
  emoji: '⚖️',
  onboardingPills: [
    'Solo attorney, family law',
    'Small CPA firm, tax + bookkeeping',
    'Estate planning attorney',
    'Solo bookkeeper, small business clients',
  ],
  defaultAgents: [
    IRIS_ORCHESTRATOR,
    { role: 'intake', name: 'Intake & Conflict Check', tier: 'Sonnet', required: true, lane: 'customer_service',
      description: 'Routes new inquiries through conflict check + consultation booking', channels: ['email', 'calendar'] },
    { role: 'deadlines', name: 'Deadline Watchdog', tier: 'Sonnet', required: true, lane: 'operations',
      description: 'Tracks court dates, IRS deadlines, filing prep — 1wk + 1d reminders', channels: ['email', 'whatsapp', 'sms'] },
    { role: 'billing', name: 'Time & Billing', tier: 'Haiku', required: true, lane: 'finance',
      description: 'Time logs → invoice line items, unbilled-time weekly flags', channels: ['email', 'dashboard'] },
    { role: 'client_comms', name: 'Client Communications', tier: 'Sonnet', required: false, lane: 'customer_service',
      description: 'Privileged comms, formal tone, documented every step', channels: ['email'] },
  ],
  recommendedTools: [
    { id: 'google_calendar', label: 'Google Calendar', why: 'Court dates + client meetings' },
    { id: 'clio_quickbooks', label: 'Clio / QuickBooks', why: 'Time tracking + billing' },
    { id: 'docusign', label: 'DocuSign', why: 'Engagement letters + e-signature' },
    { id: 'email', label: 'Email + secure inbox', why: 'Privileged client comms' },
  ],
  sampleWorkflows: [
    { content: 'New inquiry → conflict check → intake form → consultation booking', tags: ['workflow', 'intake', 'professional'] },
    { content: 'Court date / filing deadline → reminder 1 week + 1 day before', tags: ['workflow', 'compliance', 'professional'] },
    { content: 'Client meeting → time log → invoice line item', tags: ['workflow', 'billing', 'professional'] },
  ],
  commonConstraints: [
    { content: 'Attorney-client / accountant privilege — never share specifics outside the case; default to redaction', tags: ['compliance', 'professional', 'general'] },
    { content: 'Never miss a filing deadline — these need owner-level oversight, not autonomous action', tags: ['compliance', 'professional', 'general'] },
    { content: 'Engagement letter required before substantive work — flag pre-engagement requests', tags: ['policy', 'professional', 'general'] },
  ],
  commonGoals: [
    { content: 'Tighten intake → consultation funnel; reduce lead drop-off', tags: ['business_goal', 'professional', 'sales'] },
    { content: 'Maximize billable utilization without sacrificing quality', tags: ['business_goal', 'professional', 'revenue'] },
  ],
  laneHints: {
    scheduler: 'Court/IRS deadlines override everything; protect prep time',
    customer_service: 'Formal tone; documented every-step',
    marketing: 'Referral-driven; thought leadership in domain area',
    finance: 'Time tracking is sacred; flag unbilled time weekly',
  },
};

/** Photography / videography */
export const PHOTOGRAPHY_TEMPLATE: VerticalTemplate = {
  matches: ['photographer', 'photography', 'videographer', 'photography_studio', 'wedding_photographer'],
  label: 'Photography / Video',
  tagline: 'Bookings, deposits, gallery delivery — event timeline aware',
  emoji: '📸',
  onboardingPills: [
    'Wedding photographer, 30-40 weddings/yr',
    'Family + newborn photographer',
    'Solo videographer, brand + event',
    'Real estate photographer',
  ],
  defaultAgents: [
    IRIS_ORCHESTRATOR,
    { role: 'bookings', name: 'Bookings & Deposits', tier: 'Sonnet', required: true, lane: 'scheduler',
      description: 'Contract + 30% deposit flow, calendar locks', channels: ['email', 'calendar'] },
    { role: 'shoot_day', name: 'Shoot Day Coordinator', tier: 'Sonnet', required: true, lane: 'operations',
      description: 'Timeline reminders, gear checklists, location pins', channels: ['whatsapp', 'sms'] },
    { role: 'delivery', name: 'Delivery & Gallery', tier: 'Sonnet', required: true, lane: 'customer_service',
      description: 'Preview within 48h, full gallery in 4 weeks, review request after delivery', channels: ['email'] },
    { role: 'portfolio', name: 'Portfolio & Inquiries', tier: 'Sonnet', required: false, lane: 'marketing',
      description: 'Same-day inquiry replies, IG portfolio cadence', channels: ['instagram', 'email'] },
  ],
  recommendedTools: [
    { id: 'square_appointments', label: 'Square / Pixieset', why: 'Bookings + gallery delivery' },
    { id: 'stripe', label: 'Stripe', why: 'Deposits + final payments' },
    { id: 'instagram', label: 'Instagram', why: 'Portfolio + lead generation' },
    { id: 'google_drive', label: 'Google Drive', why: 'Raw + edit delivery' },
  ],
  sampleWorkflows: [
    { content: 'New booking → contract + 30% deposit → calendar lock', tags: ['workflow', 'bookings', 'photography'] },
    { content: 'Shoot day → timeline reminder, gear checklist, location pin', tags: ['workflow', 'event', 'photography'] },
    { content: 'Post-shoot → preview within 48h, full gallery in 4 weeks, review request after delivery', tags: ['workflow', 'delivery', 'photography'] },
  ],
  commonConstraints: [
    { content: 'Image rights and model releases — never publish client photos without explicit consent', tags: ['compliance', 'photography', 'general'] },
  ],
  commonGoals: [
    { content: 'Convert inquiries faster — same-day reply to leads', tags: ['business_goal', 'photography', 'sales'] },
    { content: 'Drive Instagram-led bookings via consistent portfolio posting', tags: ['business_goal', 'photography', 'marketing'] },
  ],
  laneHints: {
    scheduler: 'Multi-hour blocks; account for travel + setup time',
    customer_service: 'Quick reply to inquiries; warm follow-up post-delivery',
    marketing: 'Portfolio-first content; story-mode behind-the-scenes',
    finance: 'Deposits + balance due tracking; package upsells',
  },
};

/** Real estate agent / broker */
export const REAL_ESTATE_TEMPLATE: VerticalTemplate = {
  matches: ['real_estate', 'realtor', 'real_estate_agent', 'broker', 'property_manager'],
  label: 'Real Estate',
  tagline: 'Lead capture, showings, follow-up — every lead worked',
  emoji: '🏠',
  onboardingPills: [
    'Solo realtor, residential',
    'Real estate team, 4 agents',
    'Property manager, 15 doors',
    'Commercial broker',
  ],
  defaultAgents: [
    IRIS_ORCHESTRATOR,
    { role: 'lead_qualifier', name: 'Lead Qualifier', tier: 'Sonnet', required: true, lane: 'customer_service',
      description: 'Qualifies new leads (timeline/budget/area), schedules first showing', channels: ['whatsapp', 'sms', 'email'] },
    { role: 'showing_followup', name: 'Showing Follow-up', tier: 'Sonnet', required: true, lane: 'customer_service',
      description: 'Same-day follow-up with feedback + comps after every showing', channels: ['email', 'sms'] },
    { role: 'transaction', name: 'Transaction Coordinator', tier: 'Sonnet', required: true, lane: 'operations',
      description: 'Tracks contract milestones, closing-date reminders', channels: ['email', 'calendar'] },
    { role: 'sphere_nurture', name: 'SOI Nurture', tier: 'Sonnet', required: false, lane: 'marketing',
      description: 'Quarterly check-ins with sphere-of-influence, neighborhood content', channels: ['email', 'instagram'] },
  ],
  recommendedTools: [
    { id: 'google_calendar', label: 'Google Calendar', why: 'Showings + open houses' },
    { id: 'zillow', label: 'Zillow / MLS', why: 'Lead source + listings' },
    { id: 'docusign', label: 'DocuSign', why: 'Contracts + disclosures' },
    { id: 'stripe', label: 'Stripe', why: 'Earnest money / fees if applicable' },
    { id: 'instagram', label: 'Instagram', why: 'Listing showcase + neighborhood content' },
  ],
  sampleWorkflows: [
    { content: 'New lead → qualify (timeline, budget, area) → schedule first showing', tags: ['workflow', 'leads', 'real_estate'] },
    { content: 'Showing complete → same-day follow-up with their feedback + comps', tags: ['workflow', 'follow_up', 'real_estate'] },
    { content: 'Listing accepted → contract milestones + closing-date reminders', tags: ['workflow', 'transaction', 'real_estate'] },
  ],
  commonConstraints: [
    { content: 'Fair housing compliance — never make demographic recommendations or steer', tags: ['compliance', 'real_estate', 'general'] },
    { content: 'Never quote price ranges or commit to offers — those need owner authorization', tags: ['policy', 'real_estate', 'general'] },
  ],
  commonGoals: [
    { content: 'Work every lead — fast follow-up is the #1 conversion driver in real estate', tags: ['business_goal', 'real_estate', 'sales'] },
    { content: 'Build sphere-of-influence pipeline via consistent quarterly check-ins', tags: ['business_goal', 'real_estate', 'pipeline'] },
  ],
  laneHints: {
    scheduler: 'Showings + open houses; honor double-booking guardrails',
    customer_service: 'Same-day reply to inquiries; warm SOI nurture',
    marketing: 'Listing-driven + neighborhood expertise content',
    finance: 'Track pipeline + closed transactions; commission forecasting',
  },
};

/** Generic small business / catch-all */
export const GENERIC_SMALL_BUSINESS: VerticalTemplate = {
  matches: ['small_business', 'other', 'general', 'misc'],
  label: 'Other Small Business',
  tagline: 'Custom-fit setup — we\'ll figure out what you need together',
  emoji: '🏢',
  onboardingPills: [
    'Describe my business in chat',
    'Solo founder, multiple ventures',
    'Family business, mixed services',
    'Something not in the list',
  ],
  defaultAgents: [
    IRIS_ORCHESTRATOR,
    { role: 'generic_scheduler', name: 'Scheduler', tier: 'Haiku', required: false, lane: 'scheduler',
      description: 'Whatever needs scheduling — appointments, calls, deadlines', channels: ['calendar', 'whatsapp'] },
    { role: 'generic_customer_service', name: 'Customer Care', tier: 'Sonnet', required: false, lane: 'customer_service',
      description: 'Replies, follow-ups, capturing preferences as you learn them', channels: ['email', 'whatsapp'] },
    { role: 'generic_finance', name: 'Finance', tier: 'Haiku', required: false, lane: 'finance',
      description: 'Revenue + spend tracking, anomaly flags', channels: ['dashboard'] },
  ],
  recommendedTools: [
    { id: 'google_calendar', label: 'Google Calendar', why: 'Schedule whatever needs scheduling' },
    { id: 'stripe', label: 'Stripe', why: 'Take payments online' },
    { id: 'email', label: 'Email integration', why: 'Inbox triage + drafting' },
    { id: 'instagram', label: 'Instagram / Social', why: 'Find new customers' },
  ],
  sampleWorkflows: [],
  commonConstraints: [],
  commonGoals: [
    { content: 'Free up owner time — automate the recurring busywork first', tags: ['business_goal', 'general'] },
  ],
  laneHints: {
    scheduler: 'Standard calendar coordination',
    customer_service: 'Friendly, prompt replies; capture preferences as you learn them',
    marketing: 'Start with whatever channel the owner already uses',
    finance: 'Track revenue + spend; flag anomalies',
  },
};

export const VERTICAL_TEMPLATES: VerticalTemplate[] = [
  ELECTRICIAN_TEMPLATE,
  HVAC_PLUMBING_TEMPLATE,
  RESTAURANT_TEMPLATE,
  SALON_TEMPLATE,
  FITNESS_TEMPLATE,
  CLEANING_TEMPLATE,
  PHOTOGRAPHY_TEMPLATE,
  REAL_ESTATE_TEMPLATE,
  CONSULTING_TEMPLATE,
  PROFESSIONAL_SERVICES_VERTICAL,
  GENERIC_SMALL_BUSINESS,
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

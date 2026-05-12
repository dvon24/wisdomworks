/**
 * Booking-system adapters.
 *
 * Each booking provider (Square Appointments, Mindbody, Calendly,
 * OpenTable, etc.) implements this interface. The agent runtime + sync
 * cron call into the abstract methods without knowing which provider
 * is on the other end.
 *
 * Connection storage piggybacks on the existing `oauth_connections`
 * table (service='booking', provider='square' | 'mindbody' | ...).
 */

export type BookingProvider = 'square' | 'mindbody' | 'calendly' | 'opentable' | 'booksy';

export interface BookingCustomer {
  /** Provider-side stable id */
  externalId: string;
  displayName: string;
  email?: string;
  phone?: string;
  createdAt?: string;
  lastVisitAt?: string;
  visitCount?: number;
  /** Free-form notes from the provider (e.g. Square notes field) */
  notes?: string;
  /** Tags / segments the provider tracks */
  tags?: string[];
}

export interface BookingAppointment {
  externalId: string;
  customerExternalId: string;
  startAt: string;
  endAt?: string;
  serviceLabel?: string;
  staffLabel?: string;
  status?: 'booked' | 'cancelled' | 'completed' | 'no_show';
  notes?: string;
}

export interface BookingAdapter {
  provider: BookingProvider;
  /** OAuth callback URL relative to apps/web base. Each adapter exposes
   *  its own route under /api/oauth/<provider>. */
  oauthInitiatePath: string;
  /** Pull customers since `since` (ISO timestamp) or all on first run. */
  listCustomers(accessToken: string, since?: string, opts?: { merchantId?: string }): Promise<BookingCustomer[]>;
  /** Pull upcoming + recent appointments (Phase 2). */
  listAppointments?(accessToken: string, fromIso: string, toIso: string, opts?: { merchantId?: string }): Promise<BookingAppointment[]>;
}

// Square adapter is the first implementation; export it here for the
// register-as-default flow. Future providers wire in the same way.
export { squareAdapter } from './square';

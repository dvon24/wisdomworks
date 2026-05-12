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

export interface BookingAvailabilitySlot {
  startAt: string;
  /** Optional team member / staff id from the provider */
  staffExternalId?: string;
}

export interface CreateBookingInput {
  customerExternalId: string;
  startAt: string;
  /** Service variation id from the provider (Square requires this) */
  serviceExternalId?: string;
  /** Optional staff id */
  staffExternalId?: string;
  /** Free-text seller note for the booking */
  sellerNote?: string;
  /** How long the booking is in minutes (used as fallback when service
   *  duration isn't auto-resolved by the provider). */
  durationMinutes?: number;
}

export interface CreatedBooking {
  externalId: string;
  startAt: string;
  endAt?: string;
  status?: string;
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
  /** Search available slots for a service/staff combination (Phase 3). */
  searchAvailability?(accessToken: string, fromIso: string, toIso: string, opts?: { merchantId?: string; serviceExternalId?: string; staffExternalId?: string }): Promise<BookingAvailabilitySlot[]>;
  /** Create a booking on behalf of the merchant (Phase 3). */
  createBooking?(accessToken: string, input: CreateBookingInput, opts?: { merchantId?: string }): Promise<CreatedBooking | null>;
}

// Square adapter is the first implementation; export it here for the
// register-as-default flow. Future providers wire in the same way.
export { squareAdapter } from './square';

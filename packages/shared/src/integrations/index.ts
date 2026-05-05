// Shared integration clients — used by agents to read/write external services.
// All clients return IntegrationResult<T> so callers can branch on success/error.

export type {
  EmailMessage,
  SendEmailRequest,
  CalendarEvent,
  CreateCalendarEvent,
  IntegrationContext,
  IntegrationResult,
} from './types';

export type { OAuthConnection } from './router';

// Provider router (recommended) — dispatches by connection.provider
export {
  listEmails,
  sendEmail,
  markEmailRead,
  listCalendarEvents,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
} from './router';

// Direct provider access (for advanced use)
export * as gmail from './gmail';
export * as googleCalendar from './google-calendar';
export * as microsoft from './microsoft';
export * as apple from './apple-caldav';

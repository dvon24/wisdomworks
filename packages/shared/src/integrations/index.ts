// Shared integration clients — used by agents to read/write external services.
// All clients return IntegrationResult<T> so callers can branch on success/error.

export type {
  EmailMessage,
  EmailAttachmentRef,
  FetchedAttachment,
  SendEmailRequest,
  OutboundAttachment,
  CalendarEvent,
  CreateCalendarEvent,
  IntegrationContext,
  IntegrationResult,
} from './types';

export type { OAuthConnection } from './router';
export type { CloudDocRef, FetchedCloudDoc } from './cloud-docs';

// Provider router (recommended) — dispatches by connection.provider
export {
  listEmails,
  sendEmail,
  markEmailRead,
  listEmailAttachments,
  fetchEmailAttachment,
  getEmailReadState,
  searchCloudDocs,
  fetchCloudDoc,
  listCalendarEvents,
  listCalendars,
  listSentEmails,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
} from './router';

// Direct provider access (for advanced use)
export * as gmail from './gmail';
export * as googleCalendar from './google-calendar';
export * as googleSearchConsole from './google-search-console';
export * as googleAnalytics from './google-analytics';
export * as googleSheets from './google-sheets';
export type { GscSite, GscQueryRow, GscPerformanceReport } from './google-search-console';
export type { Ga4Property, Ga4ReportRow, Ga4Report } from './google-analytics';
export type { SheetSummary, SheetRange } from './google-sheets';
export { refreshGoogleAccessToken, callGoogleWithRefresh, googleFetch } from './google-refresh';
export type { RefreshedGoogleToken } from './google-refresh';
export * as microsoft from './microsoft';
export * as apple from './apple-caldav';
// IMAP module is server-only (Node net/dns/tls). Don't re-export the
// namespace here — that pulls imapflow into client bundles. The router
// imports it directly when needed; routes that need verifyImapLogin
// inline a small helper.

// Website analyzer (read-only crawler + platform detection)
export { analyzeWebsite } from './website';
export type { WebsiteSnapshot, WebsitePlatform } from './website';

// Slack — post messages, list channels, read history, search
export * as slack from './slack';
export type { SlackChannel, SlackMessage, PostMessageRequest } from './slack';

// Notion — search, read pages, create pages, append blocks
export * as notion from './notion';
export type { NotionPage, NotionDatabase } from './notion';

// Stripe (customer-side — for SaaS customers who want their agent to see their MRR)
export * as customerStripe from './stripe';
export type { StripeCustomerSummary } from './stripe';

// Token encryption + connection loading
export { encryptToken, decryptToken, assertEncryptionConfigured } from './crypto';
export { loadConnectionsForPhone, getConnectionForPhone } from './connections';

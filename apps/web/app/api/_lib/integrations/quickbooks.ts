/**
 * QuickBooks Online adapter.
 *
 * https://developer.intuit.com/app/developer/qbo/docs/get-started
 *
 * OAuth 2.0 flow: owner clicks "Connect QuickBooks" → Intuit OAuth →
 * we get an access_token + refresh_token + realmId (the QuickBooks
 * company id). All API calls are scoped to a single realm.
 *
 * Strategic value: this is the finance-system-of-record for SMBs that
 * already run on QuickBooks. Once connected, the finance lane can:
 *   - Pull AR/AP balances ("how much money is owed to me")
 *   - Create invoices that auto-sync with the owner's books
 *   - Reconcile Stripe charges against QuickBooks invoices
 *
 * Token lifetime: access_token expires in 1 hour, refresh_token in
 * 100 days. We refresh proactively when the token has <10min left.
 */

import { encryptToken } from '@wisdomworks/shared';

const INTUIT_AUTHORIZE_URL = 'https://appcenter.intuit.com/connect/oauth2';
const INTUIT_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const QBO_API_BASE = 'https://quickbooks.api.intuit.com/v3/company';
const QBO_SCOPES = 'com.intuit.quickbooks.accounting';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export interface QuickBooksTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  x_refresh_token_expires_in: number;
  token_type: string;
  /** Intuit returns this on the callback URL, not the token response —
   *  we attach it here for convenience after exchanging. */
  realm_id?: string;
}

// ─── OAuth ───────────────────────────────────────────────────────────────

export function buildQuickBooksAuthorizeUrl(state: string): string {
  const clientId = process.env.QUICKBOOKS_CLIENT_ID;
  if (!clientId) throw new Error('QUICKBOOKS_CLIENT_ID not set');
  const redirect = `${process.env.NEXT_PUBLIC_APP_BASE_URL?.replace(/\/$/, '')}/api/oauth/quickbooks/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    scope: QBO_SCOPES,
    redirect_uri: redirect,
    state,
  });
  return `${INTUIT_AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeQuickBooksCode(input: {
  code: string;
  realmId: string;
}): Promise<QuickBooksTokenResponse | null> {
  const clientId = process.env.QUICKBOOKS_CLIENT_ID;
  const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.warn('[qbo] QUICKBOOKS_CLIENT_ID / SECRET not set');
    return null;
  }
  const redirect = `${process.env.NEXT_PUBLIC_APP_BASE_URL?.replace(/\/$/, '')}/api/oauth/quickbooks/callback`;
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: redirect,
    });
    const res = await fetch(INTUIT_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    if (!res.ok) {
      console.warn('[qbo] token exchange failed:', res.status, await res.text());
      return null;
    }
    const tokens = (await res.json()) as QuickBooksTokenResponse;
    tokens.realm_id = input.realmId;
    return tokens;
  } catch (err) {
    console.warn('[qbo] token exchange exception:', err);
    return null;
  }
}

export async function refreshQuickBooksToken(refreshToken: string): Promise<QuickBooksTokenResponse | null> {
  const clientId = process.env.QUICKBOOKS_CLIENT_ID;
  const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  try {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    const res = await fetch(INTUIT_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    if (!res.ok) {
      console.warn('[qbo] refresh failed:', res.status, await res.text());
      return null;
    }
    return await res.json();
  } catch {
    return null;
  }
}

// ─── API calls (scoped to a realmId) ─────────────────────────────────────

interface QboFetchInput {
  accessToken: string;
  realmId: string;
  path: string;
  method?: 'GET' | 'POST';
  body?: Record<string, unknown>;
  query?: Record<string, string>;
}

async function qboFetch(input: QboFetchInput): Promise<any | null> {
  const qs = input.query ? `?${new URLSearchParams(input.query).toString()}` : '';
  const url = `${QBO_API_BASE}/${input.realmId}/${input.path}${qs}`;
  try {
    const res = await fetch(url, {
      method: input.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: input.body ? JSON.stringify(input.body) : undefined,
    });
    if (!res.ok) {
      console.warn(`[qbo] ${input.method ?? 'GET'} ${input.path} failed:`, res.status, await res.text());
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn('[qbo] fetch exception:', err);
    return null;
  }
}

export interface QboCompanyInfo {
  CompanyName: string;
  LegalName?: string;
  Country?: string;
  Email?: { Address?: string };
}

export async function fetchCompanyInfo(input: { accessToken: string; realmId: string }): Promise<QboCompanyInfo | null> {
  const data = await qboFetch({ ...input, path: `companyinfo/${input.realmId}` });
  return data?.CompanyInfo ?? null;
}

export interface QboInvoiceSummary {
  id: string;
  docNumber?: string;
  customerName?: string;
  amount: number;
  balance: number;
  dueDate?: string;
  status: 'open' | 'paid' | 'overdue' | 'partial';
}

/** List invoices, optionally filtered to unpaid. */
export async function listInvoices(input: {
  accessToken: string;
  realmId: string;
  onlyUnpaid?: boolean;
  limit?: number;
}): Promise<QboInvoiceSummary[]> {
  const where = input.onlyUnpaid ? "WHERE Balance > '0'" : '';
  const limit = input.limit ?? 20;
  const data = await qboFetch({
    accessToken: input.accessToken,
    realmId: input.realmId,
    path: 'query',
    query: { query: `SELECT * FROM Invoice ${where} ORDER BY DueDate ASC MAXRESULTS ${limit}` },
  });
  const rows = data?.QueryResponse?.Invoice ?? [];
  const today = new Date().toISOString().slice(0, 10);
  return rows.map((inv: any): QboInvoiceSummary => {
    const balance = Number(inv.Balance ?? 0);
    const amount = Number(inv.TotalAmt ?? 0);
    let status: QboInvoiceSummary['status'] = 'open';
    if (balance === 0) status = 'paid';
    else if (balance < amount) status = 'partial';
    else if (inv.DueDate && inv.DueDate < today) status = 'overdue';
    return {
      id: String(inv.Id),
      docNumber: inv.DocNumber,
      customerName: inv.CustomerRef?.name,
      amount,
      balance,
      dueDate: inv.DueDate,
      status,
    };
  });
}

/** Outstanding AR — sum of all open invoice balances. Quick "money owed" stat. */
export async function fetchOutstandingAR(input: { accessToken: string; realmId: string }): Promise<{
  totalOwed: number;
  invoiceCount: number;
  oldestDueDate?: string;
}> {
  const open = await listInvoices({ ...input, onlyUnpaid: true, limit: 100 });
  const totalOwed = open.reduce((s, i) => s + i.balance, 0);
  const oldestDueDate = open
    .filter((i) => i.dueDate)
    .sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1))[0]?.dueDate;
  return { totalOwed, invoiceCount: open.length, oldestDueDate };
}

export interface CreateInvoiceInput {
  accessToken: string;
  realmId: string;
  customerId: string;
  amountUsd: number;
  description: string;
  dueDate?: string;
}

/** Create a basic invoice. Caller must provide customer_id — use
 *  findOrCreateCustomer first if you only have a name. */
export async function createInvoice(input: CreateInvoiceInput): Promise<{ id: string; docNumber?: string } | null> {
  const body: Record<string, unknown> = {
    Line: [
      {
        DetailType: 'SalesItemLineDetail',
        Amount: input.amountUsd,
        Description: input.description.slice(0, 1000),
        SalesItemLineDetail: {
          // 1 is the default "Services" item — works for most fresh QBO
          // companies. Caller can override later via metadata if needed.
          ItemRef: { value: '1' },
        },
      },
    ],
    CustomerRef: { value: input.customerId },
    ...(input.dueDate ? { DueDate: input.dueDate } : {}),
  };
  const data = await qboFetch({
    accessToken: input.accessToken,
    realmId: input.realmId,
    path: 'invoice',
    method: 'POST',
    body,
  });
  if (!data?.Invoice?.Id) return null;
  return { id: String(data.Invoice.Id), docNumber: data.Invoice.DocNumber };
}

export async function findOrCreateCustomer(input: {
  accessToken: string;
  realmId: string;
  name: string;
  email?: string;
}): Promise<string | null> {
  // First try to find by name (display name)
  const escaped = input.name.replace(/'/g, "\\'");
  const findData = await qboFetch({
    accessToken: input.accessToken,
    realmId: input.realmId,
    path: 'query',
    query: { query: `SELECT Id FROM Customer WHERE DisplayName = '${escaped}'` },
  });
  const existing = findData?.QueryResponse?.Customer?.[0];
  if (existing) return String(existing.Id);

  // Create
  const created = await qboFetch({
    accessToken: input.accessToken,
    realmId: input.realmId,
    path: 'customer',
    method: 'POST',
    body: {
      DisplayName: input.name,
      ...(input.email ? { PrimaryEmailAddr: { Address: input.email } } : {}),
    },
  });
  if (!created?.Customer?.Id) return null;
  return String(created.Customer.Id);
}

// ─── Persistence ──────────────────────────────────────────────────────────

export async function saveQuickBooksConnection(input: {
  tenantPhone: string;
  tokens: QuickBooksTokenResponse;
  companyName?: string;
}): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false;
  if (!input.tokens.realm_id) {
    console.warn('[qbo] saveConnection missing realm_id');
    return false;
  }
  const cleanPhone = input.tenantPhone.replace(/[\s\-+()]/g, '');
  try {
    const encryptedAccess = await encryptToken(input.tokens.access_token);
    const encryptedRefresh = await encryptToken(input.tokens.refresh_token);
    const expiresAt = new Date(Date.now() + input.tokens.expires_in * 1000).toISOString();
    const refreshExpiresAt = new Date(Date.now() + input.tokens.x_refresh_token_expires_in * 1000).toISOString();

    const body = {
      phone_number: cleanPhone,
      provider: 'quickbooks',
      service: 'accounting',
      account_name: input.companyName ?? input.tokens.realm_id,
      access_token: encryptedAccess,
      refresh_token: encryptedRefresh,
      expires_at: expiresAt,
      scopes: QBO_SCOPES.split(' '),
      status: 'active',
      metadata: {
        realm_id: input.tokens.realm_id,
        company_name: input.companyName,
        refresh_token_expires_at: refreshExpiresAt,
      },
    };

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/oauth_connections?on_conflict=phone_number,provider,service`,
      {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(body),
      },
    );
    return res.ok;
  } catch (err) {
    console.warn('[qbo] saveConnection exception:', err);
    return false;
  }
}

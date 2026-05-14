/**
 * Story 3.x — Deck data fetchers (server-side, RSC pages call these).
 *
 * One-stop module for the dashboard's data needs. Each function returns
 * a typed shape the page can render directly. All queries are
 * tenant-scoped — the caller passes the cleaned phone they got from
 * verifying the session cookie.
 */

import { cookies } from 'next/headers';
import { verifySessionToken } from '../../api/_lib/api-auth';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supaHeaders = (extra: Record<string, string> = {}) => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  ...extra,
});

/**
 * Read the session cookie and return the phone for the logged-in
 * owner. Returns null when the deck is being viewed unauthenticated;
 * pages decide how to handle (render a sign-in prompt, etc.).
 */
export async function getOwnerPhoneFromCookie(): Promise<string | null> {
  const jar = await cookies();
  const sessionCookie = jar.get('ww_session');
  if (!sessionCookie?.value) return null;
  const verified = await verifySessionToken(sessionCookie.value);
  return verified?.phone ?? null;
}

// ─── Health summary ──────────────────────────────────────────────────────

export interface HealthSummary {
  agentsRunning: number;
  agentsPaused: number;
  agentsReady: number;
  runs24h: number;
  cost24hUsd: number;
  openInsights: number;
}

export async function fetchHealthSummary(tenantPhone: string): Promise<HealthSummary> {
  const empty: HealthSummary = {
    agentsRunning: 0,
    agentsPaused: 0,
    agentsReady: 0,
    runs24h: 0,
    cost24hUsd: 0,
    openInsights: 0,
  };
  if (!SUPABASE_URL || !SUPABASE_KEY) return empty;

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [instRes, runsRes, chatRes, insightsRes] = await Promise.all([
    fetch(
      `${SUPABASE_URL}/rest/v1/agent_instances?tenant_phone=eq.${tenantPhone}&select=status`,
      { headers: supaHeaders(), cache: 'no-store' },
    ),
    fetch(
      `${SUPABASE_URL}/rest/v1/agent_runs?tenant_phone=eq.${tenantPhone}&created_at=gte.${since24h}&select=cost_usd`,
      { headers: supaHeaders(), cache: 'no-store' },
    ),
    fetch(
      `${SUPABASE_URL}/rest/v1/chat_runs?tenant_phone=eq.${tenantPhone}&created_at=gte.${since24h}&select=cost_usd`,
      { headers: supaHeaders(), cache: 'no-store' },
    ),
    fetch(
      `${SUPABASE_URL}/rest/v1/business_insights?tenant_phone=eq.${tenantPhone}&status=eq.proposed&select=count`,
      { headers: supaHeaders({ Prefer: 'count=exact' }), cache: 'no-store' },
    ),
  ]);

  if (instRes.ok) {
    const rows: { status: string }[] = await instRes.json();
    for (const r of rows) {
      if (r.status === 'running') empty.agentsRunning++;
      else if (r.status === 'paused') empty.agentsPaused++;
      else if (r.status === 'ready') empty.agentsReady++;
    }
  }

  let cost = 0;
  let runs = 0;
  if (runsRes.ok) {
    const rows: { cost_usd?: number }[] = await runsRes.json();
    runs += rows.length;
    for (const r of rows) cost += Number(r.cost_usd ?? 0);
  }
  if (chatRes.ok) {
    const rows: { cost_usd?: number }[] = await chatRes.json();
    runs += rows.length;
    for (const r of rows) cost += Number(r.cost_usd ?? 0);
  }
  empty.runs24h = runs;
  empty.cost24hUsd = Number(cost.toFixed(4));

  const range = insightsRes.headers.get('content-range');
  if (range) {
    const total = range.split('/')[1];
    if (total) empty.openInsights = parseInt(total, 10) || 0;
  }
  return empty;
}

// ─── Recent activity ─────────────────────────────────────────────────────

export interface ActivityRow {
  id: string;
  agent_name?: string;
  trigger: string;
  phase: string;
  outcome: string;
  input_summary?: string;
  output_summary?: string;
  created_at: string;
}

export async function fetchRecentActivity(
  tenantPhone: string,
  limit = 25,
  offset = 0,
  filters: { trigger?: string; outcome?: string } = {},
): Promise<ActivityRow[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  let url = `${SUPABASE_URL}/rest/v1/agent_runs?tenant_phone=eq.${tenantPhone}&order=created_at.desc&limit=${limit}&offset=${offset}&select=id,trigger,phase,outcome,input_summary,output_summary,created_at,agent_instance_id`;
  if (filters.trigger) url += `&trigger=eq.${filters.trigger}`;
  if (filters.outcome) url += `&outcome=eq.${filters.outcome}`;
  const res = await fetch(url, { headers: supaHeaders(), cache: 'no-store' });
  if (!res.ok) return [];
  return res.json();
}

// ─── Open insights ───────────────────────────────────────────────────────

export interface InsightRow {
  id: string;
  detector: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  why?: string;
  recommended_action?: string;
  expected_impact?: string;
  confidence?: number;
  detected_at: string;
}

export async function fetchOpenInsights(tenantPhone: string, limit = 20): Promise<InsightRow[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const url = `${SUPABASE_URL}/rest/v1/business_insights?tenant_phone=eq.${tenantPhone}&status=in.(proposed,approved)&order=severity.asc,detected_at.desc&limit=${limit}&select=id,detector,severity,title,why,recommended_action,expected_impact,confidence,detected_at`;
  const res = await fetch(url, { headers: supaHeaders(), cache: 'no-store' });
  if (!res.ok) return [];
  return res.json();
}

// ─── Recent analyzed documents ────────────────────────────────────────────

export interface DocRow {
  id: string;
  source: string;
  filename?: string;
  summary?: string;
  tags: string[];
  analyzed_at: string;
}

export async function fetchRecentDocuments(tenantPhone: string, limit = 10): Promise<DocRow[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const url = `${SUPABASE_URL}/rest/v1/received_documents?tenant_phone=eq.${tenantPhone}&status=eq.analyzed&order=analyzed_at.desc&limit=${limit}&select=id,source,filename,summary,tags,analyzed_at`;
  const res = await fetch(url, { headers: supaHeaders(), cache: 'no-store' });
  if (!res.ok) return [];
  return res.json();
}

// ─── Tenant identity (for header / breadcrumbs) ───────────────────────────

export interface TenantIdentity {
  phone: string;
  name?: string;
  businessName?: string;
  businessType?: string;
  isOwner: boolean;
}

export async function fetchTenantIdentity(tenantPhone: string): Promise<TenantIdentity> {
  const empty: TenantIdentity = { phone: tenantPhone, isOwner: false };
  if (!SUPABASE_URL || !SUPABASE_KEY) return empty;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${tenantPhone}&select=name,business_name,business_type,is_owner&limit=1`,
    { headers: supaHeaders(), cache: 'no-store' },
  );
  if (!res.ok) return empty;
  const rows = await res.json();
  const r = rows[0];
  if (!r) return empty;
  return {
    phone: tenantPhone,
    name: r.name,
    businessName: r.business_name,
    businessType: r.business_type,
    isOwner: !!r.is_owner,
  };
}

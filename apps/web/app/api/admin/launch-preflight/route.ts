/**
 * GET /api/admin/launch-preflight        Authorization: Bearer <OWNER_API_TOKEN>
 *   Optional: ?phone=<tenant>  → adds per-tenant activation checks.
 *
 * One self-checking dashboard for "is the MVP actually launch-ready?" Most of
 * what blocks a testable launch is CONFIG/activation in prod, not code — env
 * vars, OAuth, bucket perms, applied migrations, per-tenant Twilio/Square
 * wiring. This endpoint live-checks each gate so the answer is a green/red list
 * instead of guesswork.
 *
 * Each check is independent and try/catched — one failing probe never sinks the
 * report. `ok` is true iff there are zero hard FAILs (warns are allowed). No
 * secrets are returned — env checks report presence only.
 */

import { auditCatalogIntegrity } from '../../_lib/role-catalog-audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const sb = () => ({ apikey: SUPABASE_KEY!, Authorization: `Bearer ${SUPABASE_KEY}` });

type CheckStatus = 'pass' | 'fail' | 'warn' | 'skip';
interface Check {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  /** What to do when this isn't green. */
  fix?: string;
  /** 'blocker' = must be green to launch; 'recommended' = should be; 'optional'. */
  weight: 'blocker' | 'recommended' | 'optional';
}

function env(name: string): boolean {
  return !!(process.env[name] && String(process.env[name]).trim());
}

/** Presence-only env check — never echoes the value. */
function envCheck(
  id: string,
  label: string,
  names: string[],
  weight: Check['weight'],
  fix: string,
  mode: 'all' | 'any' = 'all',
): Check {
  const present = names.filter(env);
  const ok = mode === 'all' ? present.length === names.length : present.length > 0;
  const missing = names.filter((n) => !env(n));
  return {
    id,
    label,
    status: ok ? 'pass' : weight === 'optional' ? 'warn' : 'fail',
    detail: ok ? `set (${present.join(', ')})` : `missing: ${missing.join(', ')}`,
    fix: ok ? undefined : fix,
    weight,
  };
}

/** Does a table exist + (optionally) have a row matching a filter? */
async function tableCheck(
  id: string,
  label: string,
  table: string,
  filter: string,
  weight: Check['weight'],
  fix: string,
): Promise<Check> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { id, label, status: 'skip', detail: 'supabase not configured', weight };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}&select=*&limit=1`, { headers: sb() });
    if (res.status === 404 || res.status === 400) {
      return { id, label, status: 'fail', detail: `table/relation missing (HTTP ${res.status}) — migration not applied`, fix, weight };
    }
    if (!res.ok) return { id, label, status: 'warn', detail: `query HTTP ${res.status}`, weight };
    const rows = await res.json();
    const has = Array.isArray(rows) && rows.length > 0;
    return {
      id,
      label,
      status: has ? 'pass' : 'fail',
      detail: has ? 'present' : 'table exists but the expected row is absent',
      fix: has ? undefined : fix,
      weight,
    };
  } catch (err: any) {
    return { id, label, status: 'warn', detail: `probe error: ${err?.message ?? String(err)}`, weight };
  }
}

export async function GET(request: Request) {
  const auth = request.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const ownerToken = process.env.OWNER_API_TOKEN;
  if (!ownerToken || token !== ownerToken) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const phone = (url.searchParams.get('phone') ?? '').replace(/[\s\-+()]/g, '');

  const checks: Check[] = [];

  // ── Core platform env (blockers) ──────────────────────────────────────────
  checks.push(envCheck('env.anthropic', 'Anthropic API key', ['ANTHROPIC_API_KEY'], 'blocker', 'Set ANTHROPIC_API_KEY in Vercel — the agent brain needs it.'));
  checks.push(envCheck('env.supabase', 'Supabase URL + service key', ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'], 'blocker', 'Set both Supabase env vars in Vercel.'));
  checks.push(envCheck('env.openai', 'OpenAI key (embeddings/RAG)', ['OPENAI_API_KEY'], 'recommended', 'Set OPENAI_API_KEY — knowledge-base recall + atom dedup embeddings need it.'));
  checks.push(envCheck('env.stripe', 'Stripe secret (6.1 paywall)', ['STRIPE_SECRET_KEY'], 'blocker', 'Set STRIPE_SECRET_KEY — the deploy-complete deadbolt verifies checkout against it.'));
  checks.push(envCheck('env.replicate', 'Replicate token (reels)', ['REPLICATE_API_TOKEN'], 'recommended', 'Set REPLICATE_API_TOKEN in Vercel — reel/video generation no-ops without it.'));
  checks.push(envCheck('env.whatsapp', 'WhatsApp owner channel', ['WHATSAPP_PHONE_ID', 'WHATSAPP_ACCESS_TOKEN'], 'blocker', 'Set WHATSAPP_PHONE_ID + WHATSAPP_ACCESS_TOKEN — the owner control plane.'));
  checks.push(envCheck('env.app_base_url', 'Cross-app base URL', ['NEXT_PUBLIC_APP_BASE_URL'], 'recommended', 'Set NEXT_PUBLIC_APP_BASE_URL in the WEBSITE Vercel project so onboarding’s agent-binding call reaches the web app (else it falls back to the hardcoded wisdomworks.vercel.app).'));
  checks.push(envCheck('env.owner_token', 'Owner API token', ['OWNER_API_TOKEN'], 'recommended', 'Set OWNER_API_TOKEN — gates admin endpoints + manual backfills.'));

  // ── Customer-lane env (recommended — needed for the SMB/salon pilot) ───────
  checks.push(envCheck('env.twilio', 'Twilio SMS (customer lane)', ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'], 'recommended', 'Set TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN for the SMS customer lane.'));
  checks.push(envCheck('env.twilio_from', 'Twilio default from-number', ['TWILIO_FROM_NUMBER', 'TWILIO_PHONE_NUMBER'], 'optional', 'Optional: TWILIO_FROM_NUMBER/TWILIO_PHONE_NUMBER — per-tenant replies already send FROM the business number.', 'any'));
  checks.push(envCheck('env.websearch', 'Web search fallback (Tavily)', ['TAVILY_API_KEY'], 'optional', 'Optional: enable Web search in the Claude Console, OR set TAVILY_API_KEY as the fallback, for the web_search/read_url tools.'));

  // ── Catalog integrity (the "no agent ships mute" gate) ─────────────────────
  try {
    const audit = await auditCatalogIntegrity();
    checks.push({
      id: 'catalog.integrity',
      label: 'Catalog complete (no mute roles)',
      status: audit.ok ? 'pass' : 'fail',
      detail: audit.ok
        ? `${audit.rolesChecked} roles, ${audit.templateRows} template rows, 0 mute`
        : `mute roles: ${audit.mute.join(', ') || '—'} | ${audit.summary}`,
      fix: audit.ok ? undefined : 'Apply 2026-06-03-catalog-complete-roles.sql so every catalog role ships ≥1 day-1 routine.',
      weight: 'blocker',
    });
  } catch (err: any) {
    checks.push({ id: 'catalog.integrity', label: 'Catalog complete (no mute roles)', status: 'warn', detail: `audit error: ${err?.message ?? String(err)}`, weight: 'blocker' });
  }

  // ── Applied-migration proofs (concrete row/table existence) ────────────────
  checks.push(await tableCheck(
    'migration.customer_conversations', 'customer_conversations table (SMB framework)',
    'customer_conversations', 'tenant_phone=not.is.null', 'recommended',
    'Apply 2026-06-03-customer-conversations.sql — the customer SMS lane writes here.',
  ));
  checks.push(await tableCheck(
    'migration.homeschool_tutor', 'Homeschool curriculum template',
    'agent_role_templates', 'role_slug=eq.tutor&name_suffix=eq.weekly-curriculum-plan', 'optional',
    'Apply 2026-06-03-homeschool-tutor-routine.sql — adds the tutor weekly-curriculum-plan routine.',
  ));

  // ── generated-docs bucket public-read (doc delivery links) ─────────────────
  if (SUPABASE_URL && SUPABASE_KEY) {
    try {
      const res = await fetch(`${SUPABASE_URL}/storage/v1/bucket/generated-docs`, { headers: sb() });
      if (res.status === 404) {
        checks.push({ id: 'storage.generated_docs', label: 'generated-docs bucket public-read', status: 'fail', detail: 'bucket missing', fix: 'Create the generated-docs storage bucket with public read.', weight: 'recommended' });
      } else if (res.ok) {
        const b = await res.json();
        checks.push({
          id: 'storage.generated_docs', label: 'generated-docs bucket public-read',
          status: b?.public ? 'pass' : 'fail',
          detail: b?.public ? 'public' : 'bucket exists but is NOT public — doc links will 403',
          fix: b?.public ? undefined : 'Set the generated-docs bucket to public-read so generated Word/PDF links open.',
          weight: 'recommended',
        });
      } else {
        checks.push({ id: 'storage.generated_docs', label: 'generated-docs bucket public-read', status: 'warn', detail: `HTTP ${res.status}`, weight: 'recommended' });
      }
    } catch (err: any) {
      checks.push({ id: 'storage.generated_docs', label: 'generated-docs bucket public-read', status: 'warn', detail: `probe error: ${err?.message ?? String(err)}`, weight: 'recommended' });
    }
  }

  // ── Per-tenant activation (only when ?phone given) ─────────────────────────
  if (phone) {
    checks.push(...(await tenantChecks(phone)));
  }

  const fails = checks.filter((c) => c.status === 'fail');
  const blockerFails = fails.filter((c) => c.weight === 'blocker');
  const warns = checks.filter((c) => c.status === 'warn');
  const passes = checks.filter((c) => c.status === 'pass');

  return Response.json({
    ok: fails.length === 0,
    launch_blocked: blockerFails.length > 0,
    scope: phone ? `global + tenant ${phone}` : 'global (pass ?phone=<tenant> for activation checks)',
    summary: `${passes.length} pass / ${fails.length} fail (${blockerFails.length} blocker) / ${warns.length} warn`,
    blockers: blockerFails.map((c) => ({ label: c.label, detail: c.detail, fix: c.fix })),
    checks,
  }, { status: 200 });
}

/** Per-tenant activation probes — does THIS tenant have everything wired to run. */
async function tenantChecks(phone: string): Promise<Check[]> {
  const out: Check[] = [];
  if (!SUPABASE_URL || !SUPABASE_KEY) return [{ id: 'tenant.skip', label: `tenant ${phone}`, status: 'skip', detail: 'supabase not configured', weight: 'blocker' }];

  // Tenant exists?
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${phone}&select=business_name,business_type&limit=1`, { headers: sb() });
    const rows = res.ok ? await res.json() : [];
    if (!rows[0]) {
      out.push({ id: 'tenant.exists', label: `Tenant ${phone} provisioned`, status: 'fail', detail: 'no whatsapp_contexts row — tenant not deployed', fix: 'Run onboarding (deploy-complete) for this number.', weight: 'blocker' });
      return out; // nothing else is meaningful without a tenant
    }
    out.push({ id: 'tenant.exists', label: `Tenant ${phone} provisioned`, status: 'pass', detail: `${rows[0].business_name ?? '(unnamed)'}${rows[0].business_type ? ` — ${rows[0].business_type}` : ''}`, weight: 'blocker' });
  } catch (err: any) {
    out.push({ id: 'tenant.exists', label: `Tenant ${phone} provisioned`, status: 'warn', detail: `probe error: ${err?.message ?? String(err)}`, weight: 'blocker' });
    return out;
  }

  // Agents all bound to a catalog role (un-mute proof)?
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/agent_configs?tenant_phone=eq.${phone}&status=neq.removed&select=agent_name,canonical_role_slug`, { headers: sb() });
    const rows = res.ok ? await res.json() : [];
    const unbound = rows.filter((r: any) => !r.canonical_role_slug).map((r: any) => r.agent_name);
    out.push({
      id: 'tenant.agents_bound', label: 'Agents bound to catalog roles',
      status: rows.length === 0 ? 'warn' : unbound.length === 0 ? 'pass' : 'fail',
      detail: rows.length === 0 ? 'no agents on this tenant' : unbound.length === 0 ? `${rows.length}/${rows.length} bound` : `unbound: ${unbound.join(', ')}`,
      fix: unbound.length === 0 ? undefined : `POST /api/admin/seed-onboarding-agents { phone: "${phone}" } to bind + seed.`,
      weight: 'blocker',
    });
  } catch (err: any) {
    out.push({ id: 'tenant.agents_bound', label: 'Agents bound to catalog roles', status: 'warn', detail: `probe error: ${err?.message ?? String(err)}`, weight: 'blocker' });
  }

  // At least one seeded workflow (the day-1 routines)?
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/user_workflows?tenant_phone=eq.${phone}&select=name&limit=1`, { headers: sb() });
    const rows = res.ok ? await res.json() : [];
    out.push({
      id: 'tenant.workflows_seeded', label: 'Day-1 routines seeded',
      status: rows.length > 0 ? 'pass' : 'fail',
      detail: rows.length > 0 ? 'has ≥1 workflow' : 'no user_workflows — agents shipped mute',
      fix: rows.length > 0 ? undefined : `POST /api/admin/seed-onboarding-agents { phone: "${phone}" } to seed day-1 routines.`,
      weight: 'recommended',
    });
  } catch (err: any) {
    out.push({ id: 'tenant.workflows_seeded', label: 'Day-1 routines seeded', status: 'warn', detail: `probe error: ${err?.message ?? String(err)}`, weight: 'recommended' });
  }

  // Square connected with bookable services (the booking proof)?
  try {
    const { loadActiveBookingConnections } = await import('../../_lib/booking-adapters/customer-sync');
    const conns = await loadActiveBookingConnections(phone);
    const square = conns.find((c: any) => c.provider === 'square');
    out.push({
      id: 'tenant.square', label: 'Square booking connected',
      status: square ? 'pass' : 'warn',
      detail: square ? 'active square connection' : 'no active Square connection — book_appointment will offer to take a message instead',
      fix: square ? undefined : 'Connect Square (with bookable services) for this tenant if the pilot needs real bookings.',
      weight: 'recommended',
    });
  } catch (err: any) {
    out.push({ id: 'tenant.square', label: 'Square booking connected', status: 'warn', detail: `probe error: ${err?.message ?? String(err)}`, weight: 'recommended' });
  }

  // SMS customer channel registered (tenant_channels)?
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/tenant_channels?tenant_phone=eq.${phone}&channel=eq.sms&status=eq.active&select=external_id&limit=1`, { headers: sb() });
    if (res.status === 404 || res.status === 400) {
      out.push({ id: 'tenant.sms_channel', label: 'SMS customer line registered', status: 'warn', detail: 'tenant_channels table missing/inaccessible', weight: 'optional' });
    } else {
      const rows = res.ok ? await res.json() : [];
      out.push({
        id: 'tenant.sms_channel', label: 'SMS customer line registered',
        status: rows[0] ? 'pass' : 'warn',
        detail: rows[0] ? `inbound number ${rows[0].external_id}` : 'no SMS channel — provision a Twilio number to run the customer lane',
        fix: rows[0] ? undefined : `Provision a Twilio number, point its inbound webhook at /api/webhooks/twilio, and INSERT a tenant_channels row (channel='sms', external_id=<business #>, tenant_phone='${phone}', status='active').`,
        weight: 'optional',
      });
    }
  } catch (err: any) {
    out.push({ id: 'tenant.sms_channel', label: 'SMS customer line registered', status: 'warn', detail: `probe error: ${err?.message ?? String(err)}`, weight: 'optional' });
  }

  return out;
}

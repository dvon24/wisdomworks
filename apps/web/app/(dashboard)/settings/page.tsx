/**
 * Story 3.1 — Settings page (operator-facing).
 *
 * Two practical sections for the owner:
 *   1. Connected services — every active oauth_connection for this
 *      tenant. Quick-glance answer to "what is Iris allowed to do?"
 *   2. Platform integrations health — env-var presence checks for the
 *      services we depend on (Replicate, Twilio, Vapi, Stripe Connect,
 *      QuickBooks, Meta, etc). Tells the owner what to wire up next.
 *
 * No editing flows here yet — connections are added via the chat-driven
 * connect_service tool, env vars via Vercel dashboard. This page is the
 * read-only "what's configured" surface.
 */

import {
  getOwnerPhoneFromCookie,
  fetchConnectionsForOwner,
  fetchActiveDispositionRules,
} from '../_lib/deck-data';
import { ConnectionActions } from './connection-actions';

export const dynamic = 'force-dynamic';

/**
 * Render the granted-scopes for a connection in human-readable form.
 * Each scope URL → its short name + 1-line description so the owner
 * can see exactly what permissions they've granted.
 */
function ScopesList({ scopes }: { scopes: string[] }) {
  if (!scopes || scopes.length === 0) {
    return <span style={{ opacity: 0.5 }}>—</span>;
  }
  const labeled = scopes
    .map(scopeLabel)
    .filter((s): s is { label: string; note: string } => s !== null);
  if (labeled.length === 0) {
    return <span style={{ opacity: 0.6 }}>{scopes.length} scope{scopes.length === 1 ? '' : 's'}</span>;
  }
  return (
    <details>
      <summary style={{ cursor: 'pointer', listStyle: 'none' }}>
        {labeled.length} scope{labeled.length === 1 ? '' : 's'}
      </summary>
      <ul style={{ margin: '6px 0 0 0', padding: '0 0 0 14px' }}>
        {labeled.map((s, i) => (
          <li key={i} style={{ marginBottom: 4 }}>
            <strong style={{ fontWeight: 500 }}>{s.label}</strong>
            <span style={{ opacity: 0.7 }}> — {s.note}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Map known OAuth scope URLs to human labels. Unknown scopes show their tail. */
function scopeLabel(scope: string): { label: string; note: string } | null {
  const known: Record<string, { label: string; note: string }> = {
    'https://www.googleapis.com/auth/userinfo.email': { label: 'Email address', note: 'identity only' },
    'https://www.googleapis.com/auth/userinfo.profile': { label: 'Name + photo', note: 'identity only' },
    'https://www.googleapis.com/auth/gmail.readonly': { label: 'Read Gmail', note: 'list + read messages' },
    'https://www.googleapis.com/auth/gmail.send': { label: 'Send Gmail', note: 'send on your behalf' },
    'https://www.googleapis.com/auth/calendar': { label: 'Read+write Calendar', note: 'list events, create, update, delete' },
    'https://www.googleapis.com/auth/drive.readonly': { label: 'Read Drive', note: 'search + read your files' },
    'https://www.googleapis.com/auth/spreadsheets': { label: 'Read+write Sheets', note: 'list, read, append rows' },
    'https://www.googleapis.com/auth/webmasters.readonly': { label: 'Read Search Console', note: 'impressions, clicks, queries' },
    'https://www.googleapis.com/auth/analytics.readonly': { label: 'Read Analytics 4', note: 'sessions, users, conversions' },
    openid: { label: 'OpenID', note: 'sign-in only' },
    email: { label: 'Email', note: 'identity only (Microsoft)' },
    profile: { label: 'Profile', note: 'identity only (Microsoft)' },
    offline_access: { label: 'Offline access', note: 'mints refresh tokens (so we can act when you\'re offline)' },
    'User.Read': { label: 'Read user profile', note: 'Microsoft identity' },
    'Mail.Read': { label: 'Read mail', note: 'Outlook' },
    'Mail.Send': { label: 'Send mail', note: 'Outlook' },
    'Calendars.ReadWrite': { label: 'Read+write Calendar', note: 'Outlook calendar' },
    'Files.Read.All': { label: 'Read OneDrive', note: 'all files you have access to' },
  };
  if (known[scope]) return known[scope];
  // Unknown scope — fall back to the tail segment.
  const tail = scope.split('/').pop() ?? scope;
  if (tail.length > 60) return null;
  return { label: tail, note: 'unknown scope (raw value)' };
}

interface IntegrationCheck {
  label: string;
  envVars: string[];
  enables: string;
}

const PLATFORM_INTEGRATIONS: IntegrationCheck[] = [
  { label: 'Anthropic (LLM)', envVars: ['ANTHROPIC_API_KEY'], enables: 'all agent reasoning' },
  { label: 'WhatsApp (Meta)', envVars: ['WHATSAPP_PHONE_ID', 'WHATSAPP_ACCESS_TOKEN'], enables: 'inbound + outbound messaging' },
  { label: 'Replicate (video)', envVars: ['REPLICATE_API_TOKEN'], enables: 'AI video generation for marketing reels' },
  { label: 'Stripe Connect', envVars: ['STRIPE_CLIENT_ID', 'STRIPE_SECRET_KEY'], enables: 'payment links + reconciliation' },
  { label: 'QuickBooks Online', envVars: ['QUICKBOOKS_CLIENT_ID', 'QUICKBOOKS_CLIENT_SECRET'], enables: 'invoices + AR tracking' },
  { label: 'Twilio (SMS)', envVars: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER'], enables: 'urgent SMS alerts' },
  { label: 'Vapi (Voice)', envVars: ['VAPI_API_KEY', 'VAPI_WEBHOOK_SECRET'], enables: 'inbound voice agent (Story 2b.4-2b.6)' },
  { label: 'OpenAI (embeddings)', envVars: ['OPENAI_API_KEY'], enables: 'knowledge base RAG embeddings' },
  { label: 'API auth deadbolt', envVars: ['API_AUTH_SECRET'], enables: 'session cookies (this deck) + cross-tenant HMAC' },
  { label: 'Cron secret', envVars: ['CRON_SECRET'], enables: 'cron-route auth' },
];

export default async function SettingsPage() {
  const phone = await getOwnerPhoneFromCookie();
  if (!phone) return null;

  const [connections, platformHealth, disposition] = await Promise.all([
    fetchConnectionsForOwner(phone),
    fetchPlatformHealth(),
    fetchActiveDispositionRules(phone, 100),
  ]);

  return (
    <>
      <header className="deck-page-header">
        <div>
          <h1 className="deck-page-title">Settings</h1>
          <div className="deck-page-subtitle">
            What's configured, what's connected, what's not yet
          </div>
        </div>
      </header>

      <section className="glass deck-section">
        <div className="deck-section-header">
          <div className="deck-section-title">
            Operating Manual ({disposition.length} active rules)
          </div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 16 }}>
          Auto-mined from your conversations with Iris. Every agent reads these before acting — corrections, preferences, triggers, communication style. Tell Iris "forget rule &lt;id&gt;" to remove anything that's wrong.
        </div>
        {disposition.length === 0 ? (
          <div className="deck-empty">
            No rules captured yet. Iris builds the manual as you correct, approve, or tell her how you prefer things.
          </div>
        ) : (
          <DispositionGroups rules={disposition} />
        )}
      </section>

      <section className="glass deck-section">
        <div className="deck-section-header">
          <div className="deck-section-title">Your Connected Services ({connections.length})</div>
        </div>
        {connections.length === 0 ? (
          <div className="deck-empty">
            No services connected. Tell Iris "connect Google" or "connect Square" to start.
          </div>
        ) : (
          <table className="deck-table">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Service</th>
                <th>Account</th>
                <th>Scopes granted</th>
                <th>Status</th>
                <th>Last rotated</th>
                <th>Expires</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {connections.map((c, i) => (
                <tr key={`${c.provider}-${c.service}-${i}`}>
                  <td style={{ fontWeight: 500, color: 'var(--text)' }}>{c.provider}</td>
                  <td>{c.service}</td>
                  <td style={{ fontFamily: 'Geist Mono, monospace', fontSize: 12 }}>{c.account_email ?? '—'}</td>
                  <td style={{ fontSize: 11, color: 'var(--text-dim)', maxWidth: 320 }}>
                    <ScopesList scopes={c.scopes ?? []} />
                  </td>
                  <td><StatusPill status={c.status} /></td>
                  <td style={{ fontSize: 12 }}>{c.last_rotated_at ? fmtDate(c.last_rotated_at) : (c.created_at ? fmtDate(c.created_at) : '—')}</td>
                  <td style={{ fontSize: 12 }}>{c.expires_at ? fmtDate(c.expires_at) : '—'}</td>
                  <td>
                    <ConnectionActions
                      ownerPhone={phone}
                      provider={c.provider}
                      service={c.service}
                      status={c.status}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="glass deck-section">
        <div className="deck-section-header">
          <div className="deck-section-title">Platform Integrations</div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 12 }}>
          Env-var presence check. Set these in Vercel → Settings → Environment Variables.
        </div>
        <table className="deck-table">
          <thead>
            <tr>
              <th>Integration</th>
              <th>Status</th>
              <th>Required env vars</th>
              <th>Enables</th>
            </tr>
          </thead>
          <tbody>
            {PLATFORM_INTEGRATIONS.map((it) => {
              const status = platformHealth[it.label];
              return (
                <tr key={it.label}>
                  <td style={{ fontWeight: 500, color: 'var(--text)' }}>{it.label}</td>
                  <td>
                    <span className={`deck-pill ${status === 'ok' ? 'deck-pill-ok' : 'deck-pill-muted'}`}>
                      {status === 'ok' ? 'configured' : 'not set'}
                    </span>
                  </td>
                  <td style={{ fontFamily: 'Geist Mono, monospace', fontSize: 11 }}>
                    {it.envVars.join(', ')}
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text-dim)' }}>{it.enables}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}

async function fetchPlatformHealth(): Promise<Record<string, 'ok' | 'missing'>> {
  // Server-side env access — runs on every page load (cheap, no DB).
  const map: Record<string, 'ok' | 'missing'> = {};
  for (const it of PLATFORM_INTEGRATIONS) {
    const allSet = it.envVars.every((v) => !!process.env[v]);
    map[it.label] = allSet ? 'ok' : 'missing';
  }
  return map;
}

function DispositionGroups({ rules }: { rules: Array<{ id: string; kind: string; rule_text: string; why?: string; evidence?: string; scope: string; applied_count: number; last_applied_at?: string | null; created_at: string }> }) {
  const order = ['frustration_trigger', 'correction', 'preference', 'approval', 'communication_style'] as const;
  const labels: Record<string, { title: string; icon: string }> = {
    frustration_trigger: { title: 'Never', icon: '🚫' },
    correction: { title: 'Avoid repeating', icon: '⚠' },
    preference: { title: 'Standing preferences', icon: '✓' },
    approval: { title: 'Proven patterns', icon: '👍' },
    communication_style: { title: 'Tone / format', icon: '💬' },
  };
  const grouped = order.map((k) => ({
    kind: k,
    items: rules.filter((r) => r.kind === k),
  })).filter((g) => g.items.length > 0);

  if (grouped.length === 0) return <div className="deck-empty">No rules in any category.</div>;

  return (
    <div>
      {grouped.map((g) => (
        <div key={g.kind} style={{ marginBottom: 20 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            {(labels[g.kind]?.icon ?? '·')} {(labels[g.kind]?.title ?? g.kind)} ({g.items.length})
          </div>
          {g.items.map((r) => (
            <div key={r.id} className="glass" style={{ padding: '12px 16px', marginBottom: 8 }}>
              <div style={{ fontWeight: 500, color: 'var(--text)', fontSize: 13 }}>{r.rule_text}</div>
              {r.why ? (
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>
                  {r.why}
                </div>
              ) : null}
              {r.evidence ? (
                <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 6, fontStyle: 'italic' }}>
                  evidence: "{r.evidence.slice(0, 200)}"
                </div>
              ) : null}
              <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 6, fontFamily: 'Geist Mono, monospace' }}>
                [{r.id.slice(0, 8)}] · scope: {r.scope} · applied {r.applied_count}× · captured {fmtDate(r.created_at)}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const cls =
    status === 'active' ? 'deck-pill-ok'
    : status === 'paused' ? 'deck-pill-warn'
    : status === 'revoked' ? 'deck-pill-bad'
    : 'deck-pill-muted';
  return <span className={`deck-pill ${cls}`}>{status}</span>;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}

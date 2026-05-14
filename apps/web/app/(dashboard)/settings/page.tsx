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
} from '../_lib/deck-data';

export const dynamic = 'force-dynamic';

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

  const [connections, platformHealth] = await Promise.all([
    fetchConnectionsForOwner(phone),
    fetchPlatformHealth(),
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
                <th>Status</th>
                <th>Connected</th>
                <th>Expires</th>
              </tr>
            </thead>
            <tbody>
              {connections.map((c, i) => (
                <tr key={`${c.provider}-${c.service}-${i}`}>
                  <td style={{ fontWeight: 500, color: 'var(--text)' }}>{c.provider}</td>
                  <td>{c.service}</td>
                  <td style={{ fontFamily: 'Geist Mono, monospace', fontSize: 12 }}>{c.account_email ?? '—'}</td>
                  <td><StatusPill status={c.status} /></td>
                  <td style={{ fontSize: 12 }}>{c.created_at ? fmtDate(c.created_at) : '—'}</td>
                  <td style={{ fontSize: 12 }}>{c.expires_at ? fmtDate(c.expires_at) : '—'}</td>
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

/**
 * Story 3.8 — Tenant Management
 *
 * Platform-admin view — every tenant (is_owner=true row in
 * whatsapp_contexts) listed with business name, type, agent count,
 * activity. Devon's view today shows him + Au7o.
 *
 * Per-tenant deep-dive (cost, billing, deployment pipeline) is a
 * follow-up — would need joins against billing tables we haven't
 * built UI for yet.
 */

import {
  getOwnerPhoneFromCookie,
  fetchAllTenants,
} from '../_lib/deck-data';

export const dynamic = 'force-dynamic';

export default async function TenantsPage() {
  const phone = await getOwnerPhoneFromCookie();
  if (!phone) return null;
  const tenants = await fetchAllTenants();

  const totalAgents = tenants.reduce((sum, t) => sum + (t.agent_count ?? 0), 0);
  const totalMessages = tenants.reduce((sum, t) => sum + (t.message_count ?? 0), 0);

  return (
    <>
      <header className="deck-page-header">
        <div>
          <h1 className="deck-page-title">Tenants</h1>
          <div className="deck-page-subtitle">
            Every tenant deployment on this WisdomWorks instance
          </div>
        </div>
      </header>

      <div className="deck-stat-grid">
        <div className="glass deck-stat-card">
          <div className="eyebrow deck-stat-label">Tenants</div>
          <div className="deck-stat-value">{tenants.length}</div>
          <div className="deck-stat-value-sub">all-time</div>
        </div>
        <div className="glass deck-stat-card">
          <div className="eyebrow deck-stat-label">Total Agents</div>
          <div className="deck-stat-value">{totalAgents}</div>
          <div className="deck-stat-value-sub">across all tenants</div>
        </div>
        <div className="glass deck-stat-card">
          <div className="eyebrow deck-stat-label">Total Messages</div>
          <div className="deck-stat-value">{totalMessages.toLocaleString()}</div>
          <div className="deck-stat-value-sub">conversation count</div>
        </div>
      </div>

      <section className="glass deck-section">
        <div className="deck-section-header">
          <div className="deck-section-title">Deployments</div>
        </div>
        {tenants.length === 0 ? (
          <div className="deck-empty">No tenants yet.</div>
        ) : (
          <table className="deck-table">
            <thead>
              <tr>
                <th>Business</th>
                <th>Industry</th>
                <th>Phone</th>
                <th>Agents</th>
                <th>Msgs</th>
                <th>First seen</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.phone_number}>
                  <td style={{ fontWeight: 500, color: 'var(--text)' }}>
                    {t.business_name ?? t.name ?? '(unnamed)'}
                    {t.phone_number === phone ? (
                      <span className="deck-pill deck-pill-info" style={{ marginLeft: 8 }}>you</span>
                    ) : null}
                  </td>
                  <td>{t.business_type ? <span className="deck-pill deck-pill-muted">{t.business_type}</span> : '—'}</td>
                  <td style={{ fontFamily: 'Geist Mono, monospace', fontSize: 12 }}>{t.phone_number}</td>
                  <td>{t.agent_count ?? 0}</td>
                  <td>{(t.message_count ?? 0).toLocaleString()}</td>
                  <td style={{ fontSize: 12 }}>{t.first_seen ? fmtDate(t.first_seen) : '—'}</td>
                  <td style={{ fontSize: 12 }}>{t.last_seen ? relativeTime(t.last_seen) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

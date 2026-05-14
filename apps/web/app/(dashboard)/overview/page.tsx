/**
 * Story 3.2 — Environment Overview & Agent Health
 *
 * Owner-facing landing surface. Five at-a-glance stats + the most
 * recent activity + open insights + recently-analyzed documents.
 * RSC — every widget fetches via the deck-data layer with no-store
 * cache so the page reflects current state on each navigation.
 */

import Link from 'next/link';
import {
  getOwnerPhoneFromCookie,
  fetchHealthSummary,
  fetchRecentActivity,
  fetchOpenInsights,
  fetchRecentDocuments,
} from '../_lib/deck-data';

export const dynamic = 'force-dynamic';

export default async function OverviewPage() {
  const phone = await getOwnerPhoneFromCookie();
  if (!phone) return null; // Layout already renders the sign-in card

  const [health, activity, insights, docs] = await Promise.all([
    fetchHealthSummary(phone),
    fetchRecentActivity(phone, 8),
    fetchOpenInsights(phone, 6),
    fetchRecentDocuments(phone, 5),
  ]);

  return (
    <>
      <header className="deck-page-header">
        <div>
          <h1 className="deck-page-title">Overview</h1>
          <div className="deck-page-subtitle">What's happening in the last 24 hours</div>
        </div>
      </header>

      <div className="deck-stat-grid">
        <div className="glass deck-stat-card">
          <div className="eyebrow deck-stat-label">Agents Running</div>
          <div className="deck-stat-value">{health.agentsRunning}</div>
          <div className="deck-stat-value-sub">
            {health.agentsPaused} paused · {health.agentsReady} ready
          </div>
        </div>
        <div className="glass deck-stat-card">
          <div className="eyebrow deck-stat-label">Runs (24h)</div>
          <div className="deck-stat-value">{health.runs24h}</div>
          <div className="deck-stat-value-sub">includes chat + cron + agent ticks</div>
        </div>
        <div className="glass deck-stat-card">
          <div className="eyebrow deck-stat-label">Cost (24h)</div>
          <div className="deck-stat-value">${health.cost24hUsd.toFixed(2)}</div>
          <div className="deck-stat-value-sub">tokens + tool spend</div>
        </div>
        <div className="glass deck-stat-card">
          <div className="eyebrow deck-stat-label">Open Insights</div>
          <div className="deck-stat-value">{health.openInsights}</div>
          <div className="deck-stat-value-sub">
            <Link href="/innovation" style={{ color: 'var(--accent)' }}>
              review →
            </Link>
          </div>
        </div>
      </div>

      <section className="glass deck-section">
        <div className="deck-section-header">
          <div className="deck-section-title">Recent Activity</div>
          <Link href="/activity" style={{ fontSize: 12, color: 'var(--accent)' }}>
            see all →
          </Link>
        </div>
        {activity.length === 0 ? (
          <div className="deck-empty">No recent activity. Run an agent tick or message Iris on WhatsApp to populate this feed.</div>
        ) : (
          <table className="deck-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Phase</th>
                <th>Outcome</th>
                <th>Summary</th>
              </tr>
            </thead>
            <tbody>
              {activity.map((row) => (
                <tr key={row.id}>
                  <td>{relativeTime(row.created_at)}</td>
                  <td>
                    <span className="deck-pill deck-pill-info">{row.phase}</span>
                  </td>
                  <td>
                    <OutcomePill outcome={row.outcome} />
                  </td>
                  <td>{row.output_summary?.slice(0, 140) ?? row.input_summary?.slice(0, 140) ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="glass deck-section">
        <div className="deck-section-header">
          <div className="deck-section-title">Open Insights</div>
          <Link href="/innovation" style={{ fontSize: 12, color: 'var(--accent)' }}>
            see all →
          </Link>
        </div>
        {insights.length === 0 ? (
          <div className="deck-empty">No insights waiting. Detectors haven't flagged anything actionable.</div>
        ) : (
          <div>
            {insights.map((ins) => (
              <div key={ins.id} className={`glass deck-insight-card severity-${ins.severity}`}>
                <div className="deck-insight-title">{ins.title}</div>
                <div className="deck-insight-meta">
                  {ins.detector} · {ins.severity} · confidence {Math.round((ins.confidence ?? 0.7) * 100)}%
                </div>
                {ins.why ? <div className="deck-insight-body">{ins.why}</div> : null}
                {ins.recommended_action ? (
                  <div className="deck-insight-action">→ {ins.recommended_action}</div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="glass deck-section">
        <div className="deck-section-header">
          <div className="deck-section-title">Recent Documents</div>
        </div>
        {docs.length === 0 ? (
          <div className="deck-empty">No analyzed documents yet. Send a PDF to Iris on WhatsApp to start.</div>
        ) : (
          <table className="deck-table">
            <thead>
              <tr>
                <th>Filename</th>
                <th>Source</th>
                <th>Tags</th>
                <th>Summary</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((doc) => (
                <tr key={doc.id}>
                  <td style={{ fontWeight: 500, color: 'var(--text)' }}>{doc.filename ?? '(unnamed)'}</td>
                  <td>
                    <span className="deck-pill deck-pill-muted">{doc.source}</span>
                  </td>
                  <td>{doc.tags.slice(0, 3).join(', ') || '—'}</td>
                  <td>{doc.summary?.slice(0, 120) ?? '—'}</td>
                  <td>{relativeTime(doc.analyzed_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

function OutcomePill({ outcome }: { outcome: string }) {
  const cls =
    outcome === 'acted' || outcome === 'observed' ? 'deck-pill-ok'
    : outcome === 'escalated' ? 'deck-pill-warn'
    : outcome === 'failed' ? 'deck-pill-bad'
    : 'deck-pill-muted';
  return <span className={`deck-pill ${cls}`}>{outcome}</span>;
}

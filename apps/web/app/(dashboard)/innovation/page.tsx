/**
 * Story 3.7 — BMAD Solution Brief Review Interface
 *
 * Pending insight queue. Each card has Approve / Dismiss buttons via
 * a small client component. Approved insights stay in the table for
 * follow-up tracking; dismissed ones drop off the open list.
 *
 * Insights come from the cron detectors (lapsed clients, milestones,
 * VIP suggestions, classification QA, etc.) and from the Phase 2c
 * email engagement framework.
 */

import { getOwnerPhoneFromCookie, fetchOpenInsights } from '../_lib/deck-data';
import { InsightActions } from './insight-actions';

export const dynamic = 'force-dynamic';

export default async function InnovationPage() {
  const phone = await getOwnerPhoneFromCookie();
  if (!phone) return null;
  const insights = await fetchOpenInsights(phone, 50);

  // Bucket by severity for the eye
  const grouped = {
    critical: insights.filter((i) => i.severity === 'critical'),
    high: insights.filter((i) => i.severity === 'high'),
    medium: insights.filter((i) => i.severity === 'medium'),
    low: insights.filter((i) => i.severity === 'low'),
  };

  return (
    <>
      <header className="deck-page-header">
        <div>
          <h1 className="deck-page-title">Innovation</h1>
          <div className="deck-page-subtitle">
            Insights and proposals waiting for your call
          </div>
        </div>
      </header>

      {insights.length === 0 ? (
        <section className="glass deck-section">
          <div className="deck-empty">
            No pending insights. The detectors will surface things here as they find them — lapsed clients, classification regressions, marketing opportunities, contract renewals, etc.
          </div>
        </section>
      ) : null}

      {(['critical', 'high', 'medium', 'low'] as const).map((sev) => {
        const items = grouped[sev];
        if (items.length === 0) return null;
        const sevLabel = sev === 'critical' ? '🚨 Critical'
          : sev === 'high' ? '⚠ High'
          : sev === 'medium' ? '· Medium'
          : 'FYI';
        return (
          <section key={sev} className="glass deck-section">
            <div className="deck-section-header">
              <div className="deck-section-title">
                {sevLabel} <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>({items.length})</span>
              </div>
            </div>
            <div>
              {items.map((ins) => (
                <div key={ins.id} className={`glass deck-insight-card severity-${ins.severity}`}>
                  <div className="deck-insight-title">{ins.title}</div>
                  <div className="deck-insight-meta">
                    {ins.detector} · confidence {Math.round((ins.confidence ?? 0.7) * 100)}% · detected {fmtTime(ins.detected_at)}
                  </div>
                  {ins.why ? <div className="deck-insight-body">{ins.why}</div> : null}
                  {ins.recommended_action ? (
                    <div className="deck-insight-action">→ {ins.recommended_action}</div>
                  ) : null}
                  {ins.expected_impact ? (
                    <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-faint)' }}>
                      Impact: {ins.expected_impact}
                    </div>
                  ) : null}
                  <InsightActions insightId={ins.id} ownerPhone={phone} />
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

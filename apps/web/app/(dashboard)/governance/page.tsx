/**
 * Story 3.6 — Governance Framework UI
 *
 * Three sections:
 *   1. Marketing autonomy preferences (current L-level + L4 guardrails)
 *   2. Lessons-learned registry — sticky rules that gate destructive
 *      actions via the pre-flight in executeTool. Cross-references
 *      consult_count + apply_count so owner sees what's actually
 *      shaping behavior.
 *   3. Audit trail — recent escalated/failed agent_runs with full
 *      input/output summaries. Real-time governance evaluation
 *      output isn't separated yet; this surface is the closest
 *      facsimile until we add a dedicated rules table.
 */

import {
  getOwnerPhoneFromCookie,
  fetchOpenLessons,
  fetchAutonomyPrefs,
  fetchRecentActivity,
} from '../_lib/deck-data';

export const dynamic = 'force-dynamic';

export default async function GovernancePage() {
  const phone = await getOwnerPhoneFromCookie();
  if (!phone) return null;

  const [lessons, autonomy, escalations] = await Promise.all([
    fetchOpenLessons(phone, 30),
    fetchAutonomyPrefs(phone),
    fetchRecentActivity(phone, 25, 0, { outcome: 'escalated' }),
  ]);
  const failures = await fetchRecentActivity(phone, 25, 0, { outcome: 'failed' });

  return (
    <>
      <header className="deck-page-header">
        <div>
          <h1 className="deck-page-title">Governance</h1>
          <div className="deck-page-subtitle">
            Autonomy settings, sticky lessons, and the audit trail
          </div>
        </div>
      </header>

      <section className="glass deck-section">
        <div className="deck-section-header">
          <div className="deck-section-title">Marketing Autonomy</div>
        </div>
        {!autonomy ? (
          <div className="deck-empty">
            No autonomy preferences saved. Default is L2 (draft + approve). Tell Iris "set marketing autonomy to L3" to start.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
            <Stat label="Level" value={autonomy.autonomy_level} sub={describeLevel(autonomy.autonomy_level)} />
            <Stat label="Cadence" value={`${autonomy.draft_cadence_days}d`} sub="between proposed drafts" />
            <Stat label="Max auto-publish/day" value={String(autonomy.max_auto_publish_per_day)} sub="L4 cap" />
            <Stat label="Min confidence" value={String(autonomy.min_confidence_for_auto)} sub="L4 threshold" />
            <Stat
              label="Auto-publish channels"
              value={autonomy.auto_publish_channels.length === 0 ? '(none)' : String(autonomy.auto_publish_channels.length)}
              sub={autonomy.auto_publish_channels.join(', ') || 'L4 disabled until set'}
            />
            <Stat
              label="Blocked words"
              value={String(autonomy.blocked_words.length)}
              sub={autonomy.blocked_words.length > 0 ? autonomy.blocked_words.slice(0, 4).join(', ') : 'none'}
            />
          </div>
        )}
      </section>

      <section className="glass deck-section">
        <div className="deck-section-header">
          <div className="deck-section-title">Lessons Learned ({lessons.length})</div>
        </div>
        {lessons.length === 0 ? (
          <div className="deck-empty">
            No active lessons. Tell Iris "remember not to X — instead do Y" to capture one.
          </div>
        ) : (
          <div>
            {lessons.map((l) => (
              <div key={l.id} className={`glass deck-insight-card severity-${l.severity}`}>
                <div className="deck-insight-title">{l.title}</div>
                <div className="deck-insight-meta">
                  {l.severity} · consulted {l.consult_count}× · applied {l.apply_count}× · {l.status}
                </div>
                <div className="deck-insight-body">
                  <strong>Avoid:</strong> {l.what_went_wrong}
                </div>
                <div className="deck-insight-action">
                  → {l.corrective_action}
                </div>
                <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-faint)', fontFamily: 'Geist Mono, monospace' }}>
                  triggers: {l.topic_keywords.join(', ')}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="glass deck-section">
        <div className="deck-section-header">
          <div className="deck-section-title">Recent Escalations ({escalations.length})</div>
        </div>
        {escalations.length === 0 ? (
          <div className="deck-empty">No recent escalations. Quiet is good.</div>
        ) : (
          <table className="deck-table">
            <thead>
              <tr><th>When</th><th>Phase</th><th>Summary</th></tr>
            </thead>
            <tbody>
              {escalations.map((row) => (
                <tr key={row.id}>
                  <td style={{ fontFamily: 'Geist Mono, monospace', fontSize: 12, whiteSpace: 'nowrap' }}>
                    {fmtAbsTime(row.created_at)}
                  </td>
                  <td><span className="deck-pill deck-pill-info">{row.phase}</span></td>
                  <td>
                    <div style={{ fontWeight: 500, color: 'var(--text)' }}>{row.input_summary?.slice(0, 100)}</div>
                    {row.output_summary ? (
                      <div style={{ fontSize: 12, marginTop: 4 }}>→ {row.output_summary.slice(0, 200)}</div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="glass deck-section">
        <div className="deck-section-header">
          <div className="deck-section-title">Recent Failures ({failures.length})</div>
        </div>
        {failures.length === 0 ? (
          <div className="deck-empty">No recent failures.</div>
        ) : (
          <table className="deck-table">
            <thead>
              <tr><th>When</th><th>Phase</th><th>Summary</th></tr>
            </thead>
            <tbody>
              {failures.map((row) => (
                <tr key={row.id}>
                  <td style={{ fontFamily: 'Geist Mono, monospace', fontSize: 12, whiteSpace: 'nowrap' }}>
                    {fmtAbsTime(row.created_at)}
                  </td>
                  <td><span className="deck-pill deck-pill-info">{row.phase}</span></td>
                  <td>
                    <div style={{ fontWeight: 500, color: 'var(--text)' }}>{row.input_summary?.slice(0, 100)}</div>
                    {row.output_summary ? (
                      <div style={{ fontSize: 12, marginTop: 4, color: 'var(--bad-text)' }}>{row.output_summary.slice(0, 240)}</div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, color: 'var(--text)' }}>{value}</div>
      {sub ? <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>{sub}</div> : null}
    </div>
  );
}

function describeLevel(level: string): string {
  switch (level) {
    case 'L1': return 'manual only';
    case 'L2': return 'draft + approve';
    case 'L3': return 'propose proactively';
    case 'L4': return 'autonomous within guardrails';
    default: return level;
  }
}

function fmtAbsTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

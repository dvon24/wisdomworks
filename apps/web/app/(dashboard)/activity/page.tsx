/**
 * Story 3.4 — Real-Time Agent Activity Feed
 *
 * Paginated agent_runs view with trigger + outcome filters via URL
 * query params. Streaming via SSE is a follow-up — for now this is a
 * server-rendered feed with a "Refresh" link. Each navigation pulls
 * fresh data (cache: 'no-store' on the underlying fetch).
 */

import Link from 'next/link';
import { getOwnerPhoneFromCookie, fetchRecentActivity } from '../_lib/deck-data';

export const dynamic = 'force-dynamic';

const TRIGGERS = ['signal', 'cron', 'manual', 'startup'] as const;
const OUTCOMES = ['acted', 'observed', 'proposed', 'escalated', 'failed', 'no_signal'] as const;

interface SearchParams {
  trigger?: string;
  outcome?: string;
  page?: string;
}

export default async function ActivityPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const phone = await getOwnerPhoneFromCookie();
  if (!phone) return null;
  const sp = await searchParams;
  const page = Math.max(0, parseInt(sp.page ?? '0', 10) || 0);
  const limit = 50;

  const filters = {
    ...(sp.trigger && (TRIGGERS as readonly string[]).includes(sp.trigger) ? { trigger: sp.trigger } : {}),
    ...(sp.outcome && (OUTCOMES as readonly string[]).includes(sp.outcome) ? { outcome: sp.outcome } : {}),
  };
  const rows = await fetchRecentActivity(phone, limit, page * limit, filters);

  const buildLink = (patch: Partial<SearchParams>) => {
    const next: Record<string, string> = {};
    if (sp.trigger) next.trigger = sp.trigger;
    if (sp.outcome) next.outcome = sp.outcome;
    if (sp.page) next.page = sp.page;
    Object.assign(next, patch);
    Object.entries(patch).forEach(([k, v]) => { if (!v) delete next[k]; });
    const qs = new URLSearchParams(next).toString();
    return qs ? `/activity?${qs}` : '/activity';
  };

  return (
    <>
      <header className="deck-page-header">
        <div>
          <h1 className="deck-page-title">Activity Feed</h1>
          <div className="deck-page-subtitle">
            Every action, signal, and decision the platform has logged
          </div>
        </div>
        <Link href={buildLink({ page: undefined })} style={{ fontSize: 12, color: 'var(--accent)' }}>
          ⟳ refresh
        </Link>
      </header>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <FilterGroup label="trigger" current={sp.trigger} options={TRIGGERS} buildLink={(v) => buildLink({ trigger: v, page: undefined })} />
        <FilterGroup label="outcome" current={sp.outcome} options={OUTCOMES} buildLink={(v) => buildLink({ outcome: v, page: undefined })} />
      </div>

      <section className="glass deck-section">
        {rows.length === 0 ? (
          <div className="deck-empty">No matching activity. Try clearing the filters.</div>
        ) : (
          <table className="deck-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Trigger</th>
                <th>Phase</th>
                <th>Outcome</th>
                <th>Summary</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td style={{ whiteSpace: 'nowrap', fontFamily: 'Geist Mono, monospace', fontSize: 12 }}>
                    {fmtAbsTime(row.created_at)}
                  </td>
                  <td><span className="deck-pill deck-pill-muted">{row.trigger}</span></td>
                  <td><span className="deck-pill deck-pill-info">{row.phase}</span></td>
                  <td><OutcomePill outcome={row.outcome} /></td>
                  <td>
                    <div style={{ fontWeight: 500, color: 'var(--text)' }}>
                      {row.input_summary?.slice(0, 100) ?? '—'}
                    </div>
                    {row.output_summary ? (
                      <div style={{ marginTop: 4, fontSize: 12 }}>
                        → {row.output_summary.slice(0, 200)}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <nav style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24, fontSize: 13 }}>
        {page > 0 ? (
          <Link href={buildLink({ page: String(page - 1) })}>← previous</Link>
        ) : <span />}
        <span style={{ color: 'var(--text-faint)' }}>page {page + 1}</span>
        {rows.length === limit ? (
          <Link href={buildLink({ page: String(page + 1) })}>next →</Link>
        ) : <span />}
      </nav>
    </>
  );
}

function FilterGroup({
  label,
  current,
  options,
  buildLink,
}: {
  label: string;
  current?: string;
  options: readonly string[];
  buildLink: (val: string | undefined) => string;
}) {
  return (
    <div className="glass" style={{ padding: '8px 12px', display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
      <span className="eyebrow">{label}</span>
      <Link
        href={buildLink(undefined)}
        className={`deck-pill ${!current ? 'deck-pill-info' : 'deck-pill-muted'}`}
      >
        all
      </Link>
      {options.map((opt) => (
        <Link
          key={opt}
          href={buildLink(opt)}
          className={`deck-pill ${current === opt ? 'deck-pill-info' : 'deck-pill-muted'}`}
        >
          {opt}
        </Link>
      ))}
    </div>
  );
}

function fmtAbsTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function OutcomePill({ outcome }: { outcome: string }) {
  const cls =
    outcome === 'acted' || outcome === 'observed' ? 'deck-pill-ok'
    : outcome === 'escalated' ? 'deck-pill-warn'
    : outcome === 'failed' ? 'deck-pill-bad'
    : 'deck-pill-muted';
  return <span className={`deck-pill ${cls}`}>{outcome}</span>;
}

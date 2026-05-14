/**
 * Story 3.5 — Agent Lifecycle Management
 *
 * Fleet roster table + bulk actions (start / stop / snapshot all /
 * tick now). Per-row rollback to the most recent snapshot. Recent
 * snapshot history at the bottom.
 */

import {
  getOwnerPhoneFromCookie,
  fetchAgentFleet,
  fetchRecentSnapshots,
} from '../_lib/deck-data';
import { FleetActions, RecoverButton } from './agent-actions';

export const dynamic = 'force-dynamic';

export default async function AgentsPage() {
  const phone = await getOwnerPhoneFromCookie();
  if (!phone) return null;

  const [fleet, snapshots] = await Promise.all([
    fetchAgentFleet(phone),
    fetchRecentSnapshots(phone, 25),
  ]);

  const running = fleet.filter((a) => a.status === 'running').length;
  const paused = fleet.filter((a) => a.status === 'paused').length;
  const ready = fleet.filter((a) => a.status === 'ready').length;
  const stopped = fleet.filter((a) => a.status === 'stopped').length;

  return (
    <>
      <header className="deck-page-header">
        <div>
          <h1 className="deck-page-title">Agents</h1>
          <div className="deck-page-subtitle">
            Your team's status, health, and lifecycle controls
          </div>
        </div>
      </header>

      <section className="glass deck-section">
        <div className="deck-section-header">
          <div className="deck-section-title">
            Fleet status — {running} running · {paused} paused · {ready} ready · {stopped} stopped
          </div>
        </div>
        <FleetActions ownerPhone={phone} />
      </section>

      <section className="glass deck-section">
        <div className="deck-section-header">
          <div className="deck-section-title">Roster ({fleet.length})</div>
        </div>
        {fleet.length === 0 ? (
          <div className="deck-empty">No agents provisioned yet for this tenant.</div>
        ) : (
          <table className="deck-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Lane</th>
                <th>Status</th>
                <th>Health</th>
                <th>Runs</th>
                <th>Last tick</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {fleet.map((a) => (
                <tr key={a.id}>
                  <td style={{ fontWeight: 500, color: 'var(--text)' }}>{a.agent_name}</td>
                  <td>
                    {a.lane ? <span className="deck-pill deck-pill-muted">{a.lane}</span> : '—'}
                  </td>
                  <td><StatusPill status={a.status} /></td>
                  <td>
                    {typeof a.health_score === 'number'
                      ? `${Math.round(a.health_score * 100)}%`
                      : '—'}
                  </td>
                  <td>
                    {a.run_count ?? 0}
                    {a.failure_count ? (
                      <span style={{ color: 'var(--bad-text)', fontSize: 11, marginLeft: 6 }}>
                        ({a.failure_count} failed)
                      </span>
                    ) : null}
                  </td>
                  <td style={{ fontSize: 12 }}>
                    {a.last_tick_at ? relativeTime(a.last_tick_at) : 'never'}
                  </td>
                  <td><RecoverButton ownerPhone={phone} instanceId={a.id} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="glass deck-section">
        <div className="deck-section-header">
          <div className="deck-section-title">Recent State Snapshots</div>
        </div>
        {snapshots.length === 0 ? (
          <div className="deck-empty">No snapshots yet. They accumulate as agents tick + before destructive actions.</div>
        ) : (
          <table className="deck-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Reason</th>
                <th>Instance</th>
                <th>Snapshot id</th>
              </tr>
            </thead>
            <tbody>
              {snapshots.map((snap) => {
                const actionName = snap.state_data?.__pre_action__;
                const reasonLabel = snap.reason === 'pre_action' ? `pre-${actionName ?? 'action'}` : snap.reason;
                return (
                  <tr key={snap.id}>
                    <td style={{ whiteSpace: 'nowrap', fontFamily: 'Geist Mono, monospace', fontSize: 12 }}>
                      {fmtAbsTime(snap.created_at)}
                    </td>
                    <td><span className="deck-pill deck-pill-muted">{reasonLabel}</span></td>
                    <td style={{ fontFamily: 'Geist Mono, monospace', fontSize: 12 }}>
                      {snap.agent_instance_id.slice(0, 8)}
                    </td>
                    <td style={{ fontFamily: 'Geist Mono, monospace', fontSize: 12 }}>
                      {snap.id.slice(0, 8)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

function StatusPill({ status }: { status: string }) {
  const cls =
    status === 'running' ? 'deck-pill-ok'
    : status === 'paused' ? 'deck-pill-warn'
    : status === 'ready' ? 'deck-pill-info'
    : status === 'stopped' ? 'deck-pill-bad'
    : 'deck-pill-muted';
  return <span className={`deck-pill ${cls}`}>{status}</span>;
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

function fmtAbsTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

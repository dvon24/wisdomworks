/**
 * Story 3.5 — Agent Lifecycle Management
 *
 * Deploy, pause, restart, update, decommission agents through the UI.
 */

export default function AgentsPage() {
  return (
    <div>
      <h1>Agent Management</h1>
      <p>Deploy, monitor, and manage your AI agent fleet.</p>

      {/* Agent list with status, model routing, and lifecycle controls */}
      <div style={{ marginTop: '2rem' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #444' }}>
              <th style={{ textAlign: 'left', padding: '0.5rem' }}>Agent</th>
              <th style={{ textAlign: 'left', padding: '0.5rem' }}>Role</th>
              <th style={{ textAlign: 'left', padding: '0.5rem' }}>Status</th>
              <th style={{ textAlign: 'left', padding: '0.5rem' }}>Model</th>
              <th style={{ textAlign: 'left', padding: '0.5rem' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr><td colSpan={5} style={{ padding: '2rem', textAlign: 'center' }}>
              Agent fleet will populate from AxisDeploymentSpec — connect to tRPC for live data.
            </td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

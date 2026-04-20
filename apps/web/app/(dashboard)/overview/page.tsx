/**
 * Story 3.2 — Environment Overview & Agent Health
 *
 * System health summary, agent status cards, signal throughput.
 * Auto-refreshes via SSE (Story 0.4).
 */

export default function OverviewPage() {
  return (
    <div>
      <h1>Environment Overview</h1>
      <p>System health, agent status, and signal throughput — coming in Sprint 3 implementation.</p>

      {/* Story 3.2: Health summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginTop: '2rem' }}>
        <div style={{ padding: '1rem', border: '1px solid #444', borderRadius: '8px' }}>
          <h3>Total Agents</h3>
          <p style={{ fontSize: '2rem' }}>—</p>
        </div>
        <div style={{ padding: '1rem', border: '1px solid #444', borderRadius: '8px' }}>
          <h3>Healthy</h3>
          <p style={{ fontSize: '2rem' }}>—</p>
        </div>
        <div style={{ padding: '1rem', border: '1px solid #444', borderRadius: '8px' }}>
          <h3>Signal Throughput</h3>
          <p style={{ fontSize: '2rem' }}>—</p>
        </div>
        <div style={{ padding: '1rem', border: '1px solid #444', borderRadius: '8px' }}>
          <h3>Active Tenants</h3>
          <p style={{ fontSize: '2rem' }}>—</p>
        </div>
      </div>

      {/* Story 3.3: Dashboard views will render here */}
      {/* Story 3.4: Real-time activity feed will render here */}
    </div>
  );
}

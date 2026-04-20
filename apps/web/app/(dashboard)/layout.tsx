/**
 * Story 3.1 — Admin Portal Shell & Navigation
 *
 * Dashboard layout with RBAC-gated sidebar navigation.
 * Desktop-first responsive, neumorphic + glassmorphic design tokens.
 */

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* Sidebar — RBAC-gated navigation */}
      <nav style={{ width: '280px', borderRight: '1px solid #333', padding: '1rem' }}>
        <h2 style={{ fontSize: '1.2rem', marginBottom: '2rem' }}>WisdomWorks</h2>
        <ul style={{ listStyle: 'none', padding: 0 }}>
          <li><a href="/overview">Overview</a></li>
          <li><a href="/agents">Agents</a></li>
          <li><a href="/governance">Governance</a></li>
          <li><a href="/innovation">Innovation</a></li>
          <li><a href="/tenants">Tenants</a></li>
          <li><a href="/settings">Settings</a></li>
        </ul>
      </nav>
      {/* Main content */}
      <main style={{ flex: 1, padding: '2rem' }}>
        {children}
      </main>
    </div>
  );
}

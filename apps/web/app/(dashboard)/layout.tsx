/**
 * Story 3.1 — Admin Portal Shell & Navigation
 *
 * Glass sidebar + main content. Auth-state aware: signed-out users
 * see a "Sign in via WhatsApp" prompt; signed-in users get full
 * navigation with their tenant identity in the sidebar foot.
 */

import Link from 'next/link';
import { getOwnerPhoneFromCookie, fetchTenantIdentity } from './_lib/deck-data';
import './deck.css';

const NAV: Array<{ href: string; label: string; emoji: string }> = [
  { href: '/overview', label: 'Overview', emoji: '🏠' },
  { href: '/activity', label: 'Activity', emoji: '⚡' },
  { href: '/agents', label: 'Agents', emoji: '🤖' },
  { href: '/innovation', label: 'Innovation', emoji: '💡' },
  { href: '/governance', label: 'Governance', emoji: '🛡️' },
  { href: '/tenants', label: 'Tenants', emoji: '👥' },
  { href: '/settings', label: 'Settings', emoji: '⚙️' },
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const phone = await getOwnerPhoneFromCookie();
  const identity = phone ? await fetchTenantIdentity(phone) : null;

  if (!phone) {
    return (
      <div className="deck-shell deck-shell-signedout">
        <main className="deck-main deck-main-empty">
          <div className="glass-strong deck-signin-card">
            <div className="eyebrow">Command Deck</div>
            <h1 className="deck-signin-title">Sign in required</h1>
            <p className="deck-signin-body">
              Open WhatsApp, message your Iris instance, and ask:
            </p>
            <pre className="deck-signin-cmd">"Send me a login link"</pre>
            <p className="deck-signin-body">
              The link sets a 30-day session cookie on this device. No password to remember.
            </p>
          </div>
        </main>
      </div>
    );
  }

  const businessLabel = identity?.businessName ?? identity?.name ?? phone;
  return (
    <div className="deck-shell">
      <aside className="deck-sidebar glass">
        <div className="deck-brand">
          <div className="deck-brand-mark">W</div>
          <div className="deck-brand-text">
            <div className="deck-brand-name">WisdomWorks</div>
            <div className="deck-brand-tag eyebrow">Command Deck</div>
          </div>
        </div>
        <nav className="deck-nav">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className="deck-nav-item">
              <span className="deck-nav-emoji">{item.emoji}</span>
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
        <div className="deck-sidebar-foot">
          <div className="deck-tenant">
            <div className="deck-tenant-name">{businessLabel}</div>
            {identity?.businessType ? (
              <div className="deck-tenant-type eyebrow">{identity.businessType}</div>
            ) : null}
          </div>
        </div>
      </aside>
      <main className="deck-main">{children}</main>
    </div>
  );
}

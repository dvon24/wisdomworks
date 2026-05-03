'use client';

import { useState } from 'react';
import {
  Background,
  WisdomLockup,
  WisdomMark,
  Hierarchy,
  type HierarchyAgent,
} from '@wisdomworks/ui';

/**
 * Command Deck — main operations dashboard.
 *
 * Layout: top nav + KPI strip + main pane (hierarchy or globe) + 380px right sidebar.
 * Sidebar modes: Briefing (Iris chat), Approvals (proposal stack), Activity (event feed).
 */

// Demo data — will be replaced with real tenant data from API
const DEMO_TEAM: HierarchyAgent[] = [
  { id: 'iris', label: 'Iris', role: 'Personal assistant', tier: 'Opus', status: 'ok', required: true },
  { id: 'atlas', label: 'Atlas', role: 'Client manager', tier: 'Opus', status: 'ok' },
  { id: 'vega', label: 'Vega', role: 'Operations', tier: 'Sonnet', status: 'warn' },
  { id: 'juno', label: 'Juno', role: 'Marketing', tier: 'Sonnet', status: 'ok' },
  { id: 'sable', label: 'Sable', role: 'Finance', tier: 'Opus', status: 'ok' },
  { id: 'wren', label: 'Wren', role: 'Research', tier: 'Sonnet', status: 'ok' },
];

const TIER_PRICE = { Haiku: 19, Sonnet: 39, Opus: 79 };

const PROPOSALS = [
  { id: 'p1', agent: 'Vega', sev: 'high' as const, title: 'Reduce Tuesday wasted capacity by 31%', impact: '+€7,200/mo', confidence: 0.86 },
  { id: 'p2', agent: 'Juno + Atlas', sev: 'med' as const, title: 'Re-warm 12 dormant accounts before Q3', impact: '+€34k pipe', confidence: 0.74 },
  { id: 'p3', agent: 'Cedar', sev: 'low' as const, title: 'Standardise contractor MSAs on v4', impact: 'Risk ↓', confidence: 0.93 },
];

const INITIAL_MESSAGES = [
  { from: 'iris' as const, text: 'Good morning. I closed 1,284 small decisions while you slept. Three things genuinely need you today.' },
  { from: 'iris' as const, text: 'First up: Vega found a 31% Tuesday capacity hole. I built the fix — three moves, ready to deploy whenever you\'re ready.' },
];

type SidebarMode = 'briefing' | 'approvals' | 'activity';
type ViewMode = 'overview' | 'team' | 'activity';

export default function CommandDeck() {
  const [team] = useState<HierarchyAgent[]>(DEMO_TEAM);
  const [view, setView] = useState<ViewMode>('team');
  const [sidebar, setSidebar] = useState<SidebarMode>('briefing');
  const [selectedAgent, setSelectedAgent] = useState<HierarchyAgent | null>(null);
  const [messages, setMessages] = useState(INITIAL_MESSAGES);
  const [chatInput, setChatInput] = useState('');

  const totalPrice = team.reduce((sum, a) => sum + (TIER_PRICE[a.tier as keyof typeof TIER_PRICE] || 0), 0);

  const sendMessage = () => {
    if (!chatInput.trim()) return;
    setMessages([...messages, { from: 'user' as const, text: chatInput.trim() } as any]);
    setChatInput('');
    setTimeout(() => {
      setMessages((m) => [...m, { from: 'iris' as const, text: 'Got it. Working on that now.' }]);
    }, 600);
  };

  return (
    <>
      <Background light />

      {/* Top nav */}
      <header
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 30,
          display: 'flex',
          alignItems: 'center',
          padding: '14px 24px',
          gap: 16,
          backdropFilter: 'blur(8px)',
          background: 'rgba(250,249,245,0.6)',
          borderBottom: '1px solid var(--glass-border)',
        }}
      >
        <WisdomLockup size={26} tagline="because it does." accent="var(--accent)" />

        {/* View tabs */}
        <nav style={{ display: 'flex', gap: 4, marginLeft: 32 }}>
          {(['overview', 'team', 'activity'] as ViewMode[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={view === v ? 'btn primary' : 'btn ghost'}
              style={{ fontSize: 12, padding: '6px 14px', textTransform: 'capitalize' }}
            >
              {v}
            </button>
          ))}
        </nav>

        <div style={{ flex: 1 }} />

        <span className="pill info">{PROPOSALS.length} pending</span>
        <button className="btn" style={{ fontSize: 12 }}>
          <span style={{ marginRight: 6 }}>✦</span>
          {team.length} agents · €{totalPrice}/mo
        </button>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: 'var(--accent)',
            color: 'white',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          DR
        </div>
      </header>

      <main
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 380px',
          gap: 16,
          padding: '76px 16px 16px',
          minHeight: '100vh',
        }}
      >
        {/* Main pane */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* KPI strip */}
          <div className="glass-strong" style={{ padding: '1.5rem 2rem', display: 'flex', alignItems: 'baseline', gap: 24 }}>
            <div>
              <div className="eyebrow" style={{ marginBottom: 4 }}>Decisions handled overnight</div>
              <div className="num-xxl">1,284</div>
            </div>
            <div style={{ flex: 1 }} />
            <div style={{ textAlign: 'right' }}>
              <div className="eyebrow" style={{ marginBottom: 4 }}>Today</div>
              <div style={{ fontSize: 14, color: 'var(--text-dim)' }}>
                Atlas, Vega and Sable are talking now
              </div>
            </div>
          </div>

          {/* Hero — hierarchy or detail */}
          {view === 'team' && (
            <div className="glass-strong" style={{ padding: '1.5rem', flex: 1, minHeight: 540 }}>
              <Hierarchy
                width={940}
                height={460}
                team={team}
                principal={{ initials: 'DR', first: 'Devon', role: 'Founder' }}
                showExternals={false}
                showArcs
                accent="var(--accent)"
                onSelect={(agent) => setSelectedAgent(agent)}
              />
            </div>
          )}

          {view === 'overview' && (
            <div className="glass-strong" style={{ padding: '1.5rem', flex: 1, minHeight: 540, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ textAlign: 'center' }}>
                <WisdomMark size={80} accent="var(--accent)" />
                <div className="num-md" style={{ marginTop: 24, fontWeight: 300 }}>3D Intelligence Globe</div>
                <div style={{ color: 'var(--text-dim)', marginTop: 8, fontSize: 14 }}>Coming in next sprint</div>
              </div>
            </div>
          )}

          {view === 'activity' && (
            <div className="glass-strong" style={{ padding: '1.5rem', flex: 1, minHeight: 540 }}>
              <div className="eyebrow" style={{ marginBottom: 16 }}>Live activity feed</div>
              {[
                { agent: 'Atlas', action: 'Replied to ACME inquiry', time: '2 min ago' },
                { agent: 'Vega', action: 'Detected Tuesday capacity gap', time: '14 min ago' },
                { agent: 'Sable', action: 'Processed 47 invoices', time: '32 min ago' },
                { agent: 'Iris', action: 'Drafted morning briefing', time: '1 hr ago' },
              ].map((event, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--glass-border)' }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--accent-soft)', color: 'var(--accent-deep)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 13 }}>
                    {event.agent[0]}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>
                      {event.agent} · <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>{event.action}</span>
                    </div>
                  </div>
                  <div className="mono" style={{ fontSize: 11, color: 'var(--text-faint)' }}>{event.time}</div>
                </div>
              ))}
            </div>
          )}

          {/* Top decision card */}
          {view !== 'activity' && (
            <div className="glass-strong" style={{ padding: 16, display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 16, alignItems: 'center' }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-deep)', fontWeight: 600 }}>
                V
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span className="pill warn">HIGH</span>
                  <span className="mono" style={{ fontSize: 10, color: 'var(--text-faint)' }}>VEGA · 86% CONFIDENCE</span>
                </div>
                <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 3 }}>{PROPOSALS[0]?.title}</div>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.45 }}>
                  Three moves ready to deploy. <span className="mono" style={{ color: 'var(--accent-deep)' }}>{PROPOSALS[0]?.impact}</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn">Modify</button>
                <button className="btn ghost">Dismiss</button>
                <button className="btn primary">Approve</button>
              </div>
            </div>
          )}
        </section>

        {/* Right sidebar */}
        <aside className="glass-strong" style={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 92px)' }}>
          {/* Sidebar tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--glass-border)', padding: 8 }}>
            {(['briefing', 'approvals', 'activity'] as SidebarMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setSidebar(mode)}
                className={sidebar === mode ? 'btn primary' : 'btn ghost'}
                style={{ flex: 1, fontSize: 11.5, padding: '6px', textTransform: 'capitalize' }}
              >
                {mode}
              </button>
            ))}
          </div>

          {sidebar === 'briefing' && (
            <>
              <header style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--glass-border)' }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 600 }} className="breathe">
                  ✦
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>Iris</div>
                  <div className="mono" style={{ fontSize: 10, color: 'var(--text-faint)' }}>Personal · also on WhatsApp</div>
                </div>
              </header>
              <div className="scroll" style={{ flex: 1, padding: 16, display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
                {messages.map((m, i) => {
                  const isUser = (m as any).from === 'user';
                  return (
                    <div
                      key={i}
                      style={{
                        maxWidth: '82%',
                        padding: '10px 14px',
                        borderRadius: 14,
                        fontSize: 13,
                        lineHeight: 1.5,
                        background: isUser ? 'var(--accent)' : 'rgba(255,255,255,0.78)',
                        color: isUser ? 'white' : 'var(--text)',
                        borderTopRightRadius: isUser ? 4 : 14,
                        borderTopLeftRadius: isUser ? 14 : 4,
                        alignSelf: isUser ? 'flex-end' : 'flex-start',
                        border: isUser ? 'none' : '1px solid var(--glass-border)',
                      }}
                    >
                      {(m as any).text}
                    </div>
                  );
                })}
              </div>
              <div style={{ display: 'flex', gap: 8, padding: 12, borderTop: '1px solid var(--glass-border)' }}>
                <input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                  placeholder="Try: 'add a recruiter' or 'show me the metrics'"
                  style={{
                    flex: 1,
                    background: 'rgba(255,255,255,0.5)',
                    border: '1px solid var(--glass-border)',
                    borderRadius: 10,
                    padding: '10px 12px',
                    outline: 0,
                    fontSize: 13,
                    fontFamily: 'inherit',
                  }}
                />
                <button onClick={sendMessage} className="btn primary" style={{ fontSize: 12 }}>Send</button>
              </div>
            </>
          )}

          {sidebar === 'approvals' && (
            <div className="scroll" style={{ flex: 1, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {PROPOSALS.map((p) => (
                <div key={p.id} style={{ padding: 14, background: 'rgba(255,255,255,0.5)', border: '1px solid var(--glass-border)', borderRadius: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span className={`pill ${p.sev === 'high' ? 'warn' : p.sev === 'med' ? 'info' : 'ok'}`}>
                      {p.sev.toUpperCase()}
                    </span>
                    <span className="mono" style={{ fontSize: 10, color: 'var(--text-faint)' }}>{p.agent.toUpperCase()}</span>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6, lineHeight: 1.4 }}>{p.title}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--accent-deep)' }}>{p.impact}</span>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>{Math.round(p.confidence * 100)}%</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn ghost" style={{ flex: 1, fontSize: 11, padding: '5px 8px', justifyContent: 'center' }}>Dismiss</button>
                    <button className="btn primary" style={{ flex: 1, fontSize: 11, padding: '5px 8px', justifyContent: 'center' }}>Approve</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {sidebar === 'activity' && (
            <div className="scroll" style={{ flex: 1, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { agent: 'Atlas', action: 'Replied to ACME', time: '2m' },
                { agent: 'Vega', action: 'Found capacity gap', time: '14m' },
                { agent: 'Sable', action: '47 invoices processed', time: '32m' },
                { agent: 'Iris', action: 'Briefing drafted', time: '1h' },
                { agent: 'Juno', action: 'Instagram post scheduled', time: '2h' },
              ].map((e, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px', fontSize: 12 }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--ok)' }} />
                  <span style={{ fontWeight: 500 }}>{e.agent}</span>
                  <span style={{ flex: 1, color: 'var(--text-dim)' }}>{e.action}</span>
                  <span className="mono" style={{ fontSize: 10, color: 'var(--text-faint)' }}>{e.time}</span>
                </div>
              ))}
            </div>
          )}
        </aside>
      </main>
    </>
  );
}

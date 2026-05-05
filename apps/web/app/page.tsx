'use client';

import { useState } from 'react';
import {
  Background,
  WisdomLockup,
  WisdomMark,
  Hierarchy,
  ActionCard,
  PriceDiff,
  type HierarchyAgent,
  type ActionCardData,
} from '@wisdomworks/ui';
import {
  parseIntent,
  generateIntentReply,
  intentPriceDelta,
  type ActiveAgent,
} from '@wisdomworks/shared';

/**
 * Command Deck — main operations dashboard.
 *
 * Layout: top nav + KPI strip + main pane (hierarchy or globe) + 380px right sidebar.
 * Sidebar modes: Briefing (Iris chat), Approvals (proposal stack), Activity (event feed).
 */

// Demo data — will be replaced with real tenant data from API
const DEMO_TEAM: HierarchyAgent[] = [
  { id: 'iris', label: 'Iris', role: 'Personal assistant', tier: 'Opus', status: 'ok', required: true },
  {
    id: 'atlas',
    label: 'Atlas',
    role: 'Client manager',
    tier: 'Opus',
    status: 'ok',
    subTeam: {
      count: 5,
      label: 'Account managers',
      agents: [
        { id: 'atl1', label: 'Noor', role: 'ACME lead', tier: 'Sonnet' },
        { id: 'atl2', label: 'Bram', role: 'Patagonia lead', tier: 'Sonnet' },
        { id: 'atl3', label: 'Inez', role: 'Hinrich lead', tier: 'Sonnet' },
        { id: 'atl4', label: 'Theo', role: 'New business', tier: 'Opus' },
        { id: 'atl5', label: 'Saoirse', role: 'Renewals', tier: 'Haiku' },
      ],
    },
  },
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

type SidebarMode = 'briefing' | 'approvals' | 'activity' | 'agent';
type ViewMode = 'overview' | 'team' | 'activity';

export default function CommandDeck() {
  const [team, setTeam] = useState<HierarchyAgent[]>(DEMO_TEAM);
  const [view, setView] = useState<ViewMode>('team');
  const [sidebar, setSidebar] = useState<SidebarMode>('briefing');
  const [selectedAgent, setSelectedAgent] = useState<HierarchyAgent | null>(null);
  const [focusedSubTeam, setFocusedSubTeam] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>(INITIAL_MESSAGES);
  const [chatInput, setChatInput] = useState('');
  const [actions, setActions] = useState<ActionCardData[]>([]);
  const [priceDiff, setPriceDiff] = useState<{ delta: number; total: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const calculateTotalPrice = (currentTeam: HierarchyAgent[]) => {
    let total = 0;
    for (const a of currentTeam) {
      if (a.tier) total += TIER_PRICE[a.tier as keyof typeof TIER_PRICE] || 0;
      if (a.subTeam) {
        for (const sub of a.subTeam.agents) {
          if (sub.tier) total += TIER_PRICE[sub.tier as keyof typeof TIER_PRICE] || 0;
        }
        const listed = a.subTeam.agents.length;
        if (a.subTeam.count > listed) {
          total += (a.subTeam.count - listed) * TIER_PRICE.Haiku;
        }
      }
    }
    return total;
  };

  const totalPrice = calculateTotalPrice(team);

  const sendMessage = () => {
    if (!chatInput.trim()) return;
    const userText = chatInput.trim();
    setMessages([...messages, { from: 'user' as const, text: userText }]);
    setChatInput('');

    // Try local intent parsing first
    const activeTeam: ActiveAgent[] = team.map((a) => ({
      id: a.id,
      label: a.label,
      role: a.role,
      tier: a.tier,
      required: a.required,
    }));
    const intent = parseIntent(userText, activeTeam);

    if (intent && intent.kind !== 'question') {
      const reply = generateIntentReply(intent) ?? 'Got it.';
      setTimeout(() => setMessages((m) => [...m, { from: 'iris' as const, text: reply }]), 400);

      const delta = intentPriceDelta(intent);
      const action: ActionCardData = {
        id: `act-${Date.now()}`,
        kind: intent.kind,
        agentId: intent.kind === 'add' ? intent.agent.id : (intent as any).agent.id,
        agentLabel: intent.kind === 'add' ? intent.agent.label : (intent as any).agent.label,
        agentRole: intent.kind === 'add' ? intent.agent.role : (intent as any).agent.role,
        delta,
        note:
          intent.kind === 'add'
            ? intent.agent.desc
            : intent.kind === 'remove'
              ? `Pause ${(intent as any).agent.label} — work archived`
              : '',
        fromTier: intent.kind === 'tier' ? intent.fromTier : undefined,
        toTier: intent.kind === 'tier' ? intent.toTier : undefined,
        newName: intent.kind === 'rename' ? intent.newName : undefined,
        status: 'pending',
      };
      setActions((prev) => [...prev, action]);
      return;
    }

    // Free-form response (placeholder for now)
    setTimeout(() => {
      setMessages((m) => [...m, { from: 'iris' as const, text: 'Got it. Working on that now.' }]);
    }, 600);
  };

  const acceptAction = (actionId: string) => {
    const action = actions.find((a) => a.id === actionId);
    if (!action) return;

    const before = totalPrice;
    setTeam((prev) => {
      let next = [...prev];
      if (action.kind === 'add') {
        next.push({
          id: action.agentId ?? `agent-${Date.now()}`,
          label: action.agentLabel,
          role: action.agentRole,
          tier: (action.toTier ?? 'Sonnet') as any,
          status: 'ok',
        });
      } else if (action.kind === 'remove' && action.agentId) {
        next = next.filter((a) => a.id !== action.agentId);
      } else if (action.kind === 'tier' && action.agentId) {
        next = next.map((a) => (a.id === action.agentId ? { ...a, tier: action.toTier as any } : a));
      } else if (action.kind === 'rename' && action.agentId && action.newName) {
        next = next.map((a) => (a.id === action.agentId ? { ...a, label: action.newName! } : a));
      }
      const after = calculateTotalPrice(next);
      const delta = after - before;
      if (delta !== 0) setPriceDiff({ delta, total: after });
      return next;
    });

    setActions((prev) => prev.map((a) => (a.id === actionId ? { ...a, status: 'accepted' as const } : a)));
    setTimeout(() => setMessages((m) => [...m, { from: 'iris' as const, text: 'Done. I\'ll keep watching.' }]), 700);
  };

  const rejectAction = (actionId: string) => {
    setActions((prev) => prev.map((a) => (a.id === actionId ? { ...a, status: 'rejected' as const } : a)));
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
                onSelect={(agent) => {
                  setSelectedAgent(agent);
                  setSidebar('agent');
                }}
                focusedSubTeam={focusedSubTeam}
                onSubTeamOpen={(parentId) => setFocusedSubTeam(parentId)}
                onSubTeamClose={() => setFocusedSubTeam(null)}
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
          <div style={{ display: 'flex', borderBottom: '1px solid var(--glass-border)', padding: 8, gap: 4 }}>
            {((['briefing', 'approvals', 'activity'] as SidebarMode[])).map((mode) => (
              <button
                key={mode}
                onClick={() => setSidebar(mode)}
                className={sidebar === mode ? 'btn primary' : 'btn ghost'}
                style={{ flex: 1, fontSize: 11.5, padding: '6px', textTransform: 'capitalize' }}
              >
                {mode}
              </button>
            ))}
            {selectedAgent && (
              <button
                onClick={() => setSidebar('agent')}
                className={sidebar === 'agent' ? 'btn primary' : 'btn ghost'}
                style={{ flex: 1, fontSize: 11.5, padding: '6px' }}
              >
                {selectedAgent.label}
              </button>
            )}
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
                  const isLast = i === messages.length - 1;
                  return (
                    <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start', gap: 6 }}>
                      <div
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
                          border: isUser ? 'none' : '1px solid var(--glass-border)',
                        }}
                      >
                        {(m as any).text}
                      </div>
                      {/* Render action cards after the most recent assistant message */}
                      {!isUser && isLast && actions.map((action) => (
                        <ActionCard
                          key={action.id}
                          action={action}
                          currencySymbol="€"
                          onAccept={() => acceptAction(action.id)}
                          onReject={() => rejectAction(action.id)}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
              <div style={{ display: 'flex', gap: 8, padding: 12, borderTop: '1px solid var(--glass-border)' }}>
                <input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                  placeholder="Try: 'add a recruiter', 'rename Atlas to Maya', 'remove Cedar'"
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

          {sidebar === 'agent' && selectedAgent && (
            <div className="scroll" style={{ flex: 1, padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    background: selectedAgent.id === 'iris' ? 'var(--accent)' : 'rgba(255,255,255,0.7)',
                    color: selectedAgent.id === 'iris' ? 'white' : 'var(--text)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 600,
                    fontSize: 16,
                    border: '1px solid var(--glass-border)',
                  }}
                >
                  {selectedAgent.id === 'iris' ? '✦' : selectedAgent.label[0]}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>{selectedAgent.label}</div>
                    {selectedAgent.subTeam && (
                      <span className="pill info" style={{ fontSize: 9 }}>Manages {selectedAgent.subTeam.count}</span>
                    )}
                  </div>
                  <div className="mono" style={{ fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.15em', marginTop: 2 }}>
                    {selectedAgent.role}
                  </div>
                </div>
              </div>

              {/* Status */}
              {selectedAgent.status && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-dim)' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: selectedAgent.status === 'ok' ? 'var(--ok)' : selectedAgent.status === 'warn' ? 'var(--warn)' : 'var(--bad)' }} />
                  {selectedAgent.status === 'ok' ? 'Operating normally' : selectedAgent.status === 'warn' ? 'Needs attention' : 'Has issues'}
                </div>
              )}

              {/* Sub-team roster */}
              {selectedAgent.subTeam && (
                <div style={{ padding: 12, background: 'var(--accent-soft)', border: '1px solid var(--accent-line)', borderRadius: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span className="eyebrow" style={{ color: 'var(--accent-deep)' }}>{selectedAgent.subTeam.label}</span>
                    <button
                      onClick={() => setFocusedSubTeam(selectedAgent.id)}
                      className="btn ghost"
                      style={{ fontSize: 10, padding: '3px 8px', color: 'var(--accent-deep)' }}
                    >
                      View team →
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {selectedAgent.subTeam.agents.slice(0, 5).map((sub) => (
                      <div key={sub.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                        <div style={{ width: 20, height: 20, borderRadius: 6, background: 'rgba(255,255,255,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 10, border: '1px solid var(--glass-border)' }}>
                          {sub.label[0]}
                        </div>
                        <span style={{ fontWeight: 500 }}>{sub.label}</span>
                        <span style={{ color: 'var(--text-faint)' }}>·</span>
                        <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>{sub.role}</span>
                        {sub.tier && (
                          <span className="mono" style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--accent-deep)' }}>{sub.tier}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Tier + price */}
              {selectedAgent.tier && (
                <div style={{ padding: 12, background: 'rgba(255,255,255,0.5)', border: '1px solid var(--glass-border)', borderRadius: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span className="eyebrow">Model</span>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--accent-deep)' }}>
                      {selectedAgent.tier} · €{TIER_PRICE[selectedAgent.tier as keyof typeof TIER_PRICE]}/mo
                    </span>
                  </div>
                </div>
              )}

              <button
                onClick={() => {
                  setSelectedAgent(null);
                  setSidebar('briefing');
                }}
                className="btn ghost"
                style={{ fontSize: 11, justifyContent: 'center' }}
              >
                Close
              </button>
            </div>
          )}
        </aside>
      </main>

      {/* Floating price diff toast — slides up when team changes */}
      {priceDiff && (
        <PriceDiff
          delta={priceDiff.delta}
          total={priceDiff.total}
          currencySymbol="€"
          onDismiss={() => setPriceDiff(null)}
        />
      )}
    </>
  );
}

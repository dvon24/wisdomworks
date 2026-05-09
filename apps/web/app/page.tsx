'use client';

import { useEffect, useRef, useState } from 'react';
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
type ViewMode = 'overview' | 'team' | 'activity' | 'connections';

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

  // Real tenant data loaded from /api/dashboard
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null);
  const [tenantData, setTenantData] = useState<any>(null);
  const [loadingTenant, setLoadingTenant] = useState(true);
  // Map of id → rich AI metadata (description, channels, tools, strengths, limitations, emoji)
  const [teamMeta, setTeamMeta] = useState<Record<string, any>>({});

  // Convert raw profile.team[] from /api/dashboard or /api/chat into hierarchy + meta
  function convertTeam(rawTeam: any[]): { team: HierarchyAgent[]; meta: Record<string, any> } {
    const meta: Record<string, any> = {};
    const team: HierarchyAgent[] = rawTeam.map((a: any, i: number) => {
      const id = (a.name || `agent-${i}`).toLowerCase().replace(/\s+/g, '-');
      meta[id] = {
        emoji: a.emoji,
        description: a.description,
        channels: a.channels ?? [],
        tools: a.tools ?? [],
        strengths: a.strengths ?? [],
        limitations: a.limitations ?? [],
        aiModel: a.aiModel,
      };
      if (i === 0) meta['iris'] = meta[id];
      const model = (a.aiModel || a.tier || '').toString().toLowerCase();
      const tier: 'Opus' | 'Sonnet' | 'Haiku' = model.includes('opus') ? 'Opus' : model.includes('haiku') ? 'Haiku' : 'Sonnet';
      const base: HierarchyAgent = i === 0
        ? { id: 'iris', label: a.name || 'Iris', role: a.role || 'Personal assistant', tier: 'Opus' as const, status: 'ok', required: true }
        : { id, label: a.name || `Agent ${i + 1}`, role: a.role || 'Specialist', tier, status: 'ok' as const };

      const subAgents = a.subTeam?.agents ?? [];
      const subCount = a.subTeam?.count ?? subAgents.length;
      if (subCount > 0) {
        base.subTeam = {
          count: subCount,
          label: a.subTeam?.label || `${a.name}'s team`,
          agents: subAgents.map((sub: any, j: number) => ({
            id: sub.id || `${id}-sub-${j}`,
            label: sub.name || `Specialist ${j + 1}`,
            role: sub.role || 'Specialist',
            tier: ((sub.tier || sub.aiModel || '').toString().toLowerCase().includes('opus') ? 'Opus' :
                  (sub.tier || sub.aiModel || '').toString().toLowerCase().includes('haiku') ? 'Haiku' : 'Sonnet') as any,
          })),
        };
      }
      return base;
    });
    return { team, meta };
  }

  // Load tenant data on mount — phone from URL param or localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const phone = params.get('phone') || localStorage.getItem('wisdomworks_phone');
    if (!phone) {
      setLoadingTenant(false);
      return;
    }
    setPhoneNumber(phone);
    localStorage.setItem('wisdomworks_phone', phone);

    fetch(`/api/dashboard?phone=${encodeURIComponent(phone)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          console.warn('[command-deck] No tenant data:', data.error);
          setLoadingTenant(false);
          return;
        }
        setTenantData(data);

        // Convert saved AI team into HierarchyAgent shape and capture rich metadata
        if (data.team && Array.isArray(data.team) && data.team.length > 0) {
          const { team, meta } = convertTeam(data.team);
          setTeam(team);
          setTeamMeta(meta);
        }

        // Use first message from Iris if no real history
        if (data.user?.businessName) {
          setMessages([
            {
              from: 'iris' as const,
              text: `Good morning, ${data.user.name?.split(' ')[0] ?? 'there'}. Welcome to your Command Deck. I'm here to help you run ${data.user.businessName}.`,
            },
          ]);
        }
      })
      .catch((e) => console.error('[command-deck] Load failed:', e))
      .finally(() => setLoadingTenant(false));
  }, []);

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

  const [chatBusy, setChatBusy] = useState(false);
  // Connection form state
  const [connForm, setConnForm] = useState<null | 'yahoo' | 'apple'>(null);
  const [connEmail, setConnEmail] = useState('');
  const [connPassword, setConnPassword] = useState('');
  const [connError, setConnError] = useState('');
  const [connBusy, setConnBusy] = useState(false);
  const [connSuccess, setConnSuccess] = useState<string | null>(null);
  const [connDebug, setConnDebug] = useState<{ url: string; status: number | string; body: string } | null>(null);
  const connFormRef = useRef<HTMLDivElement>(null);

  // Scroll the form into view + focus the email input the moment a provider is picked
  useEffect(() => {
    if (connForm && connFormRef.current) {
      connFormRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const emailInput = connFormRef.current.querySelector('input[type="email"]') as HTMLInputElement | null;
      setTimeout(() => emailInput?.focus(), 300);
    }
  }, [connForm]);

  // Find which team member owns a given service (email/calendar/instagram).
  // Looks at each agent's channels/tools/role metadata; falls back to the personal assistant.
  function findOwnerAgent(service: string): { name: string; role: string } | null {
    const team = tenantData?.team ?? [];
    if (team.length === 0) return null;
    const svc = service.toLowerCase();
    const match = (a: any) => {
      const haystack = [
        ...(a.channels ?? []),
        ...(a.tools ?? []),
        a.role ?? '',
        a.description ?? '',
      ].join(' ').toLowerCase();
      if (svc === 'email') return haystack.includes('email') || haystack.includes('mail');
      if (svc === 'calendar') return haystack.includes('calendar') || haystack.includes('schedul');
      if (svc === 'instagram') return haystack.includes('instagram') || haystack.includes('social') || haystack.includes('content');
      return false;
    };
    // Skip the personal assistant (index 0) when searching — they're the fallback
    const owner = team.slice(1).find(match);
    if (owner) return { name: owner.name, role: owner.role };
    return { name: team[0]?.name ?? 'Sophia', role: team[0]?.role ?? 'Personal Assistant' };
  }

  const isProviderConnected = (provider: string, service?: string): boolean => {
    return (tenantData?.connections ?? []).some(
      (c: any) => c.provider === provider && (!service || c.service === service),
    );
  };

  const submitConnection = async (provider: 'yahoo' | 'apple') => {
    const url = `/api/connections/${provider}`;
    if (!phoneNumber) {
      setConnError('No phone identified — open the deck via the website button or add ?phone=... to the URL.');
      setConnDebug({ url, status: 'not sent', body: 'phoneNumber state is empty' });
      return;
    }
    setConnError('');
    setConnDebug(null);
    setConnBusy(true);
    let status: number | string = 'no response';
    let bodyText = '';
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phoneNumber, email: connEmail, appPassword: connPassword }),
      });
      status = res.status;
      bodyText = await res.text();
      let data: any;
      try { data = JSON.parse(bodyText); } catch { data = { error: bodyText }; }
      setConnDebug({ url, status, body: bodyText.slice(0, 800) });
      if (!res.ok || !data.success) {
        setConnError(data.error || `Connection failed (HTTP ${status})`);
        return;
      }
      // Re-fetch dashboard so the new connection appears in tenantData.connections
      const refreshed = await fetch(`/api/dashboard?phone=${encodeURIComponent(phoneNumber)}`).then((r) => r.json());
      if (!refreshed.error) setTenantData(refreshed);
      setConnForm(null);
      setConnEmail('');
      setConnPassword('');
      // Show a 3-second success banner so the user knows it landed
      setConnSuccess(`${provider === 'yahoo' ? 'Yahoo Mail' : 'Apple iCloud'} connected — ${data.accountEmail}`);
      setTimeout(() => setConnSuccess(null), 3500);
    } catch (err) {
      setConnError(String(err));
      setConnDebug({ url, status, body: String(err) });
    } finally {
      setConnBusy(false);
    }
  };

  const sendMessage = async () => {
    if (!chatInput.trim() || chatBusy) return;
    const userText = chatInput.trim();
    setMessages((m) => [...m, { from: 'user' as const, text: userText }]);
    setChatInput('');

    // Local intent parsing only for structural mutations the AI shouldn't deliberate on:
    // rename + tier changes are deterministic. add/remove route to the AI so the
    // manager-consultation flow can run.
    const activeTeam: ActiveAgent[] = team.map((a) => ({
      id: a.id,
      label: a.label,
      role: a.role,
      tier: a.tier,
      required: a.required,
    }));
    const intent = parseIntent(userText, activeTeam);

    const SKIP_LOCAL_KINDS = new Set(['add', 'remove']);
    if (intent && intent.kind !== 'question' && !SKIP_LOCAL_KINDS.has(intent.kind)) {
      const reply = generateIntentReply(intent) ?? 'Got it.';
      setTimeout(() => setMessages((m) => [...m, { from: 'iris' as const, text: reply }]), 300);

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

    // Free-form: hand it to the real Iris brain
    if (!phoneNumber) {
      setMessages((m) => [...m, { from: 'iris' as const, text: "I don't know who you are yet — open the deck via the website's Open-Command-Deck button so I can load your context." }]);
      return;
    }
    setChatBusy(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phoneNumber, message: userText, name: tenantData?.user?.name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'chat failed');
      setMessages((m) => [...m, { from: 'iris' as const, text: data.reply || '...' }]);
      // If the brain mutated the team, re-render the hierarchy from the fresh team
      if (Array.isArray(data.team) && data.team.length > 0) {
        const { team: fresh, meta } = convertTeam(data.team);
        setTeam(fresh);
        setTeamMeta(meta);
      }
    } catch (err) {
      console.error('[deck-chat] Error:', err);
      setMessages((m) => [...m, { from: 'iris' as const, text: "I hit a snag answering that. Try again?" }]);
    } finally {
      setChatBusy(false);
    }
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
          {(['overview', 'team', 'activity', 'connections'] as ViewMode[]).map((v) => (
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

        <span className="pill info">{tenantData?.pendingEmailDrafts?.length ?? 0} pending</span>
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
          position: 'relative',
          zIndex: 1,
          display: 'grid',
          gridTemplateColumns: '1fr 380px',
          gap: 16,
          padding: '76px 16px 16px',
          minHeight: '100vh',
        }}
      >
        {/* Main pane */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* KPI strip — only on Team tab (Overview stays clean) */}
          {view === 'team' && (
          <div className="glass-strong" style={{ padding: '1.25rem 2rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 20, alignItems: 'baseline' }}>
            <div>
              <div className="eyebrow" style={{ marginBottom: 4 }}>Business</div>
              <div className="num-md" style={{ fontSize: 22, fontWeight: 400 }}>
                {tenantData?.user?.businessName ?? (loadingTenant ? '…' : 'Not connected')}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
                {tenantData?.user?.businessType ?? '—'}
              </div>
            </div>
            <div>
              <div className="eyebrow" style={{ marginBottom: 4 }}>Today's events</div>
              <div className="num-md" style={{ fontSize: 28, fontWeight: 300 }}>{tenantData?.todaysCalendar?.length ?? 0}</div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
                {tenantData?.todaysCalendar?.[0]?.title?.slice(0, 28) ?? 'no events'}
              </div>
            </div>
            <div>
              <div className="eyebrow" style={{ marginBottom: 4 }}>Drafts pending</div>
              <div className="num-md" style={{ fontSize: 28, fontWeight: 300 }}>{tenantData?.pendingEmailDrafts?.length ?? 0}</div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
                {tenantData?.pendingEmailDrafts?.length ? 'awaiting review' : 'inbox clear'}
              </div>
            </div>
            <div>
              <div className="eyebrow" style={{ marginBottom: 4 }}>Connections</div>
              <div className="num-md" style={{ fontSize: 28, fontWeight: 300 }}>{tenantData?.connections?.length ?? 0}</div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
                {tenantData?.connections?.map((c: any) => c.provider).join(' · ') || 'none yet'}
              </div>
            </div>
            <div>
              <div className="eyebrow" style={{ marginBottom: 4 }}>Iris messages</div>
              <div className="num-md" style={{ fontSize: 28, fontWeight: 300 }}>{tenantData?.messageCount ?? 0}</div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>via WhatsApp</div>
            </div>
          </div>
          )}

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
                  if (agent.subTeam) {
                    // Top-level manager: toggle zoom into their sub-team
                    setFocusedSubTeam((current) => (current === agent.id ? null : agent.id));
                  } else if (focusedSubTeam) {
                    // Already zoomed into a sub-team — clicking a member should NOT zoom out.
                    // Detect: is the clicked agent part of the focused sub-team's roster?
                    const focusedManager = team.find((m) => m.id === focusedSubTeam);
                    const isSubMember = focusedManager?.subTeam?.agents.some((s) => s.id === agent.id);
                    if (!isSubMember) setFocusedSubTeam(null);
                    // else: leave focus alone, just show the sub-agent in the sidebar
                  } else {
                    setFocusedSubTeam(null);
                  }
                }}
                focusedSubTeam={focusedSubTeam}
                onSubTeamOpen={(parentId) => setFocusedSubTeam(parentId)}
                onSubTeamClose={() => setFocusedSubTeam(null)}
              />
            </div>
          )}

          {view === 'overview' && (
            <div className="glass-strong" style={{ padding: '1.5rem', flex: 1, minHeight: 540, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ textAlign: 'center', marginBottom: 4 }}>
                <div className="eyebrow" style={{ marginBottom: 4 }}>Your AI team</div>
                <div className="num-md" style={{ fontSize: 22, fontWeight: 300 }}>
                  {tenantData?.user?.businessName ?? (loadingTenant ? '…' : 'Welcome')}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>
                  Chat with Iris on the right. Open <span style={{ color: 'var(--accent-deep)', fontWeight: 500 }}>Team</span> to dive into any agent.
                </div>
              </div>
              <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Hierarchy
                  width={940}
                  height={460}
                  team={team}
                  principal={{
                    initials: (tenantData?.user?.businessName ?? 'You').split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase(),
                    first: tenantData?.user?.businessName?.split(' ')[0] ?? 'You',
                    role: 'Owner',
                  }}
                  showExternals={false}
                  showArcs
                  accent="var(--accent)"
                />
              </div>
            </div>
          )}

          {view === 'activity' && (
            <div className="glass-strong" style={{ padding: '1.5rem', flex: 1, minHeight: 540 }}>
              <div className="eyebrow" style={{ marginBottom: 16 }}>Live activity feed</div>
              {tenantData?.activity?.length > 0 ? (
                tenantData.activity.map((event: any, i: number) => (
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
                ))
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 400, gap: 8 }}>
                  <div style={{ fontSize: 14, color: 'var(--text-dim)' }}>No activity yet</div>
                  <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>
                    Once your agents start working — sending emails, drafting replies, syncing calendar — you'll see it here.
                  </div>
                </div>
              )}
            </div>
          )}

          {view === 'connections' && (
            <div className="glass-strong" style={{ padding: '1.5rem', flex: 1, minHeight: 540, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <div className="eyebrow" style={{ marginBottom: 4 }}>Connected services</div>
                <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                  Each connection is owned by the agent whose role fits it. Email goes to whoever handles your inbox; calendar to whoever handles scheduling.
                </div>
              </div>

              {/* Success banner */}
              {connSuccess && (
                <div className="glass" style={{ padding: '10px 14px', background: 'rgba(44, 176, 112, 0.12)', border: '1px solid rgba(44, 176, 112, 0.4)', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 18, color: '#15803d' }}>✓</span>
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{connSuccess}</span>
                </div>
              )}

              {/* Already-connected list */}
              {tenantData?.connections?.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {tenantData.connections.map((c: any, i: number) => {
                    const owner = findOwnerAgent(c.service);
                    return (
                      <div key={i} className="glass" style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(44, 176, 112, 0.06)', border: '1px solid rgba(44, 176, 112, 0.25)' }}>
                        <span style={{ fontSize: 18, color: '#15803d' }}>✓</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>
                            {c.provider === 'google' ? 'Google' : c.provider === 'microsoft' ? 'Microsoft' : c.provider === 'apple' ? 'Apple iCloud' : c.provider === 'yahoo' ? 'Yahoo Mail' : c.provider}
                            <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}> · {c.service}</span>
                          </div>
                          <div style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>{c.accountEmail}</div>
                          {owner && (
                            <div style={{ fontSize: 10.5, color: 'var(--accent-deep)', marginTop: 3, fontWeight: 500 }}>
                              Owned by {owner.name} · {owner.role}
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => {
                            if (c.provider === 'yahoo' || c.provider === 'apple') {
                              setConnForm(c.provider);
                              setConnEmail(c.accountEmail || '');
                              setConnPassword('');
                              setConnError('');
                            }
                          }}
                          className="btn ghost"
                          style={{ fontSize: 11 }}
                        >
                          Reconnect
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Add new — provider grid */}
              <div className="eyebrow">Add a service</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                {(() => {
                  const renderProviderCard = (
                    provider: 'yahoo' | 'apple' | 'google' | 'microsoft',
                    label: string,
                    icon: string,
                    sub: string,
                    service: 'email' | 'calendar',
                    onClick: () => void,
                    isLink?: string,
                  ) => {
                    const connected = isProviderConnected(provider, service);
                    const baseStyle: any = {
                      padding: 14,
                      textAlign: 'left',
                      cursor: connected ? 'default' : 'pointer',
                      border: connected ? '1px solid rgba(44, 176, 112, 0.4)' : '1px solid var(--glass-border)',
                      background: connected ? 'rgba(44, 176, 112, 0.08)' : undefined,
                      opacity: connected ? 0.85 : 1,
                      display: 'block',
                      textDecoration: 'none',
                      color: 'inherit',
                    };
                    const inner = (
                      <>
                        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                          {icon} {label}
                          {connected && <span style={{ marginLeft: 'auto', fontSize: 11, color: '#15803d', fontWeight: 600 }}>✓ Connected</span>}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{connected ? 'Already connected — use Reconnect above to update.' : sub}</div>
                      </>
                    );
                    if (isLink && !connected) {
                      return <a href={isLink} className="glass" style={baseStyle}>{inner}</a>;
                    }
                    return (
                      <button onClick={connected ? undefined : onClick} disabled={connected} className="glass" style={baseStyle}>
                        {inner}
                      </button>
                    );
                  };
                  return (
                    <>
                      {renderProviderCard('yahoo', 'Yahoo Mail', '🟣', 'IMAP read access via app password.', 'email', () => { setConnForm('yahoo'); setConnEmail(''); setConnPassword(''); setConnError(''); })}
                      {renderProviderCard('apple', 'Apple iCloud', '⚫', 'CalDAV calendar via app password.', 'calendar', () => { setConnForm('apple'); setConnEmail(''); setConnPassword(''); setConnError(''); })}
                      {renderProviderCard('google', 'Google', '🟦', 'Gmail + Calendar via OAuth (one click).', 'email', () => {}, phoneNumber ? `http://localhost:3001/api/oauth/google?phone=${encodeURIComponent(phoneNumber)}` : undefined)}
                      {renderProviderCard('microsoft', 'Microsoft', '🟧', 'Outlook + Calendar via OAuth.', 'email', () => {}, phoneNumber ? `http://localhost:3001/api/oauth/microsoft?phone=${encodeURIComponent(phoneNumber)}` : undefined)}
                    </>
                  );
                })()}
              </div>

              {/* Inline form — auto-scrolls into view when opened */}
              {connForm && (
                <div ref={connFormRef} className="glass-strong" style={{ padding: 18, marginTop: 12, border: '2px solid var(--accent)', boxShadow: '0 8px 24px rgba(124, 58, 237, 0.15)', scrollMarginTop: 100 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10, color: 'var(--accent-deep)' }}>
                    {connForm === 'yahoo' ? '🟣 Connect Yahoo Mail' : '⚫ Connect Apple iCloud'} — Step 2 of 2
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginBottom: 12, lineHeight: 1.5 }}>
                    {connForm === 'yahoo' ? (
                      <>
                        1. Open <a href="https://login.yahoo.com/account/security" target="_blank" rel="noopener" style={{ color: 'var(--accent-deep)', textDecoration: 'underline' }}>login.yahoo.com → Account Security</a><br/>
                        2. Generate app password → name it "WisdomWorks"<br/>
                        3. Paste the 16-character password below
                      </>
                    ) : (
                      <>
                        1. Open <a href="https://appleid.apple.com" target="_blank" rel="noopener" style={{ color: 'var(--accent-deep)', textDecoration: 'underline' }}>appleid.apple.com</a> → Account Security<br/>
                        2. Generate app-specific password → name it "WisdomWorks"<br/>
                        3. Paste the 16-character password (xxxx-xxxx-xxxx-xxxx)
                      </>
                    )}
                  </div>
                  <input
                    type="email"
                    placeholder={connForm === 'yahoo' ? 'your@yahoo.com' : 'your@icloud.com'}
                    value={connEmail}
                    onChange={(e) => setConnEmail(e.target.value)}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--glass-border-strong)', background: 'rgba(255,255,255,0.65)', fontSize: 13, marginBottom: 8, fontFamily: 'inherit' }}
                  />
                  <input
                    type="password"
                    placeholder={connForm === 'yahoo' ? 'xxxxxxxxxxxxxxxx' : 'xxxx-xxxx-xxxx-xxxx'}
                    value={connPassword}
                    onChange={(e) => setConnPassword(e.target.value)}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--glass-border-strong)', background: 'rgba(255,255,255,0.65)', fontSize: 13, fontFamily: 'monospace', marginBottom: 8 }}
                  />
                  {connError && <div style={{ fontSize: 13, color: '#c2410c', fontWeight: 500, padding: '8px 10px', background: 'rgba(194, 65, 12, 0.08)', borderRadius: 8, marginBottom: 8, lineHeight: 1.4 }}>⚠ {connError}</div>}
                  {connDebug && (
                    <div style={{ fontSize: 11, fontFamily: 'monospace', padding: 10, background: 'rgba(0,0,0,0.06)', border: '1px dashed var(--glass-border-strong)', borderRadius: 8, marginBottom: 8, lineHeight: 1.5 }}>
                      <div><strong>POST</strong> {connDebug.url}</div>
                      <div><strong>Status:</strong> {connDebug.status}</div>
                      <div><strong>Phone sent:</strong> {phoneNumber || '(none)'}</div>
                      <div style={{ marginTop: 6, wordBreak: 'break-word', maxHeight: 120, overflow: 'auto' }}><strong>Response:</strong> {connDebug.body || '(empty)'}</div>
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => submitConnection(connForm)} disabled={connBusy} className="btn primary" style={{ flex: 1, fontSize: 12, justifyContent: 'center' }}>
                      {connBusy ? 'Connecting…' : 'Connect'}
                    </button>
                    <button onClick={() => { setConnForm(null); setConnError(''); }} className="btn ghost" style={{ fontSize: 12 }}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Bottom row of real cards — Team tab only (Overview stays clean) */}
          {view === 'team' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {/* Today's schedule */}
              <div className="glass-strong" style={{ padding: 16, minHeight: 160 }}>
                <div className="eyebrow" style={{ marginBottom: 10 }}>Today's schedule</div>
                {tenantData?.todaysCalendar?.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {tenantData.todaysCalendar.slice(0, 5).map((e: any) => {
                      const time = new Date(e.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                      return (
                        <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 13, padding: '5px 0', borderBottom: '1px solid var(--glass-border)' }}>
                          <span className="mono" style={{ fontSize: 11, color: 'var(--accent-deep)', minWidth: 60 }}>{time}</span>
                          <span style={{ flex: 1, fontWeight: 500 }}>{e.title}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: 'var(--text-faint)', padding: '8px 0' }}>
                    {tenantData?.connections?.some((c: any) => c.service === 'calendar')
                      ? 'No events today.'
                      : 'Connect your calendar to see today\'s schedule here.'}
                  </div>
                )}
              </div>

              {/* Connected services */}
              <div className="glass-strong" style={{ padding: 16, minHeight: 160 }}>
                <div className="eyebrow" style={{ marginBottom: 10 }}>Connected services</div>
                {tenantData?.connections?.length > 0 ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {tenantData.connections.map((c: any, i: number) => (
                      <span key={i} className="pill ok" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                        ✓ {c.provider} {c.service}
                        {c.accountEmail && <span style={{ opacity: 0.65 }}>· {c.accountEmail}</span>}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: 'var(--text-faint)', padding: '8px 0' }}>
                    No tools connected yet — head back to onboarding to wire up Gmail, Calendar, etc.
                  </div>
                )}
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
              {tenantData?.activity?.length > 0 ? (
                tenantData.activity.map((e: any, i: number) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px', fontSize: 12 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--ok)' }} />
                    <span style={{ fontWeight: 500 }}>{e.agent}</span>
                    <span style={{ flex: 1, color: 'var(--text-dim)' }}>{e.action}</span>
                    <span className="mono" style={{ fontSize: 10, color: 'var(--text-faint)' }}>{e.time}</span>
                  </div>
                ))
              ) : (
                <div style={{ fontSize: 12, color: 'var(--text-faint)', padding: '12px 4px', lineHeight: 1.5 }}>
                  No activity yet. Once your agents start working — drafting emails, syncing calendar — you'll see it here.
                </div>
              )}
            </div>
          )}

          {sidebar === 'agent' && selectedAgent && (() => {
            const meta = teamMeta[selectedAgent.id] ?? {};
            return (
            <div className="scroll" style={{ flex: 1, padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    background: selectedAgent.id === 'iris' ? 'var(--accent)' : 'rgba(255,255,255,0.7)',
                    color: selectedAgent.id === 'iris' ? 'white' : 'var(--text)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 600,
                    fontSize: meta.emoji ? 22 : 16,
                    border: '1px solid var(--glass-border)',
                  }}
                >
                  {meta.emoji || (selectedAgent.id === 'iris' ? '✦' : selectedAgent.label[0])}
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

              {/* Description */}
              {meta.description && (
                <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                  {meta.description}
                </div>
              )}

              {/* Status */}
              {selectedAgent.status && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-dim)' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: selectedAgent.status === 'ok' ? 'var(--ok)' : selectedAgent.status === 'warn' ? 'var(--warn)' : 'var(--bad)' }} />
                  {selectedAgent.status === 'ok' ? 'Operating normally' : selectedAgent.status === 'warn' ? 'Needs attention' : 'Has issues'}
                </div>
              )}

              {/* Channels */}
              {meta.channels?.length > 0 && (
                <div style={{ padding: 12, background: 'rgba(255,255,255,0.5)', border: '1px solid var(--glass-border)', borderRadius: 12 }}>
                  <div className="eyebrow" style={{ marginBottom: 6 }}>📡 Talks via</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {meta.channels.map((c: string, i: number) => (
                      <span key={i} className="pill" style={{ fontSize: 10 }}>{c}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Tools */}
              {meta.tools?.length > 0 && (
                <div style={{ padding: 12, background: 'rgba(255,255,255,0.5)', border: '1px solid var(--glass-border)', borderRadius: 12 }}>
                  <div className="eyebrow" style={{ marginBottom: 6 }}>🔗 Connects to</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {meta.tools.map((t: string, i: number) => (
                      <span key={i} className="pill" style={{ fontSize: 10 }}>{t}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Strengths */}
              {meta.strengths?.length > 0 && (
                <div style={{ padding: 12, background: 'rgba(34, 197, 94, 0.08)', border: '1px solid rgba(34, 197, 94, 0.25)', borderRadius: 12 }}>
                  <div className="eyebrow" style={{ marginBottom: 6, color: '#15803d' }}>✓ Strengths</div>
                  <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.6 }}>
                    {meta.strengths.map((s: string, i: number) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Limitations */}
              {meta.limitations?.length > 0 && (
                <div style={{ padding: 12, background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.25)', borderRadius: 12 }}>
                  <div className="eyebrow" style={{ marginBottom: 6, color: '#b45309' }}>△ Limitations</div>
                  <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.6 }}>
                    {meta.limitations.map((l: string, i: number) => (
                      <li key={i}>{l}</li>
                    ))}
                  </ul>
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
            );
          })()}
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

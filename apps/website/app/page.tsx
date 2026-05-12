'use client';

import { useState, useRef, useEffect } from 'react';
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
  type CatalogAgent,
} from '@wisdomworks/shared';
import ConnectTools from './components/ConnectTools';
import ExamplePreview from './components/ExamplePreview';

/** Render AI markdown as clean readable JSX — bold, bullets, numbered lists */
function formatMessage(text: string): React.ReactNode {
  if (!text) return null;
  const lines = text.split('\n');
  return lines.map((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) return <br key={i} />;
    const renderBold = (str: string) => {
      const parts = str.split(/\*\*(.*?)\*\*/g);
      return parts.map((part, j) => (j % 2 === 1 ? <strong key={j}>{part}</strong> : part));
    };
    if (trimmed.startsWith('•') || (trimmed.startsWith('- ') && !trimmed.startsWith('---'))) {
      const content = trimmed.replace(/^[•\-]\s*/, '');
      return (
        <div key={i} style={{ paddingLeft: '1.2rem', marginBottom: '0.25rem', display: 'flex', gap: '0.4rem' }}>
          <span style={{ color: 'var(--accent)' }}>•</span>
          <span>{renderBold(content)}</span>
        </div>
      );
    }
    if (/^\d+\.\s/.test(trimmed)) {
      const num = trimmed.match(/^(\d+)\.\s/)?.[1];
      const content = trimmed.replace(/^\d+\.\s*/, '');
      return (
        <div key={i} style={{ paddingLeft: '0.8rem', marginBottom: '0.25rem', display: 'flex', gap: '0.4rem' }}>
          <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{num}.</span>
          <span>{renderBold(content)}</span>
        </div>
      );
    }
    return <div key={i} style={{ marginBottom: '0.15rem' }}>{renderBold(trimmed)}</div>;
  });
}

const TIER_PRICE = { Haiku: 19, Sonnet: 39, Opus: 79 };

function pickTier(raw: any): 'Opus' | 'Sonnet' | 'Haiku' {
  const m = (raw || '').toString().toLowerCase();
  if (m.includes('opus')) return 'Opus';
  if (m.includes('haiku')) return 'Haiku';
  return 'Sonnet';
}

// Curated pool of friendly, modern, gender-neutral agent names.
// Used when AI returns a role-as-name (e.g. "Patient Experience Coordinator") instead of a real name.
const AGENT_NAME_POOL = [
  'Atlas', 'Sable', 'Juno', 'Vega', 'Wren', 'Cedar', 'Orin', 'Mira',
  'Sage', 'River', 'Quinn', 'Avery', 'Rowan', 'Sky', 'Emery', 'Kai',
  'Nova', 'Phoenix', 'Reese', 'Indigo', 'Lark', 'Vale', 'Ember', 'Cove',
  'Ash', 'Linden', 'Marlow', 'Tate', 'Sloane', 'Briar', 'Onyx', 'Pax',
  'Lux', 'Wynn', 'Echo', 'Rune', 'Eden', 'Auden', 'Soren', 'Astrid',
  'Holland', 'Elliot', 'Finley', 'Hadley', 'Iver', 'June', 'Kit', 'Lane',
];

/** Detects when AI returned a generic role-as-name (e.g. "Patient Experience Coordinator", "Marketing Manager") */
function looksLikeRoleNotName(name: string): boolean {
  if (!name) return true;
  // If multiple words, contains words like Coordinator/Manager/Specialist/Lead/Department/Team
  const lower = name.toLowerCase();
  const roleWords = ['coordinator', 'manager', 'specialist', 'lead', 'department', 'team', 'agent', 'assistant', 'director', 'analyst', 'monitor'];
  if (roleWords.some((w) => lower.includes(w))) return true;
  // Or if it has 3+ words (real names are usually 1-2 words)
  if (name.split(/\s+/).length >= 3) return true;
  return false;
}

/** Get the next unused name from the pool, given a Set of names already used */
function nextAvailableName(used: Set<string>, seed: number): string {
  let i = seed;
  for (let tries = 0; tries < AGENT_NAME_POOL.length; tries++) {
    const name = AGENT_NAME_POOL[(i + tries) % AGENT_NAME_POOL.length]!;
    if (!used.has(name.toLowerCase())) {
      used.add(name.toLowerCase());
      return name;
    }
  }
  // Fallback if all names exhausted (very rare)
  return `Aide ${seed + 1}`;
}

/** Map AI-suggested agents to the Hierarchy component shape — preserves sub-team structure */
function mapToHierarchyAgents(structuredAgents: any[]): HierarchyAgent[] {
  if (!structuredAgents?.length) {
    return [{ id: 'iris', label: 'Iris', role: 'Personal assistant', tier: 'Opus', status: 'ok', required: true }];
  }

  // Track all used names (start with Iris) to avoid duplicates
  const usedNames = new Set<string>(['iris']);

  return structuredAgents.map((a: any, i: number) => {
    // Iris (first agent) is always the personal assistant
    if (i === 0) {
      const irisName = a.name && !looksLikeRoleNotName(a.name) ? a.name : 'Iris';
      usedNames.add(irisName.toLowerCase());
      return { id: 'iris', label: irisName, role: a.role || 'Personal assistant', tier: 'Opus' as const, status: 'ok' as const, required: true };
    }

    // Determine name: use AI's name if it's actually a name, otherwise pick from pool
    let label: string;
    let role: string;
    if (a.name && !looksLikeRoleNotName(a.name)) {
      label = a.name;
      role = a.role || 'Specialist';
      usedNames.add(label.toLowerCase());
    } else {
      // AI returned a role-as-name → keep the role, generate a friendly name
      label = nextAvailableName(usedNames, i);
      role = a.name || a.role || 'Specialist';
    }

    const id = label.toLowerCase().replace(/\s+/g, '-');
    const tier = pickTier(a.aiModel ?? a.tier);
    const base: HierarchyAgent = { id, label, role, tier, status: 'ok' as const };

    // Pass through sub-team if AI returned one
    if (a.subTeam && typeof a.subTeam === 'object' && a.subTeam.count > 0) {
      base.subTeam = {
        count: a.subTeam.count,
        label: a.subTeam.label || 'Specialists',
        agents: (a.subTeam.agents ?? []).map((sub: any, j: number) => {
          let subLabel: string;
          let subRole: string;
          if (sub.name && !looksLikeRoleNotName(sub.name)) {
            subLabel = sub.name;
            subRole = sub.role || a.subTeam.label || 'Specialist';
            usedNames.add(subLabel.toLowerCase());
          } else {
            subLabel = nextAvailableName(usedNames, j + i * 7);
            subRole = sub.role || a.subTeam.label || 'Specialist';
          }
          return {
            id: `${id}-${subLabel.toLowerCase()}`,
            label: subLabel,
            role: subRole,
            tier: pickTier(sub.tier ?? sub.aiModel),
          };
        }),
      };
    }
    return base;
  });
}

/** Calculate total monthly price from structured agent data + tierCounts */
function calculateTotalPrice(structured: any): number {
  // Prefer AI's tierCounts (includes all sub-agents) for accuracy
  if (structured?.tierCounts) {
    const { opus = 0, sonnet = 0, haiku = 0 } = structured.tierCounts;
    return opus * TIER_PRICE.Opus + sonnet * TIER_PRICE.Sonnet + haiku * TIER_PRICE.Haiku;
  }
  // Fallback: count visible agents + their sub-team agents
  const agents = mapToHierarchyAgents(structured?.agents ?? []);
  let total = 0;
  for (const a of agents) {
    if (a.tier) total += TIER_PRICE[a.tier as keyof typeof TIER_PRICE] || 0;
    if (a.subTeam) {
      for (const sub of a.subTeam.agents) {
        if (sub.tier) total += TIER_PRICE[sub.tier as keyof typeof TIER_PRICE] || 0;
      }
      // If subTeam.count > listed agents, fill the rest at Haiku rate (default for employees)
      const listed = a.subTeam.agents.length;
      if (a.subTeam.count > listed) {
        total += (a.subTeam.count - listed) * TIER_PRICE.Haiku;
      }
    }
  }
  return total;
}

export default function HomePage() {
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([
    {
      role: 'assistant',
      content: "Welcome. I'm here to build your AI team. Tell me about your business — what do you do?",
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showConnectTools, setShowConnectTools] = useState(false);
  const [hasPaid, setHasPaid] = useState(false);
  const [agentsDeployed, setAgentsDeployed] = useState(false);
  const [businessName, setBusinessName] = useState('');
  const [structuredData, setStructuredData] = useState<any>(null);
  // Story 1.7/1.8 — formal AxisDeploymentSpec preview
  const [deploymentPreview, setDeploymentPreview] = useState<any>(null);
  const [inputPlaceholder, setInputPlaceholder] = useState('Describe your business...');
  const [showExample, setShowExample] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('iris');
  const [showRefineChat, setShowRefineChat] = useState(false);
  const [focusedSubTeam, setFocusedSubTeam] = useState<string | null>(null);
  const [refineActions, setRefineActions] = useState<ActionCardData[]>([]);
  const [priceDiff, setPriceDiff] = useState<{ delta: number; total: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [agentOverrides, setAgentOverrides] = useState<Record<string, string>>({});
  const [showPriceBreakdown, setShowPriceBreakdown] = useState(false);
  // Vertical-template picker (shown before the chat begins; chosen template
  // seeds the suggestion pills and agent roster preview)
  const [verticalTemplates, setVerticalTemplates] = useState<any[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<any | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load template catalog once on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    fetch('/api/templates')
      .then((r) => r.ok ? r.json() : { templates: [] })
      .then((d) => setVerticalTemplates(d.templates ?? []))
      .catch(() => setVerticalTemplates([]));
  }, []);

  // Restore state if returning from Stripe payment OR from an OAuth provider
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const isReturningFromStripe = params.get('paid') === 'true';
    const isReturningFromOAuth = params.has('oauth'); // success | denied | error

    if (isReturningFromStripe || isReturningFromOAuth) {
      // Restore the saved onboarding state so we don't drop back to the chat
      try {
        const saved = localStorage.getItem('wisdomworks_onboarding');
        if (saved) {
          const data = JSON.parse(saved);
          if (data.structuredData) setStructuredData(data.structuredData);
          if (data.businessName) setBusinessName(data.businessName);
          if (data.messages) setMessages(data.messages);
        }
      } catch (e) {
        console.error('Failed to restore onboarding data:', e);
      }

      // Stash the Stripe checkout session_id so deploy-complete can verify it
      const sid = params.get('session_id');
      if (sid) {
        try { localStorage.setItem('wisdomworks_stripe_session', sid); } catch {}
      }

      // Stripe + OAuth flows both happen post-payment, so always treat as paid
      setHasPaid(true);
      setShowConnectTools(true);
      setShowPreview(true);

      // Keep oauth=success params so ConnectTools can read them and show "Connected"
      // Strip only the paid param when present
      if (isReturningFromStripe && !isReturningFromOAuth) {
        window.history.replaceState({}, '', '/');
      }
    }
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    const userText = input.trim();
    const userMsg = { role: 'user' as const, content: userText };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');

    // If we're in the refine chat (post-preview), try local intent parsing first
    if (showPreview && structuredData?.agents?.length > 0) {
      const activeTeam: ActiveAgent[] = mapToHierarchyAgents(structuredData.agents).map((a) => ({
        id: a.id,
        label: a.label,
        role: a.role,
        tier: a.tier,
        required: a.required,
      }));
      const intent = parseIntent(userText, activeTeam);
      if (intent && intent.kind !== 'question') {
        // Local intent — generate Iris reply + action card without API call
        const reply = generateIntentReply(intent) ?? 'Got it.';
        setMessages([...newMessages, { role: 'assistant', content: reply }]);
        const delta = intentPriceDelta(intent);
        const action: ActionCardData = {
          id: `act-${Date.now()}`,
          kind: intent.kind,
          agentId:
            intent.kind === 'add'
              ? intent.agent.id
              : (intent as any).agent.id,
          agentLabel:
            intent.kind === 'add'
              ? intent.agent.label
              : (intent as any).agent.label,
          agentRole:
            intent.kind === 'add'
              ? intent.agent.role
              : (intent as any).agent.role,
          delta,
          note:
            intent.kind === 'add'
              ? intent.agent.desc
              : intent.kind === 'remove'
                ? `Pause ${(intent as any).agent.label} — work archived, can re-add anytime`
                : '',
          fromTier: intent.kind === 'tier' ? intent.fromTier : undefined,
          toTier: intent.kind === 'tier' ? intent.toTier : undefined,
          newName: intent.kind === 'rename' ? intent.newName : undefined,
          status: 'pending',
        };
        setRefineActions((prev) => [...prev, action]);
        return;
      }
    }

    // Otherwise: send to AI for free-form response (questions, complex requests)
    setIsLoading(true);
    try {
      const res = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages,
          collectedData: structuredData ?? {},
          verticalTemplate: selectedTemplate ? {
            id: selectedTemplate.id,
            label: selectedTemplate.label,
            defaultAgents: selectedTemplate.defaultAgents,
            recommendedTools: selectedTemplate.recommendedTools,
          } : undefined,
        }),
      });
      const data = await res.json();
      if (data.text) {
        setMessages([...newMessages, { role: 'assistant', content: data.text }]);
      }
      if (data.structured) {
        setStructuredData(data.structured);
        if (data.structured.businessName) setBusinessName(data.structured.businessName);
        if (data.structured.inputPlaceholder) setInputPlaceholder(data.structured.inputPlaceholder);
        if (data.structured.showAgentPreview && !showPreview && data.structured.agents?.length > 0) {
          setTimeout(() => setShowPreview(true), 800);
        }
      }
      // Story 1.7/1.8 — formal spec preview from generateDeploymentSpec
      if (data.preview) setDeploymentPreview(data.preview);
    } catch (err) {
      console.error('Onboarding error:', err);
      setMessages([...newMessages, { role: 'assistant', content: 'Hmm, I had a moment. Could you try again?' }]);
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Apply an accepted action card — modify structuredData to add/remove/tier-change/rename agents.
   * Then show the price diff toast.
   */
  const acceptAction = (actionId: string) => {
    const action = refineActions.find((a) => a.id === actionId);
    if (!action) return;

    const before = totalPrice;
    setStructuredData((prev: any) => {
      if (!prev) return prev;
      const agents = [...(prev.agents ?? [])];

      if (action.kind === 'add') {
        // Add a new top-level agent
        agents.push({
          name: action.agentLabel,
          role: action.agentRole,
          aiModel: action.toTier ?? 'Sonnet',
          description: action.note,
          channels: ['WhatsApp'],
          tools: [],
          strengths: [],
          limitations: [],
        });
      } else if (action.kind === 'remove' && action.agentId) {
        // Remove by id (after mapping)
        const target = mapToHierarchyAgents(prev.agents).find((a) => a.id === action.agentId);
        if (target) {
          // Remove from raw agents by name match
          const idx = agents.findIndex((a: any) => a.name === target.label || a.name === action.agentLabel);
          if (idx >= 0) agents.splice(idx, 1);
        }
      } else if (action.kind === 'tier' && action.agentId) {
        const target = mapToHierarchyAgents(prev.agents).find((a) => a.id === action.agentId);
        if (target) {
          const idx = agents.findIndex((a: any) => a.name === target.label || a.name === action.agentLabel);
          if (idx >= 0) agents[idx] = { ...agents[idx], aiModel: action.toTier };
        }
      } else if (action.kind === 'rename' && action.agentId && action.newName) {
        // Add to overrides — same as click-to-rename
        setAgentOverrides((prev) => ({ ...prev, [action.agentId!]: action.newName! }));
      }

      // Recalculate tierCounts
      const tierCounts = { opus: 0, sonnet: 0, haiku: 0 };
      agents.forEach((a: any) => {
        const t = pickTier(a.aiModel ?? a.tier).toLowerCase() as 'opus' | 'sonnet' | 'haiku';
        tierCounts[t]++;
        if (a.subTeam?.agents) {
          a.subTeam.agents.forEach((sub: any) => {
            const st = pickTier(sub.tier ?? sub.aiModel).toLowerCase() as 'opus' | 'sonnet' | 'haiku';
            tierCounts[st]++;
          });
          if (a.subTeam.count > a.subTeam.agents.length) {
            const fillerTier = pickTier(a.aiModel).toLowerCase() as 'opus' | 'sonnet' | 'haiku';
            tierCounts[fillerTier] += a.subTeam.count - a.subTeam.agents.length;
          }
        }
      });

      return { ...prev, agents, tierCounts };
    });

    // Mark action as accepted
    setRefineActions((prev) => prev.map((a) => (a.id === actionId ? { ...a, status: 'accepted' as const } : a)));

    // Show price diff toast (defer to next tick so totalPrice updates)
    setTimeout(() => {
      const after = calculateTotalPrice(structuredData);
      const delta = after - before;
      if (delta !== 0) setPriceDiff({ delta, total: after });
    }, 100);

    // Iris confirmation message
    setTimeout(() => {
      setMessages((prev) => [...prev, { role: 'assistant', content: 'Done. I\'ll keep watching.' }]);
    }, 700);
  };

  const rejectAction = (actionId: string) => {
    setRefineActions((prev) => prev.map((a) => (a.id === actionId ? { ...a, status: 'rejected' as const } : a)));
  };

  const handleStartTrial = async () => {
    const s = structuredData ?? {};
    const agents = mapToHierarchyAgents(s.agents ?? []);
    // Tier-based pricing
    const monthlyPrice = calculateTotalPrice(s);
    const currency = s.location?.currency?.toLowerCase() || 'eur';

    // Save state before redirect
    localStorage.setItem(
      'wisdomworks_onboarding',
      JSON.stringify({
        structuredData,
        businessName: businessName || s.businessName || 'Your Business',
        messages,
      }),
    );

    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          monthlyPrice,
          businessName: businessName || s.businessName || 'Your Business',
          agentCount: agents.length,
          currency,
        }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      console.error('Checkout error:', err);
      setShowConnectTools(true);
    }
  };

  const s = structuredData ?? {};
  const rawHierarchyAgents = mapToHierarchyAgents(s.agents ?? []);
  // Apply user renames
  const hierarchyAgents = rawHierarchyAgents.map((a) => ({
    ...a,
    label: agentOverrides[a.id] ?? a.label,
    subTeam: a.subTeam
      ? {
          ...a.subTeam,
          agents: a.subTeam.agents.map((sub) => ({
            ...sub,
            label: agentOverrides[sub.id] ?? sub.label,
          })),
        }
      : undefined,
  }));
  const totalPrice = calculateTotalPrice(s);
  // Total agents = parent agents + all sub-agents
  const totalAgentCount = hierarchyAgents.reduce(
    (sum, a) => sum + 1 + (a.subTeam?.count ?? 0),
    0,
  );
  const currencySymbol = s.location?.currencySymbol || '€';

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
          zIndex: 20,
          display: 'flex',
          alignItems: 'center',
          padding: '14px 24px',
          gap: 12,
        }}
      >
        <WisdomLockup size={28} tagline="because it does." accent="var(--accent)" />
        <div style={{ flex: 1 }} />
      </header>

      <main
        style={{
          position: 'relative',
          minHeight: '100vh',
          paddingTop: 100,
          paddingBottom: 100,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '2rem',
          zIndex: 1,
        }}
      >
        {/* PHASE 1: Conversation */}
        {!showPreview && (
          <div style={{ width: '100%', maxWidth: 720, padding: '0 24px' }}>
            <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
              <div className="eyebrow" style={{ marginBottom: 14 }}>Self-deploying AI · runs your business 24/7</div>
              <div className="num-xxl" style={{ color: 'var(--text)' }}>
                Tell us what you need.
              </div>
              <div style={{ marginTop: 14, fontSize: 16, color: 'var(--text-dim)' }}>
                AI builds it. AI runs it. AI improves it.
              </div>
            </div>

            <div className="glass-strong pop-in" style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 14, boxShadow: '0 24px 80px rgba(20,20,40,0.18)' }}>
              {/* Chat header */}
              <header style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div className="breathe" style={{ width: 30, height: 30, borderRadius: 9, background: 'var(--accent)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600 }}>✦</div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Iris · onboarding</div>
                  <div className="mono" style={{ fontSize: 10, color: 'var(--text-faint)' }}>~3 min · no account needed yet</div>
                </div>
                <span style={{ flex: 1 }} />
                <span className="pill info">Free to start</span>
              </header>

              {/* Messages */}
              <div className="scroll" style={{ minHeight: 180, maxHeight: '40vh', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {messages.map((msg, i) => (
                  <div
                    key={i}
                    style={{
                      alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                      maxWidth: '82%',
                      padding: '10px 14px',
                      borderRadius: 14,
                      background: msg.role === 'user' ? 'var(--accent)' : 'rgba(255,255,255,0.85)',
                      color: msg.role === 'user' ? 'white' : 'var(--text)',
                      borderTopRightRadius: msg.role === 'user' ? 4 : 14,
                      borderTopLeftRadius: msg.role === 'user' ? 14 : 4,
                      fontSize: 13.5,
                      lineHeight: 1.55,
                      border: msg.role === 'user' ? 'none' : '1px solid var(--glass-border)',
                    }}
                  >
                    {formatMessage(msg.content)}
                  </div>
                ))}
                {isLoading && (
                  <div style={{ alignSelf: 'flex-start', padding: '10px 14px', borderRadius: 14, background: 'rgba(255,255,255,0.85)', border: '1px solid var(--glass-border)' }}>
                    <span style={{ opacity: 0.5, animation: 'pulse 1.5s infinite', fontSize: 13 }}>thinking…</span>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Vertical-type picker — only on first message, never blocks free-form
                  typing. Click a template → seeds the pills + nudges the chat to
                  that vertical. */}
              {messages.length <= 1 && verticalTemplates.length > 0 && !selectedTemplate && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 4 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Or pick what closest fits your business
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {verticalTemplates.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => {
                          setSelectedTemplate(t);
                          // Nudge the chat to acknowledge the choice
                          const greeting = `I run a ${t.label.toLowerCase()} business`;
                          setInput(greeting);
                          setTimeout(() => handleSend(), 50);
                        }}
                        className="btn"
                        title={t.tagline}
                        style={{
                          fontSize: 12,
                          padding: '8px 12px',
                          background: 'rgba(255,255,255,0.55)',
                          border: '1px solid var(--glass-border)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                        }}
                      >
                        <span style={{ fontSize: 14 }}>{t.emoji}</span>
                        <span>{t.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Selected-template confirmation strip */}
              {selectedTemplate && messages.length <= 1 && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 12px',
                  background: 'rgba(0, 122, 255, 0.08)',
                  border: '1px solid rgba(0, 122, 255, 0.2)',
                  borderRadius: 10,
                  fontSize: 12,
                }}>
                  <span style={{ fontSize: 18 }}>{selectedTemplate.emoji}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500 }}>{selectedTemplate.label} setup</div>
                    <div style={{ color: 'var(--text-dim)', fontSize: 11.5 }}>
                      {selectedTemplate.defaultAgents.length} agents recommended · {selectedTemplate.tagline}
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedTemplate(null)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-faint)',
                      fontSize: 11,
                      cursor: 'pointer',
                      textDecoration: 'underline',
                    }}
                  >
                    change
                  </button>
                </div>
              )}

              {/* Starter suggestions — only show before user has sent any messages.
                  If a vertical template is selected, use its onboardingPills; else
                  fall back to the generic mix. */}
              {messages.length <= 1 && (() => {
                const pills = (selectedTemplate?.onboardingPills as string[] | undefined) ?? [
                  'I run an auto repair shop',
                  'Solo brand designer',
                  '20-person dental practice',
                  'Yoga studio · 3 locations',
                ];
                return (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {pills.map((s) => (
                      <button
                        key={s}
                        className="btn"
                        style={{ fontSize: 11.5, padding: '6px 12px', background: 'rgba(255,255,255,0.5)' }}
                        onClick={() => {
                          setInput(s);
                          setTimeout(() => handleSend(), 50);
                        }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                );
              })()}

              {/* Input */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', borderTop: '1px solid var(--glass-border)', paddingTop: 14 }}>
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                  placeholder={inputPlaceholder || 'Describe your business…'}
                  style={{
                    flex: 1,
                    background: 'rgba(255,255,255,0.55)',
                    border: '1px solid var(--glass-border)',
                    borderRadius: 12,
                    padding: '12px 14px',
                    outline: 0,
                    fontSize: 14,
                    fontFamily: 'inherit',
                    color: 'var(--text)',
                  }}
                />
                <button onClick={handleSend} disabled={isLoading || !input.trim()} className="btn primary">
                  Send
                </button>
              </div>
            </div>

            {/* Trust footer + example toggle */}
            <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
              <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>
                No account needed to start · Your AI team deploys in minutes
              </div>
              <button
                onClick={() => setShowExample(!showExample)}
                className="btn ghost"
                style={{ fontSize: 12, padding: '6px 14px' }}
              >
                {showExample ? '✕ Hide example' : 'See an example team →'}
              </button>
            </div>
          </div>
        )}

        {/* Example preview — only shown when user clicks "See an example" */}
        {!showPreview && showExample && <ExamplePreview />}

        {/* PHASE 2: Agent Hierarchy Preview (pre-payment) */}
        {showPreview && !hasPaid && (() => {
          const TIER_PRICE_LOCAL = { Haiku: 19, Sonnet: 39, Opus: 79 };
          const TIER_DESC_LOCAL = {
            Haiku: 'Fastest, lowest cost',
            Sonnet: 'Day-to-day reasoning',
            Opus: 'Critical reasoning, planning',
          };
          // Find the selected agent in the hierarchy + matching AI agent data for description
          const selected = hierarchyAgents.find((a) => a.id === selectedAgentId) ?? hierarchyAgents[0];
          const aiAgents = s.agents ?? [];
          const selectedDetail = selected
            ? aiAgents.find((a: any) => (a.name || '').toLowerCase().replace(/\s+/g, '-') === selected.id || a.name === selected.label) ?? aiAgents[hierarchyAgents.indexOf(selected)]
            : null;

          return (
          <div style={{ width: '100%', maxWidth: 1400, padding: '0 24px' }}>
            <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
              <div className="eyebrow" style={{ marginBottom: 12 }}>Your AI Team</div>
              <div className="num-lg" style={{ color: 'var(--text)', fontWeight: 300 }}>
                {totalAgentCount} agents, ready to deploy.
              </div>
              <div style={{ marginTop: 8, color: 'var(--text-dim)', fontSize: 14 }}>
                {businessName || s.businessName || 'Your business'} · {currencySymbol}{totalPrice}/month total
              </div>
              <div style={{ marginTop: 6, color: 'var(--text-faint)', fontSize: 12 }}>
                Click any agent to see what they do
              </div>
            </div>

            <div
              className="glass-strong"
              style={{
                display: 'grid',
                gridTemplateColumns: '1.6fr 1fr',
                gap: 0,
                overflow: 'hidden',
                boxShadow: '0 24px 60px rgba(20, 20, 40, 0.16)',
              }}
            >
              {/* Hierarchy */}
              <div style={{ padding: '24px 12px', borderRight: '1px solid var(--glass-border)', minHeight: 540 }}>
                <Hierarchy
                  width={1080}
                  height={540}
                  team={hierarchyAgents}
                  principal={{
                    initials: (businessName || 'You').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase(),
                    first: businessName?.split(' ')[0] || 'You',
                    role: 'Owner',
                  }}
                  showExternals={false}
                  showArcs
                  accent="var(--accent)"
                  onSelect={(agent) => setSelectedAgentId(agent.id)}
                  focusedSubTeam={focusedSubTeam}
                  onSubTeamOpen={(parentId) => setFocusedSubTeam(parentId)}
                  onSubTeamClose={() => setFocusedSubTeam(null)}
                />
              </div>

              {/* Agent detail panel */}
              <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 16, minHeight: 540 }}>
                <div className="eyebrow">Selected agent</div>
                {selected && (
                  <div key={selected.id} style={{ display: 'flex', flexDirection: 'column', gap: 14, animation: 'fadeIn 0.3s ease' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: 12,
                          background: selected.id === 'iris' ? 'var(--accent)' : 'rgba(255,255,255,0.7)',
                          color: selected.id === 'iris' ? 'white' : 'var(--text)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 600,
                          fontSize: 18,
                          border: '1px solid var(--glass-border)',
                        }}
                      >
                        {selected.id === 'iris' ? '✦' : selected.label[0]}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {renamingId === selected.id ? (
                            <input
                              autoFocus
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onBlur={() => {
                                if (renameValue.trim()) {
                                  setAgentOverrides((prev) => ({ ...prev, [selected.id]: renameValue.trim() }));
                                }
                                setRenamingId(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  if (renameValue.trim()) {
                                    setAgentOverrides((prev) => ({ ...prev, [selected.id]: renameValue.trim() }));
                                  }
                                  setRenamingId(null);
                                }
                                if (e.key === 'Escape') setRenamingId(null);
                              }}
                              style={{
                                fontSize: 17,
                                fontWeight: 600,
                                background: 'rgba(124,58,237,0.08)',
                                border: '1px solid var(--accent-line)',
                                borderRadius: 6,
                                padding: '2px 8px',
                                outline: 'none',
                                fontFamily: 'inherit',
                                color: 'var(--text)',
                                width: 200,
                              }}
                            />
                          ) : (
                            <button
                              onClick={() => {
                                setRenameValue(selected.label);
                                setRenamingId(selected.id);
                              }}
                              style={{
                                fontSize: 17,
                                fontWeight: 600,
                                background: 'transparent',
                                border: 'none',
                                cursor: 'pointer',
                                padding: 0,
                                color: 'var(--text)',
                                fontFamily: 'inherit',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 6,
                              }}
                              title="Click to rename"
                            >
                              {selected.label}
                              <span style={{ fontSize: 11, color: 'var(--text-faint)', opacity: 0.6 }}>✎</span>
                            </button>
                          )}
                          {selected.subTeam && (
                            <span className="pill info" style={{ fontSize: 10 }}>
                              Manages {selected.subTeam.count}
                            </span>
                          )}
                        </div>
                        <div className="mono" style={{ fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.15em', marginTop: 2 }}>
                          {selected.role}
                        </div>
                      </div>
                    </div>

                    {/* Description from AI's structured data */}
                    {selectedDetail?.description && (
                      <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6 }}>{selectedDetail.description}</div>
                    )}

                    {/* Sub-team roster — show who reports to this agent */}
                    {selected.subTeam && (
                      <div style={{ padding: 12, background: 'var(--accent-soft)', border: '1px solid var(--accent-line)', borderRadius: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                          <span className="eyebrow" style={{ color: 'var(--accent-deep)' }}>{selected.subTeam.label}</span>
                          <button
                            onClick={() => setFocusedSubTeam(selected.id)}
                            className="btn ghost"
                            style={{ fontSize: 11, padding: '3px 8px', color: 'var(--accent-deep)' }}
                          >
                            View team →
                          </button>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {selected.subTeam.agents.slice(0, 5).map((sub) => (
                            <div key={sub.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                              <div style={{ width: 22, height: 22, borderRadius: 6, background: 'rgba(255,255,255,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 11, border: '1px solid var(--glass-border)' }}>
                                {sub.label[0]}
                              </div>
                              <span style={{ fontWeight: 500 }}>{sub.label}</span>
                              <span style={{ color: 'var(--text-faint)' }}>·</span>
                              <span style={{ color: 'var(--text-dim)' }}>{sub.role}</span>
                              {sub.tier && (
                                <span className="mono" style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--accent-deep)' }}>{sub.tier}</span>
                              )}
                            </div>
                          ))}
                          {selected.subTeam.agents.length > 5 && (
                            <div style={{ fontSize: 11, color: 'var(--text-faint)', paddingLeft: 30 }}>
                              + {selected.subTeam.agents.length - 5} more…
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Channels */}
                    {(selectedDetail?.channels ?? []).length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {(selectedDetail.channels as string[]).map((c) => (
                          <span key={c} className="pill info">{c}</span>
                        ))}
                      </div>
                    )}

                    {/* Tools */}
                    {(selectedDetail?.tools ?? []).length > 0 && (
                      <div>
                        <div className="eyebrow" style={{ marginBottom: 6 }}>Connects to</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {(selectedDetail.tools as string[]).map((t) => (
                            <span key={t} className="mono" style={{ fontSize: 11, padding: '4px 10px', borderRadius: 999, background: 'rgba(255,255,255,0.6)', border: '1px solid var(--glass-border)', color: 'var(--text-dim)' }}>{t}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Strengths */}
                    {(selectedDetail?.strengths ?? []).length > 0 && (
                      <div style={{ fontSize: 12, color: 'var(--text-dim)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {(selectedDetail.strengths as string[]).map((sk: string, i: number) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, lineHeight: 1.5 }}>
                            <span style={{ color: '#1f7a48' }}>✓</span><span>{sk}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Limitations */}
                    {(selectedDetail?.limitations ?? []).length > 0 && (
                      <div style={{ fontSize: 12, color: 'var(--text-dim)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {(selectedDetail.limitations as string[]).map((l: string, i: number) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, lineHeight: 1.5 }}>
                            <span style={{ color: '#8a4f10' }}>⚠</span><span>{l}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Model + price */}
                    {selected.tier && (
                      <div
                        style={{
                          marginTop: 'auto',
                          padding: 12,
                          background: 'rgba(255,255,255,0.5)',
                          border: '1px solid var(--glass-border)',
                          borderRadius: 12,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                          <span className="eyebrow">Model</span>
                          <span className="mono" style={{ fontSize: 10, color: 'var(--text-faint)' }}>
                            {TIER_DESC_LOCAL[selected.tier as keyof typeof TIER_DESC_LOCAL]}
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                          <span style={{ fontSize: 18, fontWeight: 600, color: 'var(--accent-deep)' }}>{selected.tier}</span>
                          <span className="mono" style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                            {currencySymbol}{TIER_PRICE_LOCAL[selected.tier as keyof typeof TIER_PRICE_LOCAL]}/mo
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Cost comparison — safer language, no specific dollar amount claims */}
            <div className="glass" style={{ padding: '1.25rem', marginTop: '1rem', display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '1rem', alignItems: 'flex-start' }}>
              <div style={{ textAlign: 'center' }}>
                <div className="eyebrow" style={{ marginBottom: 6 }}>Without WisdomWorks</div>
                <div style={{ fontSize: 14, color: 'var(--text)', fontWeight: 500, marginBottom: 8, lineHeight: 1.3 }}>
                  Potential losses
                </div>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                  <li>• Hours lost to admin work</li>
                  <li>• Slow client response times</li>
                  <li>• Knowledge leaving with staff</li>
                  <li>• Inconsistent client experience</li>
                </ul>
              </div>
              <div style={{ fontSize: 24, color: 'var(--text-faint)', alignSelf: 'center' }}>→</div>
              <div style={{ textAlign: 'center' }}>
                <div className="eyebrow" style={{ marginBottom: 6 }}>With WisdomWorks</div>
                <div className="num-md mono" style={{ color: 'var(--accent-deep)' }}>{currencySymbol}{totalPrice}</div>
                <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>per month · may vary by usage</div>
                <button
                  onClick={() => setShowPriceBreakdown(!showPriceBreakdown)}
                  className="btn ghost"
                  style={{ fontSize: 11, padding: '4px 10px', marginTop: 8, color: 'var(--accent-deep)' }}
                >
                  {showPriceBreakdown ? '▲ Hide breakdown' : '▼ See breakdown'}
                </button>
                {showPriceBreakdown && (() => {
                  // Calculate tier counts including sub-agents
                  const counts = { Opus: 0, Sonnet: 0, Haiku: 0 };
                  hierarchyAgents.forEach((a) => {
                    if (a.tier) counts[a.tier as keyof typeof counts]++;
                    a.subTeam?.agents.forEach((sub) => {
                      if (sub.tier) counts[sub.tier as keyof typeof counts]++;
                    });
                    if (a.subTeam) {
                      const listed = a.subTeam.agents.length;
                      if (a.subTeam.count > listed) {
                        const fillerTier = a.tier ?? 'Haiku';
                        counts[fillerTier as keyof typeof counts] += a.subTeam.count - listed;
                      }
                    }
                  });
                  return (
                    <div style={{ marginTop: 10, padding: 10, background: 'rgba(124,58,237,0.05)', borderRadius: 8, fontSize: 11, textAlign: 'left' }}>
                      {(['Opus', 'Sonnet', 'Haiku'] as const).map((tier) => counts[tier] > 0 && (
                        <div key={tier} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', color: 'var(--text-dim)' }}>
                          <span>{counts[tier]} × {tier} <span style={{ color: 'var(--text-faint)' }}>({currencySymbol}{TIER_PRICE[tier]})</span></span>
                          <span className="mono">{currencySymbol}{counts[tier] * TIER_PRICE[tier]}</span>
                        </div>
                      ))}
                      <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
                        <span>Total</span>
                        <span className="mono">{currencySymbol}{totalPrice}/mo</span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Deployment summary — Story 1.8: blueprint, template, surfaces, integrations, trial terms */}
            {deploymentPreview && (
              <div className="glass-strong" style={{ padding: '1rem 1.25rem', marginTop: '1rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
                <div>
                  <div className="eyebrow" style={{ marginBottom: 4 }}>Plan</div>
                  <div style={{ fontSize: 14, fontWeight: 600, textTransform: 'capitalize' }}>{deploymentPreview.blueprint?.replace(/_/g, ' ')}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2, textTransform: 'capitalize' }}>{deploymentPreview.template?.replace(/_/g, ' ')} template</div>
                </div>
                <div>
                  <div className="eyebrow" style={{ marginBottom: 4 }}>Surfaces</div>
                  <div style={{ fontSize: 12, lineHeight: 1.5 }}>
                    {(deploymentPreview.surfaces ?? []).map((s: string) => s.replace(/([A-Z])/g, ' $1').trim()).join(' · ') || '—'}
                  </div>
                </div>
                <div>
                  <div className="eyebrow" style={{ marginBottom: 4 }}>Integrations</div>
                  <div style={{ fontSize: 12, lineHeight: 1.5 }}>
                    {(deploymentPreview.integrations ?? []).join(' · ') || 'Connect during setup'}
                  </div>
                </div>
                <div>
                  <div className="eyebrow" style={{ marginBottom: 4 }}>Trial</div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>
                    {currencySymbol}{deploymentPreview.costBreakdown?.deposit ?? 0} deposit
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
                    {deploymentPreview.costBreakdown?.trialDays ?? 30}-day trial · applied to first invoice
                  </div>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: '1.5rem' }}>
              <button onClick={handleStartTrial} className="btn primary" style={{ padding: '12px 28px', fontSize: 14 }}>
                Start Trial · {currencySymbol}{totalPrice}/mo
              </button>
              <button
                onClick={() => setShowRefineChat(!showRefineChat)}
                className="btn ghost"
                style={{ padding: '12px 24px', fontSize: 14 }}
              >
                {showRefineChat ? '✕ Close chat' : 'Ask Iris to customize →'}
              </button>
            </div>

            {/* Refine chat — talk to Iris to customize the team */}
            {showRefineChat && (
              <div className="glass-strong" style={{ padding: 18, marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <header style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 8, borderBottom: '1px solid var(--glass-border)' }}>
                  <div className="breathe" style={{ width: 26, height: 26, borderRadius: 8, background: 'var(--accent)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 12 }}>✦</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>Talk to Iris</div>
                    <div className="mono" style={{ fontSize: 10, color: 'var(--text-faint)' }}>
                      Try: "rename Atlas to Maya" · "add a recruiter" · "what does Vega actually do?"
                    </div>
                  </div>
                </header>

                <div className="scroll" style={{ maxHeight: '40vh', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {messages.slice(-8).map((msg, i) => (
                    <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start', gap: 6 }}>
                      <div
                        style={{
                          maxWidth: '85%',
                          padding: '8px 12px',
                          borderRadius: 12,
                          background: msg.role === 'user' ? 'var(--accent)' : 'rgba(255,255,255,0.85)',
                          color: msg.role === 'user' ? 'white' : 'var(--text)',
                          fontSize: 13,
                          lineHeight: 1.5,
                          border: msg.role === 'user' ? 'none' : '1px solid var(--glass-border)',
                        }}
                      >
                        {formatMessage(msg.content)}
                      </div>
                      {/* Render any action cards that came after this assistant message (last assistant only) */}
                      {msg.role === 'assistant' && i === messages.slice(-8).length - 1 &&
                        refineActions.map((action) => (
                          <ActionCard
                            key={action.id}
                            action={action}
                            currencySymbol={currencySymbol}
                            onAccept={() => acceptAction(action.id)}
                            onReject={() => rejectAction(action.id)}
                          />
                        ))}
                    </div>
                  ))}
                  {isLoading && (
                    <div style={{ alignSelf: 'flex-start', padding: '8px 12px', borderRadius: 12, background: 'rgba(255,255,255,0.85)', border: '1px solid var(--glass-border)' }}>
                      <span style={{ opacity: 0.5, animation: 'pulse 1.5s infinite', fontSize: 12 }}>thinking…</span>
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                    placeholder="Ask a question or refine the team…"
                    style={{
                      flex: 1,
                      background: 'rgba(255,255,255,0.55)',
                      border: '1px solid var(--glass-border)',
                      borderRadius: 10,
                      padding: '9px 12px',
                      fontSize: 13,
                      outline: 'none',
                      fontFamily: 'inherit',
                      color: 'var(--text)',
                    }}
                  />
                  <button onClick={handleSend} disabled={isLoading || !input.trim()} className="btn primary" style={{ fontSize: 12 }}>
                    Send
                  </button>
                </div>
              </div>
            )}
          </div>
          );
        })()}

        {/* PHASE 3: Connect Tools (post-payment) */}
        {hasPaid && !agentsDeployed && showConnectTools && (
          <div style={{ width: '100%', maxWidth: 720, padding: '0 24px' }}>
            <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
              <div className="eyebrow" style={{ marginBottom: 12, color: 'var(--ok)' }}>Payment successful</div>
              <div className="num-lg" style={{ color: 'var(--text)', fontWeight: 300 }}>One last step.</div>
              <div style={{ marginTop: 8, color: 'var(--text-dim)', fontSize: 14 }}>Connect your tools and meet your assistant.</div>
            </div>
            <div className="glass-strong" style={{ padding: '1.5rem' }}>
              <ConnectTools
                onComplete={async () => {
                  try {
                    const agents = mapToHierarchyAgents(s.agents ?? []);
                    const rawAgents = s.agents ?? [];
                    const savedPhone = localStorage.getItem('wisdomworks_phone');
                    const bName = businessName || s.businessName || 'Your Business';
                    if (savedPhone) {
                      // Round-trip: pair the cleaned hierarchy agent (with friendly name)
                      // with the AI's rich metadata (description, channels, tools, etc.)
                      // so the Command Deck can render the same cards as onboarding.
                      const enrichedAgents = agents.map((a, i) => {
                        const raw = rawAgents[i] ?? {};
                        return {
                          id: a.id,
                          name: a.label,
                          role: a.role,
                          tier: a.tier,
                          required: a.required,
                          emoji: raw.emoji,
                          description: raw.description,
                          channels: raw.channels ?? [],
                          tools: raw.tools ?? [],
                          strengths: raw.strengths ?? [],
                          limitations: raw.limitations ?? [],
                          aiModel: raw.aiModel ?? a.tier,
                          subTeam: a.subTeam
                            ? {
                                count: a.subTeam.count,
                                label: a.subTeam.label,
                                agents: a.subTeam.agents.map((sub) => ({
                                  id: sub.id,
                                  name: sub.label,
                                  role: sub.role,
                                  tier: sub.tier,
                                })),
                              }
                            : undefined,
                        };
                      });

                      const stripeSessionId = (() => {
                        try { return localStorage.getItem('wisdomworks_stripe_session') || undefined; }
                        catch { return undefined; }
                      })();
                      await fetch('/api/deploy-complete', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          phoneNumber: savedPhone,
                          businessName: bName,
                          businessType: s.businessType,
                          agentCount: agents.length,
                          agents: enrichedAgents,
                          stripeSessionId,
                          // Stories 1.7+ persistence pipeline runs server-side from these:
                          structured: structuredData,
                          collectedData: {
                            organizationName: bName,
                            businessType: s.businessType,
                            industry: s.businessType,
                            employeeCount: structuredData?.employeeCount,
                            existingTools: structuredData?.detectedIntegrations,
                            painPoints: structuredData?.painPoints,
                            websiteUrl: structuredData?.websiteUrl,
                            communicationChannels: structuredData?.communicationChannels,
                          },
                        }),
                      });
                    }
                  } catch (err) {
                    console.error('Deploy complete error:', err);
                  }
                  setShowConnectTools(false);
                  setAgentsDeployed(true);
                }}
                onSkip={() => setShowConnectTools(false)}
                businessName={businessName || s.businessName}
                businessType={s.businessType}
              />
            </div>
          </div>
        )}

        {/* PHASE 4: Deployed — show team + dashboard CTA */}
        {hasPaid && agentsDeployed && (
          <div style={{ width: '100%', maxWidth: 980, padding: '0 24px' }}>
            <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
              <WisdomMark size={56} accent="var(--accent)" />
              <div className="num-lg" style={{ color: 'var(--text)', fontWeight: 300, marginTop: 16 }}>
                Your team is live.
              </div>
              <div style={{ marginTop: 8, color: 'var(--text-dim)', fontSize: 14 }}>
                Check WhatsApp — {hierarchyAgents[0]?.label || 'your assistant'} just introduced themselves.
              </div>
            </div>

            <div className="glass-strong" style={{ padding: '1.5rem', boxShadow: '0 24px 60px rgba(20, 20, 40, 0.16)' }}>
              <Hierarchy
                width={940}
                height={460}
                team={hierarchyAgents}
                principal={{
                  initials: (businessName || 'You').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase(),
                  first: businessName?.split(' ')[0] || 'You',
                  role: 'Owner',
                }}
                showArcs
                accent="var(--accent)"
                focusedSubTeam={focusedSubTeam}
                onSubTeamOpen={(parentId) => setFocusedSubTeam(parentId)}
                onSubTeamClose={() => setFocusedSubTeam(null)}
              />
            </div>

            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: '1.5rem' }}>
              <button
                type="button"
                className="btn primary"
                style={{ padding: '12px 28px', fontSize: 14 }}
                onClick={() => {
                  const savedPhone = typeof window !== 'undefined' ? localStorage.getItem('wisdomworks_phone') : null;
                  // In dev (localhost), route to local Command Deck on port 3000.
                  // In prod, use NEXT_PUBLIC_COMMAND_DECK_URL or fall back to wisdomworks.vercel.app.
                  const isLocal = typeof window !== 'undefined' && window.location.hostname === 'localhost';
                  const base = isLocal
                    ? 'http://localhost:3000'
                    : (process.env.NEXT_PUBLIC_COMMAND_DECK_URL || 'https://wisdomworks.vercel.app');
                  const url = savedPhone ? `${base}?phone=${encodeURIComponent(savedPhone)}` : base;
                  window.open(url, '_blank', 'noopener');
                }}
              >
                Open Command Deck
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Floating price diff toast — appears when team composition changes */}
      {priceDiff && (
        <PriceDiff
          delta={priceDiff.delta}
          total={priceDiff.total}
          currencySymbol={currencySymbol}
          onDismiss={() => setPriceDiff(null)}
        />
      )}
    </>
  );
}

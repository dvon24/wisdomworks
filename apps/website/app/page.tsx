'use client';

import { useState, useRef, useEffect } from 'react';
import { Background, WisdomLockup, WisdomMark, Hierarchy, type HierarchyAgent } from '@wisdomworks/ui';
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

/** Map AI-suggested agents to the Hierarchy component shape */
function mapToHierarchyAgents(structuredAgents: any[]): HierarchyAgent[] {
  if (!structuredAgents?.length) {
    return [{ id: 'iris', label: 'Iris', role: 'Personal assistant', tier: 'Opus', status: 'ok', required: true }];
  }
  return structuredAgents.map((a: any, i: number) => {
    const id = (a.name || `agent-${i}`).toLowerCase().replace(/\s+/g, '-');
    // First agent is always the personal assistant — show as Iris-style
    if (i === 0) {
      return { id: 'iris', label: a.name || 'Iris', role: a.role || 'Personal assistant', tier: 'Opus', status: 'ok', required: true };
    }
    // Tier from AI model name (Opus/Sonnet/Haiku)
    const model = (a.aiModel || '').toLowerCase();
    const tier: 'Opus' | 'Sonnet' | 'Haiku' = model.includes('opus') ? 'Opus' : model.includes('haiku') ? 'Haiku' : 'Sonnet';
    return { id, label: a.name || `Agent ${i + 1}`, role: a.role || 'Specialist', tier, status: 'ok' as const };
  });
}

const TIER_PRICE = { Haiku: 19, Sonnet: 39, Opus: 79 };

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
  const [inputPlaceholder, setInputPlaceholder] = useState('Describe your business...');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Restore state if returning from Stripe
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('paid') === 'true') {
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
      setHasPaid(true);
      setShowConnectTools(true);
      setShowPreview(true);
      window.history.replaceState({}, '', '/');
    }
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    const userMsg = { role: 'user' as const, content: input.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);

    try {
      const res = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages, collectedData: structuredData ?? {} }),
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
    } catch (err) {
      console.error('Onboarding error:', err);
      setMessages([...newMessages, { role: 'assistant', content: 'Hmm, I had a moment. Could you try again?' }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartTrial = async () => {
    const s = structuredData ?? {};
    const agents = mapToHierarchyAgents(s.agents ?? []);
    // Tier-based pricing
    const monthlyPrice = agents.reduce((sum, a) => sum + (TIER_PRICE[a.tier as keyof typeof TIER_PRICE] || 39), 0);
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
  const hierarchyAgents = mapToHierarchyAgents(s.agents ?? []);
  const totalPrice = hierarchyAgents.reduce((sum, a) => sum + (TIER_PRICE[a.tier as keyof typeof TIER_PRICE] || 39), 0);
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

              {/* Starter suggestions — only show before user has sent any messages */}
              {messages.length <= 1 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {[
                    'I run an auto repair shop',
                    'Solo brand designer',
                    '20-person dental practice',
                    'Yoga studio · 3 locations',
                  ].map((s) => (
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
              )}

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

            {/* Trust footer */}
            <div style={{ marginTop: 20, fontSize: 12, color: 'var(--text-faint)', textAlign: 'center' }}>
              No account needed to start · Your AI team deploys in minutes
            </div>
          </div>
        )}

        {/* Example preview — shows below chat to give visitors a concrete sense of what they'll get */}
        {!showPreview && <ExamplePreview />}

        {/* PHASE 2: Agent Hierarchy Preview (pre-payment) */}
        {showPreview && !hasPaid && (
          <div style={{ width: '100%', maxWidth: 980, padding: '0 24px' }}>
            <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
              <div className="eyebrow" style={{ marginBottom: 12 }}>Your AI Team</div>
              <div className="num-lg" style={{ color: 'var(--text)', fontWeight: 300 }}>
                {hierarchyAgents.length} agents, ready to deploy.
              </div>
              <div style={{ marginTop: 8, color: 'var(--text-dim)', fontSize: 14 }}>
                {businessName || s.businessName || 'Your business'} · {currencySymbol}{totalPrice}/month total
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
                showExternals={false}
                showArcs
                accent="var(--accent)"
              />
            </div>

            {/* Cost comparison */}
            {s.costOfInaction?.totalPerMonth && (
              <div className="glass" style={{ padding: '1.25rem', marginTop: '1rem', display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '1rem', alignItems: 'center' }}>
                <div style={{ textAlign: 'center' }}>
                  <div className="eyebrow" style={{ marginBottom: 4 }}>Without WisdomWorks</div>
                  <div className="num-md mono" style={{ color: 'var(--bad)' }}>{s.costOfInaction.totalPerMonth}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>lost per month</div>
                </div>
                <div style={{ fontSize: 24, color: 'var(--text-faint)' }}>→</div>
                <div style={{ textAlign: 'center' }}>
                  <div className="eyebrow" style={{ marginBottom: 4 }}>With WisdomWorks</div>
                  <div className="num-md mono" style={{ color: 'var(--accent-deep)' }}>{currencySymbol}{totalPrice}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>per month</div>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: '1.5rem' }}>
              <button onClick={handleStartTrial} className="btn primary" style={{ padding: '12px 28px', fontSize: 14 }}>
                Start Trial · {currencySymbol}{totalPrice}/mo
              </button>
              <button className="btn ghost" style={{ padding: '12px 24px', fontSize: 14 }}>
                Ask questions
              </button>
            </div>
          </div>
        )}

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
                    const savedPhone = localStorage.getItem('wisdomworks_phone');
                    const bName = businessName || s.businessName || 'Your Business';
                    if (savedPhone) {
                      await fetch('/api/deploy-complete', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          phoneNumber: savedPhone,
                          businessName: bName,
                          businessType: s.businessType,
                          agentCount: agents.length,
                          agents: agents.slice(0, 5).map((a) => ({ name: a.label, role: a.role })),
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
              />
            </div>

            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: '1.5rem' }}>
              <a href="https://wisdomworks.vercel.app" target="_blank" rel="noopener" className="btn primary" style={{ padding: '12px 28px', fontSize: 14, textDecoration: 'none' }}>
                Open Command Deck
              </a>
            </div>
          </div>
        )}
      </main>
    </>
  );
}

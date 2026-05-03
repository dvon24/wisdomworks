'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import AgentPreview, { generateTeamForBusiness } from './components/AgentPreview';
import ConnectTools from './components/ConnectTools';

/** Your local timelapse videos in public/ */
const BG_VIDEOS = [
  '/13624534_3840_2160_24fps.mp4',
  '/6003440-uhd_3840_2160_25fps.mp4',
  '/6403564-uhd_3840_2160_24fps.mp4',
  '/6667407-uhd_4096_2160_30fps.mp4',
  '/8025541-uhd_3840_2160_24fps.mp4',
];

/** Render AI markdown as clean readable JSX — bold, bullets, numbered lists */
function formatMessage(text: string): React.ReactNode {
  if (!text) return null;
  const lines = text.split('\n');
  return lines.map((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) return <br key={i} />;
    const renderBold = (str: string) => {
      const parts = str.split(/\*\*(.*?)\*\*/g);
      return parts.map((part, j) => j % 2 === 1 ? <strong key={j}>{part}</strong> : part);
    };
    if (trimmed.startsWith('•') || (trimmed.startsWith('- ') && !trimmed.startsWith('---'))) {
      const content = trimmed.replace(/^[•\-]\s*/, '');
      return <div key={i} style={{ paddingLeft: '1.2rem', marginBottom: '0.25rem', display: 'flex', gap: '0.4rem' }}><span style={{ color: '#6366f1' }}>•</span><span>{renderBold(content)}</span></div>;
    }
    if (/^\d+\.\s/.test(trimmed)) {
      const num = trimmed.match(/^(\d+)\.\s/)?.[1];
      const content = trimmed.replace(/^\d+\.\s*/, '');
      return <div key={i} style={{ paddingLeft: '0.8rem', marginBottom: '0.25rem', display: 'flex', gap: '0.4rem' }}><span style={{ color: '#6366f1', fontWeight: 600 }}>{num}.</span><span>{renderBold(content)}</span></div>;
    }
    if (/^[🤖📋🔗💰✨🎯]/.test(trimmed)) {
      return <div key={i} style={{ marginTop: '0.6rem', marginBottom: '0.25rem', fontWeight: 600 }}>{renderBold(trimmed)}</div>;
    }
    return <div key={i} style={{ marginBottom: '0.15rem' }}>{renderBold(trimmed)}</div>;
  });
}

export default function HomePage() {
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([
    {
      role: 'assistant',
      content: "Welcome to WisdomWorks. I'm here to build your AI team. Tell me about your business — what do you do?",
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showChatBelowPreview, setShowChatBelowPreview] = useState(false);
  const [showConnectTools, setShowConnectTools] = useState(false);
  const [agentsDeployed, setAgentsDeployed] = useState(false);
  const [businessName, setBusinessName] = useState('');
  const [structuredData, setStructuredData] = useState<any>(null);
  const [inputPlaceholder, setInputPlaceholder] = useState('Describe your business...');

  const videoARef = useRef<HTMLVideoElement>(null);
  const videoBRef = useRef<HTMLVideoElement>(null);
  const indexRef = useRef(0);
  const [opacityA, setOpacityA] = useState(1);
  const [opacityB, setOpacityB] = useState(0);
  const activeRef = useRef<'A' | 'B'>('A');

  const dissolvingRef = useRef(false);
  const DISSOLVE_DURATION = 4; // seconds — how long both videos overlap

  // Check if returning from Stripe payment
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('paid') === 'true') {
      // Payment successful — skip straight to ConnectTools
      setShowConnectTools(true);
      setShowPreview(true);
      // Clean the URL
      window.history.replaceState({}, '', '/');
    }
  }, []);

  useEffect(() => {
    if (videoARef.current) {
      videoARef.current.src = BG_VIDEOS[0]!;
      videoARef.current.play().catch(() => {});
    }
    if (videoBRef.current) {
      videoBRef.current.src = BG_VIDEOS[1]!;
      videoBRef.current.load();
    }
  }, []);

  // Dissolve: start fading BEFORE the video ends so both play simultaneously
  const handleTimeUpdate = (slot: 'A' | 'B') => {
    const video = slot === 'A' ? videoARef.current : videoBRef.current;
    if (!video || !video.duration || dissolvingRef.current) return;
    if (slot !== activeRef.current) return;

    const timeLeft = video.duration - video.currentTime;

    if (timeLeft <= DISSOLVE_DURATION && timeLeft > 0) {
      dissolvingRef.current = true;

      // Start the next video playing underneath
      const nextVideo = slot === 'A' ? videoBRef.current : videoARef.current;
      nextVideo?.play().catch(() => {});

      // Dissolve: both visible, outgoing fades out, incoming fades in
      if (slot === 'A') {
        setOpacityB(1);
        // After dissolve completes, fully swap
        setTimeout(() => {
          setOpacityA(0);
          activeRef.current = 'B';
        }, DISSOLVE_DURATION * 500); // halfway through dissolve
      } else {
        setOpacityA(1);
        setTimeout(() => {
          setOpacityB(0);
          activeRef.current = 'A';
        }, DISSOLVE_DURATION * 500);
      }
    }
  };

  const handleEnded = (slot: 'A' | 'B') => {
    dissolvingRef.current = false;
    indexRef.current = (indexRef.current + 1) % BG_VIDEOS.length;
    const nextIndex = (indexRef.current + 1) % BG_VIDEOS.length;

    // Preload next video into the slot that just finished
    const finishedVideo = slot === 'A' ? videoARef.current : videoBRef.current;
    if (finishedVideo) {
      finishedVideo.src = BG_VIDEOS[nextIndex]!;
      finishedVideo.load();
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = { role: 'user' as const, content: input.trim() };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages.map((m) => ({
            role: m.role,
            content: m.content,
            timestamp: new Date().toISOString(),
          })),
          collectedData: {},
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.details || data.error || 'Failed to get response');
      }

      setMessages((prev) => [...prev, { role: 'assistant', content: data.text }]);

      // Use structured data from AI — no more regex parsing
      if (data.structured) {
        const s = data.structured;
        setStructuredData(s);

        // Update business name
        if (s.businessName && !businessName) {
          setBusinessName(s.businessName);
        }

        // Update input placeholder based on phase
        if (s.inputPlaceholder) {
          setInputPlaceholder(s.inputPlaceholder);
        }

        // Trigger preview when AI says to show it
        if (s.showAgentPreview && !showPreview && s.agents?.length > 0) {
          setTimeout(() => setShowPreview(true), 1500);
        }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `Connection issue: ${errorMsg}. The AI onboarding will be fully active once deployed.` },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Cinematic Background — dual video crossfade */}
      <video
        ref={videoARef}
        muted
        playsInline
        onTimeUpdate={() => handleTimeUpdate('A')}
        onEnded={() => handleEnded('A')}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          opacity: opacityA,
          transition: `opacity ${DISSOLVE_DURATION}s ease-in-out`,
        }}
      />
      <video
        ref={videoBRef}
        muted
        playsInline
        onTimeUpdate={() => handleTimeUpdate('B')}
        onEnded={() => handleEnded('B')}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          opacity: opacityB,
          transition: `opacity ${DISSOLVE_DURATION}s ease-in-out`,
        }}
      />
      {/* Subtle dark overlay for text readability */}
      <div style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1,
        background: 'linear-gradient(135deg, rgba(10, 10, 26, 0.5) 0%, rgba(20, 10, 40, 0.3) 50%, rgba(10, 10, 26, 0.5) 100%)',
      }} />

      {/* Top Bar */}
      <nav style={{
        position: 'relative',
        zIndex: 10,
        padding: '1.5rem 2rem',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.02em' }}>
          WisdomWorks
        </h1>
        <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
          <Link href="/about" style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.95rem' }}>About</Link>
        </div>
      </nav>

      {/* Center Chat Box */}
      <div style={{
        position: 'relative',
        zIndex: 10,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 'calc(100vh - 80px)',
        padding: '2rem',
      }}>
        {/* Tagline */}
        {/* Tagline — fades out once user sends first message */}
        {messages.length <= 1 && (
          <>
            <h2 style={{
              fontSize: '2.5rem', fontWeight: 800, textAlign: 'center', marginBottom: '0.5rem',
              textShadow: '0 2px 20px rgba(0,0,0,0.5)',
              animation: messages.length > 1 ? 'fadeOut 0.5s forwards' : undefined,
            }}>
              Tell us what you need.
            </h2>
            <p style={{
              fontSize: '1.1rem', color: 'rgba(255,255,255,0.6)', marginBottom: '2rem',
              textShadow: '0 1px 10px rgba(0,0,0,0.5)',
            }}>
              AI builds it. AI runs it. AI improves it.
            </p>
          </>
        )}

        {/* PHASE 1: Conversation — fades out when preview shows */}
        {!showPreview && (
          <div style={{
            width: '100%',
            maxWidth: messages.length <= 2 ? '680px' : messages.length <= 4 ? '800px' : '950px',
            position: 'relative',
            borderRadius: '20px',
            overflow: 'hidden',
            boxShadow: '0 25px 80px rgba(0, 0, 0, 0.3), 0 0 40px rgba(99, 102, 241, 0.08)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            transition: 'max-width 0.5s ease-in-out, opacity 0.8s ease',
            animation: 'fadeIn 0.5s ease',
          }}>
            <div style={{
              position: 'absolute', inset: 0,
              background: 'linear-gradient(to right, rgba(10, 10, 30, 0.85) 0%, rgba(10, 10, 30, 0.5) 40%, rgba(10, 10, 30, 0.15) 70%, rgba(10, 10, 30, 0.0) 100%)',
              backdropFilter: 'blur(40px)',
              WebkitMaskImage: 'linear-gradient(to right, black 0%, black 50%, rgba(0,0,0,0.5) 75%, rgba(0,0,0,0.2) 100%)',
              maskImage: 'linear-gradient(to right, black 0%, black 50%, rgba(0,0,0,0.5) 75%, rgba(0,0,0,0.2) 100%)',
              zIndex: 0,
            }} />
            <div style={{ position: 'relative', zIndex: 1 }}>
              <div style={{ minHeight: '200px', maxHeight: '60vh', overflowY: 'auto', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {messages.map((msg, i) => (
                  <div key={i} style={{
                    alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                    maxWidth: '85%', padding: '0.8rem 1.2rem',
                    borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                    background: msg.role === 'user' ? 'linear-gradient(135deg, #6366f1, #818cf8)' : 'rgba(255, 255, 255, 0.08)',
                    fontSize: '0.95rem', lineHeight: 1.5,
                  }}>
                    {formatMessage(msg.content || (isLoading ? '...' : ''))}
                  </div>
                ))}
                {isLoading && (
                  <div style={{ alignSelf: 'flex-start', padding: '0.8rem 1.2rem', borderRadius: '16px 16px 16px 4px', background: 'rgba(255, 255, 255, 0.08)', fontSize: '0.95rem' }}>
                    <span style={{ opacity: 0.6, animation: 'pulse 1.5s infinite' }}>Thinking...</span>
                  </div>
                )}
              </div>
              <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid rgba(255, 255, 255, 0.06)', display: 'flex', gap: '0.75rem' }}>
                <input type="text" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSend()} placeholder={inputPlaceholder}
                  style={{ flex: 1, padding: '0.8rem 1rem', background: 'rgba(255, 255, 255, 0.06)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '12px', color: 'white', fontSize: '0.95rem', outline: 'none' }} />
                <button onClick={handleSend} disabled={isLoading || !input.trim()}
                  style={{ padding: '0.8rem 1.5rem', background: isLoading ? 'rgba(99, 102, 241, 0.5)' : '#6366f1', color: 'white', border: 'none', borderRadius: '12px', fontSize: '0.95rem', fontWeight: 600, cursor: isLoading ? 'wait' : 'pointer' }}>
                  {isLoading ? '...' : 'Send'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* PHASE 2: Agent Preview — fades in, replaces conversation */}
        {showPreview && (() => {
          const s = structuredData ?? {};
          const integrations: string[] = s.detectedIntegrations ?? ['Calendar', 'WhatsApp'];
          const employeeCount: number = s.employeeCount ?? 1;

          // Build agents from structured data (fully dynamic)
          const aiAgents = (s.agents ?? []).map((a: any) => a);
          const team = generateTeamForBusiness(
            businessName || s.businessName || 'Your Business',
            integrations.some((i: string) => i.toLowerCase().includes('website')),
            integrations,
            employeeCount,
            aiAgents,
          );

          return (
            <div style={{ width: '100%', maxWidth: '1100px' }}>
              {/* Agent cards with glassmorphic background */}
              <div style={{
                position: 'relative', borderRadius: '20px', overflow: 'hidden',
                boxShadow: '0 25px 80px rgba(0, 0, 0, 0.3), 0 0 40px rgba(99, 102, 241, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
              }}>
                <div style={{
                  position: 'absolute', inset: 0,
                  background: 'linear-gradient(to right, rgba(10, 10, 30, 0.85) 0%, rgba(10, 10, 30, 0.5) 40%, rgba(10, 10, 30, 0.15) 70%, rgba(10, 10, 30, 0.0) 100%)',
                  backdropFilter: 'blur(40px)',
                  WebkitMaskImage: 'linear-gradient(to right, black 0%, black 50%, rgba(0,0,0,0.5) 75%, rgba(0,0,0,0.2) 100%)',
                  maskImage: 'linear-gradient(to right, black 0%, black 50%, rgba(0,0,0,0.5) 75%, rgba(0,0,0,0.2) 100%)',
                  zIndex: 0,
                }} />
                <div style={{ position: 'relative', zIndex: 1, padding: '1.5rem' }}>
                  <AgentPreview
                    businessName={businessName || s.businessName || 'Your Business'}
                    agents={team.agents}
                    connections={team.connections}
                    estimatedPrice={s.estimatedPrice || team.price}
                    employeeCount={employeeCount}
                    costData={s.costOfInaction}
                    painPoints={s.painPoints}
                    location={s.location}
                    onStartTrial={async () => {
                      try {
                        // Parse price from estimated price string (e.g., "$99/month" → 99)
                        const priceStr = s.estimatedPrice || team.price || '$99/month';
                        const priceMatch = priceStr.match(/[\d,]+/);
                        const monthlyPrice = priceMatch ? parseInt(priceMatch[0].replace(/,/g, ''), 10) : 99;
                        const currency = s.location?.currency?.toLowerCase() || 'usd';

                        const res = await fetch('/api/checkout', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            monthlyPrice,
                            businessName: businessName || s.businessName || 'Your Business',
                            agentCount: team.agents.length,
                            currency,
                          }),
                        });
                        const data = await res.json();
                        if (data.url) {
                          window.location.href = data.url;
                        }
                      } catch (err) {
                        console.error('Checkout error:', err);
                        // Fallback: show ConnectTools directly
                        setShowConnectTools(true);
                      }
                    }}
                    onAskQuestion={() => setShowChatBelowPreview(true)}
                  />
                </div>
              </div>

              {/* Connect Tools — appears when "Start Trial" clicked */}
              {showConnectTools && !agentsDeployed && (
                <div style={{
                  marginTop: '1.5rem', position: 'relative', borderRadius: '16px', overflow: 'hidden',
                  border: '1px solid rgba(255, 255, 255, 0.08)', animation: 'fadeIn 0.5s ease',
                }}>
                  <div style={{
                    position: 'absolute', inset: 0,
                    background: 'linear-gradient(to right, rgba(10, 10, 30, 0.85) 0%, rgba(10, 10, 30, 0.5) 40%, rgba(10, 10, 30, 0.15) 70%, rgba(10, 10, 30, 0.0) 100%)',
                    backdropFilter: 'blur(40px)',
                    WebkitMaskImage: 'linear-gradient(to right, black 0%, black 50%, rgba(0,0,0,0.5) 75%, rgba(0,0,0,0.2) 100%)',
                    maskImage: 'linear-gradient(to right, black 0%, black 50%, rgba(0,0,0,0.5) 75%, rgba(0,0,0,0.2) 100%)',
                    zIndex: 0,
                  }} />
                  <div style={{ position: 'relative', zIndex: 1, padding: '1.5rem' }}>
                    <ConnectTools
                      onComplete={async () => {
                        setShowConnectTools(false);
                        setAgentsDeployed(true);

                        // Send welcome WhatsApp message
                        try {
                          const s = structuredData ?? {};
                          const agents = s.agents ?? [];
                          // Get phone from ConnectTools (stored in localStorage during save)
                          const savedPhone = localStorage.getItem('wisdomworks_phone');
                          if (savedPhone) {
                            await fetch('/api/deploy-complete', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                phoneNumber: savedPhone,
                                businessName: businessName || s.businessName,
                                businessType: s.businessType,
                                agentCount: agents.length,
                                agents: agents.slice(0, 5).map((a: any) => ({ name: a.name, role: a.role })),
                              }),
                            });
                          }
                        } catch (err) {
                          console.error('Deploy complete error:', err);
                        }
                      }}
                      onSkip={() => setShowConnectTools(false)}
                      businessName={businessName || structuredData?.businessName}
                      businessType={structuredData?.businessType}
                    />
                  </div>
                </div>
              )}

              {/* Agents Deployed confirmation */}
              {agentsDeployed && (() => {
                const s = structuredData ?? {};
                const agents = s.agents ?? [];
                return (
                  <div style={{
                    marginTop: '1.5rem', borderRadius: '16px', overflow: 'hidden',
                    background: 'rgba(34, 197, 94, 0.05)', border: '1px solid rgba(34, 197, 94, 0.2)',
                    animation: 'fadeIn 0.8s ease',
                  }}>
                    {/* Header */}
                    <div style={{ padding: '2rem', textAlign: 'center', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                      <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🚀</div>
                      <h3 style={{ fontSize: '1.3rem', fontWeight: 700, marginBottom: '0.5rem' }}>Your AI Team is Live!</h3>
                      <p style={{ fontSize: '0.9rem', color: 'rgba(255,255,255,0.6)' }}>
                        Check your WhatsApp — your personal assistant just introduced themselves.
                      </p>
                    </div>

                    {/* Agent Team Graph */}
                    <div style={{ padding: '1.5rem' }}>
                      <div style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.4)', marginBottom: '1rem', textAlign: 'center' }}>
                        Your Agent Team
                      </div>

                      {/* Personal Assistant (center node) */}
                      {agents.length > 0 && (
                        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
                          <div style={{
                            display: 'inline-flex', flexDirection: 'column', alignItems: 'center',
                            padding: '1rem 1.5rem', borderRadius: '16px',
                            background: 'rgba(99, 102, 241, 0.15)', border: '2px solid rgba(99, 102, 241, 0.4)',
                          }}>
                            <span style={{ fontSize: '1.5rem' }}>{agents[0].emoji || '🤖'}</span>
                            <div style={{ fontSize: '0.95rem', fontWeight: 700, marginTop: '0.3rem' }}>{agents[0].name}</div>
                            <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)' }}>{agents[0].role}</div>
                            <div style={{ fontSize: '0.65rem', color: '#6366f1', marginTop: '0.2rem' }}>Coordinates all agents</div>
                          </div>
                        </div>
                      )}

                      {/* Connecting line */}
                      {agents.length > 1 && (
                        <div style={{ textAlign: 'center', marginBottom: '0.5rem' }}>
                          <div style={{ width: '2px', height: '20px', background: 'rgba(99,102,241,0.3)', margin: '0 auto' }} />
                        </div>
                      )}

                      {/* Other agents (grid) */}
                      {agents.length > 1 && (
                        <div style={{
                          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                          gap: '0.6rem',
                        }}>
                          {agents.slice(1).map((agent: any, i: number) => (
                            <div key={i} style={{
                              padding: '0.8rem', borderRadius: '10px', textAlign: 'center',
                              background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
                            }}>
                              <span style={{ fontSize: '1.2rem' }}>{agent.emoji || '🤖'}</span>
                              <div style={{ fontSize: '0.8rem', fontWeight: 600, marginTop: '0.2rem' }}>{agent.name}</div>
                              <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)' }}>{agent.role}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div style={{
                      padding: '1.5rem', borderTop: '1px solid rgba(255,255,255,0.06)',
                      display: 'flex', gap: '0.6rem', justifyContent: 'center', flexWrap: 'wrap',
                    }}>
                      <a href="https://wisdomworks.vercel.app" target="_blank" rel="noopener" style={{
                        padding: '0.7rem 1.5rem', background: '#6366f1', color: 'white',
                        border: 'none', borderRadius: '10px', fontSize: '0.85rem', fontWeight: 600,
                        textDecoration: 'none', display: 'inline-block',
                      }}>
                        Open Dashboard
                      </a>
                      <button onClick={() => {
                        setAgentsDeployed(false);
                        setShowConnectTools(true);
                      }} style={{
                        padding: '0.7rem 1.5rem', background: 'rgba(255,255,255,0.08)',
                        color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: '10px', fontSize: '0.85rem', cursor: 'pointer',
                      }}>
                        Manage Connections
                      </button>
                    </div>
                  </div>
                );
              })()}

              {/* Chat below preview — appears when "Ask Questions" clicked */}
              {showChatBelowPreview && !showConnectTools && (
                <div style={{
                  marginTop: '1.5rem', position: 'relative', borderRadius: '16px', overflow: 'hidden',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  animation: 'fadeIn 0.5s ease',
                }}>
                  <div style={{
                    position: 'absolute', inset: 0,
                    background: 'linear-gradient(to right, rgba(10, 10, 30, 0.8) 0%, rgba(10, 10, 30, 0.4) 50%, rgba(10, 10, 30, 0.1) 100%)',
                    backdropFilter: 'blur(30px)',
                    WebkitMaskImage: 'linear-gradient(to right, black 0%, black 50%, rgba(0,0,0,0.5) 75%, rgba(0,0,0,0.2) 100%)',
                    maskImage: 'linear-gradient(to right, black 0%, black 50%, rgba(0,0,0,0.5) 75%, rgba(0,0,0,0.2) 100%)',
                    zIndex: 0,
                  }} />
                  <div style={{ position: 'relative', zIndex: 1 }}>
                    <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.4)', padding: '0.8rem 1.5rem 0', marginBottom: '0.3rem' }}>
                      💬 Ask about your agents, change names, adjust roles...
                    </div>
                    <div style={{ minHeight: '120px', maxHeight: '350px', overflowY: 'auto', padding: '0.5rem 1.5rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      {messages.slice(-6).map((msg, i) => (
                        <div key={i} style={{
                          alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                          maxWidth: '85%', padding: '0.7rem 1rem',
                          borderRadius: msg.role === 'user' ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                          background: msg.role === 'user' ? 'linear-gradient(135deg, #6366f1, #818cf8)' : 'rgba(255, 255, 255, 0.08)',
                          fontSize: '0.9rem', lineHeight: 1.5,
                        }}>
                          {formatMessage(msg.content)}
                        </div>
                      ))}
                      {isLoading && (
                        <div style={{ alignSelf: 'flex-start', padding: '0.7rem 1rem', borderRadius: '12px', background: 'rgba(255, 255, 255, 0.08)', fontSize: '0.9rem' }}>
                          <span style={{ opacity: 0.6, animation: 'pulse 1.5s infinite' }}>Thinking...</span>
                        </div>
                      )}
                    </div>
                    <div style={{ padding: '0.8rem 1.2rem', borderTop: '1px solid rgba(255, 255, 255, 0.06)', display: 'flex', gap: '0.6rem' }}>
                      <input type="text" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                        placeholder="Ask about your agents, change a name, adjust roles..."
                        style={{ flex: 1, padding: '0.7rem 1rem', background: 'rgba(255, 255, 255, 0.06)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '10px', color: 'white', fontSize: '0.9rem', outline: 'none' }} />
                      <button onClick={handleSend} disabled={isLoading || !input.trim()}
                        style={{ padding: '0.7rem 1.2rem', background: isLoading ? 'rgba(99, 102, 241, 0.5)' : '#6366f1', color: 'white', border: 'none', borderRadius: '10px', fontSize: '0.9rem', fontWeight: 600, cursor: isLoading ? 'wait' : 'pointer' }}>
                        {isLoading ? '...' : 'Send'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* Below chat */}
        <p style={{
          marginTop: '1.5rem',
          fontSize: '0.85rem',
          color: 'rgba(255, 255, 255, 0.4)',
          textShadow: '0 1px 5px rgba(0,0,0,0.5)',
        }}>
          No account needed to start. Your AI team deploys in minutes.
        </p>
      </div>
    </div>
  );
}

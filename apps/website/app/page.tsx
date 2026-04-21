'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';

/** Your local timelapse videos in public/ */
const BG_VIDEOS = [
  '/13624534_3840_2160_24fps.mp4',
  '/6003440-uhd_3840_2160_25fps.mp4',
  '/6403564-uhd_3840_2160_24fps.mp4',
  '/6667407-uhd_4096_2160_30fps.mp4',
  '/8025541-uhd_3840_2160_24fps.mp4',
];

export default function HomePage() {
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([
    {
      role: 'assistant',
      content: "Welcome to WisdomWorks. I'm here to build your AI team. Tell me about your business — what do you do?",
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const videoARef = useRef<HTMLVideoElement>(null);
  const videoBRef = useRef<HTMLVideoElement>(null);
  const indexRef = useRef(0);
  const [opacityA, setOpacityA] = useState(1);
  const [opacityB, setOpacityB] = useState(0);
  const activeRef = useRef<'A' | 'B'>('A');

  const dissolvingRef = useRef(false);
  const DISSOLVE_DURATION = 4; // seconds — how long both videos overlap

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

      if (!response.ok) throw new Error('Failed to get response');

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No reader');

      let assistantContent = '';
      setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        assistantContent += decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: 'assistant', content: assistantContent };
          return updated;
        });
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: "I'm not connected to AI yet — but I will be soon! This is a preview of the onboarding experience." },
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
          <Link href="/pricing" style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.95rem' }}>Pricing</Link>
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
        <h2 style={{
          fontSize: '2.5rem',
          fontWeight: 800,
          textAlign: 'center',
          marginBottom: '0.5rem',
          textShadow: '0 2px 20px rgba(0,0,0,0.5)',
        }}>
          Tell us what you need.
        </h2>
        <p style={{
          fontSize: '1.1rem',
          color: 'rgba(255,255,255,0.6)',
          marginBottom: '2rem',
          textShadow: '0 1px 10px rgba(0,0,0,0.5)',
        }}>
          AI builds it. AI runs it. AI improves it.
        </p>

        {/* Chat Container — gradient transparency: solid left, transparent right */}
        <div style={{
          width: '100%',
          maxWidth: '680px',
          position: 'relative',
          borderRadius: '20px',
          overflow: 'hidden',
          boxShadow: '0 25px 80px rgba(0, 0, 0, 0.3), 0 0 40px rgba(99, 102, 241, 0.08)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
        }}>
          {/* Gradient background layer — opaque left, transparent right */}
          <div style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(to right, rgba(10, 10, 30, 0.85) 0%, rgba(10, 10, 30, 0.5) 40%, rgba(10, 10, 30, 0.15) 70%, rgba(10, 10, 30, 0.0) 100%)',
            backdropFilter: 'blur(40px)',
            WebkitMaskImage: 'linear-gradient(to right, black 0%, black 50%, rgba(0,0,0,0.5) 75%, rgba(0,0,0,0.2) 100%)',
            maskImage: 'linear-gradient(to right, black 0%, black 50%, rgba(0,0,0,0.5) 75%, rgba(0,0,0,0.2) 100%)',
            zIndex: 0,
          }} />
          {/* Content sits on top */}
          <div style={{ position: 'relative', zIndex: 1 }}>
          {/* Messages */}
          <div style={{
            height: '400px',
            overflowY: 'auto',
            padding: '1.5rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
          }}>
            {messages.map((msg, i) => (
              <div
                key={i}
                style={{
                  alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '85%',
                  padding: '0.8rem 1.2rem',
                  borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                  background: msg.role === 'user'
                    ? 'linear-gradient(135deg, #6366f1, #818cf8)'
                    : 'rgba(255, 255, 255, 0.08)',
                  fontSize: '0.95rem',
                  lineHeight: 1.5,
                }}
              >
                {msg.content || (isLoading ? '...' : '')}
              </div>
            ))}
          </div>

          {/* Input */}
          <div style={{
            padding: '1rem 1.5rem',
            borderTop: '1px solid rgba(255, 255, 255, 0.06)',
            display: 'flex',
            gap: '0.75rem',
          }}>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Describe your business..."
              style={{
                flex: 1,
                padding: '0.8rem 1rem',
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '12px',
                color: 'white',
                fontSize: '0.95rem',
                outline: 'none',
              }}
            />
            <button
              onClick={handleSend}
              disabled={isLoading || !input.trim()}
              style={{
                padding: '0.8rem 1.5rem',
                background: isLoading ? 'rgba(99, 102, 241, 0.5)' : '#6366f1',
                color: 'white',
                border: 'none',
                borderRadius: '12px',
                fontSize: '0.95rem',
                fontWeight: 600,
                cursor: isLoading ? 'wait' : 'pointer',
                transition: 'all 0.2s',
              }}
            >
              {isLoading ? '...' : 'Send'}
            </button>
          </div>
          </div>{/* close content wrapper */}
        </div>{/* close chat container */}

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

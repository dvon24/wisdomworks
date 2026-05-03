'use client';

import { useState } from 'react';

/**
 * Connect Your Tools — light theme version.
 * Phone number first (required), then optional integrations.
 */

interface ConnectionStatus {
  email: 'disconnected' | 'connecting' | 'connected';
  calendar: 'disconnected' | 'connecting' | 'connected';
  instagram: 'disconnected' | 'connecting' | 'connected';
}

interface ConnectToolsProps {
  onComplete: () => void;
  onSkip: () => void;
  businessName?: string;
  businessType?: string;
}

export default function ConnectTools({ onComplete, businessName, businessType }: ConnectToolsProps) {
  const [status, setStatus] = useState<ConnectionStatus>({
    email: 'disconnected',
    calendar: 'disconnected',
    instagram: 'disconnected',
  });
  const [phoneNumber, setPhoneNumber] = useState('');
  const [phoneSaved, setPhoneSaved] = useState(false);

  const connectedCount = Object.values(status).filter((s) => s === 'connected').length + (phoneSaved ? 1 : 0);

  const handleConnect = async (tool: keyof ConnectionStatus) => {
    setStatus((prev) => ({ ...prev, [tool]: 'connecting' }));
    setTimeout(() => setStatus((prev) => ({ ...prev, [tool]: 'connected' })), 2000);
  };

  const tools = [
    { key: 'email' as const, name: 'Email', emoji: '📧', description: 'Daily briefings and detailed reports.' },
    { key: 'calendar' as const, name: 'Calendar', emoji: '📅', description: 'Booking syncs to your phone calendar.' },
    { key: 'instagram' as const, name: 'Instagram', emoji: '📱', description: 'Marketing manages DMs and content.' },
  ];

  return (
    <div style={{ width: '100%' }}>
      {/* Phone number — required */}
      <div
        className={phoneSaved ? 'glass' : ''}
        style={{
          padding: '1.25rem',
          borderRadius: 14,
          marginBottom: '1rem',
          background: phoneSaved ? 'rgba(44, 176, 112, 0.08)' : 'var(--accent-soft)',
          border: `1px solid ${phoneSaved ? 'rgba(44, 176, 112, 0.3)' : 'var(--accent-line)'}`,
        }}
      >
        <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 4, color: 'var(--text)' }}>
          Your WhatsApp Number
        </div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 12, letterSpacing: '0.04em' }}>
          THIS IS HOW YOUR ASSISTANT REACHES YOU
        </div>
        {!phoneSaved ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="tel"
              placeholder="+1 555 123 4567"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              style={{
                flex: 1,
                padding: '10px 14px',
                borderRadius: 10,
                border: '1px solid var(--glass-border-strong)',
                background: 'rgba(255,255,255,0.65)',
                color: 'var(--text)',
                fontSize: 13.5,
                outline: 'none',
                fontFamily: 'inherit',
              }}
            />
            <button
              onClick={async () => {
                if (phoneNumber.length < 8) return;
                try {
                  await fetch('/api/link-phone', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phoneNumber, businessName, businessType }),
                  });
                  localStorage.setItem('wisdomworks_phone', phoneNumber);
                  setPhoneSaved(true);
                } catch (e) {
                  console.error('Link phone error:', e);
                }
              }}
              className="btn primary"
              style={{ padding: '10px 18px', fontSize: 13 }}
            >
              Save
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--ok)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 11, fontWeight: 700 }}>✓</div>
            <span style={{ color: '#1f7a48', fontSize: 13, fontWeight: 500 }}>Connected · {phoneNumber}</span>
          </div>
        )}
      </div>

      {/* Optional tools */}
      <div className="eyebrow" style={{ marginBottom: 10, paddingLeft: 4 }}>Optional integrations</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.25rem' }}>
        {tools.map((tool) => (
          <div
            key={tool.key}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0.85rem 1rem',
              borderRadius: 12,
              background: status[tool.key] === 'connected' ? 'rgba(44, 176, 112, 0.08)' : 'rgba(255, 255, 255, 0.5)',
              border: `1px solid ${status[tool.key] === 'connected' ? 'rgba(44, 176, 112, 0.3)' : 'var(--glass-border)'}`,
              transition: 'all 0.3s ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ fontSize: '1.25rem' }}>{tool.emoji}</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{tool.name}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>{tool.description}</div>
              </div>
            </div>
            <button
              onClick={() => handleConnect(tool.key)}
              disabled={status[tool.key] !== 'disconnected'}
              className={status[tool.key] === 'connected' ? 'btn ghost' : 'btn'}
              style={{ fontSize: 12, padding: '6px 12px', minWidth: 90, justifyContent: 'center' }}
            >
              {status[tool.key] === 'connected' ? '✓ Connected' : status[tool.key] === 'connecting' ? 'Connecting…' : 'Connect'}
            </button>
          </div>
        ))}
      </div>

      {/* Progress */}
      <div style={{ marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span className="eyebrow">Setup Progress</span>
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>{connectedCount}/{tools.length + 1}</span>
        </div>
        <div style={{ height: 4, borderRadius: 2, background: 'rgba(20,20,30,0.08)', overflow: 'hidden' }}>
          <div
            style={{
              height: '100%',
              borderRadius: 2,
              background: 'var(--accent)',
              width: `${(connectedCount / (tools.length + 1)) * 100}%`,
              transition: 'width 0.5s ease',
            }}
          />
        </div>
      </div>

      {/* Deploy */}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
        <button onClick={onComplete} disabled={!phoneSaved} className="btn primary" style={{ padding: '12px 28px', fontSize: 14, opacity: phoneSaved ? 1 : 0.5, cursor: phoneSaved ? 'pointer' : 'not-allowed' }}>
          {phoneSaved ? 'Deploy My Agents' : 'Save your phone number first'}
        </button>
      </div>
    </div>
  );
}

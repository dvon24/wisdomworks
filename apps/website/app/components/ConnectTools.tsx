'use client';

import { useState } from 'react';

/**
 * Connect Your Tools — onboarding step where the customer links their
 * existing apps to their AI agents. One-time setup.
 *
 * Supported: WhatsApp (QR scan), Email (OAuth), Calendar (OAuth), Instagram (OAuth)
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

export default function ConnectTools({ onComplete, onSkip, businessName, businessType }: ConnectToolsProps) {
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

    // OAuth flow for email, calendar, instagram
    // In production: opens popup/redirect to OAuth provider
    // For now: simulate the OAuth flow
    setTimeout(() => {
      setStatus((prev) => ({ ...prev, [tool]: 'connected' }));
    }, 2000);
  };

  const tools = [
    {
      key: 'email' as const,
      name: 'Email',
      emoji: '📧',
      description: 'Daily briefings and detailed reports delivered to your inbox.',
      required: false,
    },
    {
      key: 'calendar' as const,
      name: 'Calendar',
      emoji: '📅',
      description: 'Booking agent syncs directly with your phone calendar.',
      required: false,
    },
    {
      key: 'instagram' as const,
      name: 'Instagram',
      emoji: '📱',
      description: 'Marketing agent manages DMs and helps with content.',
      required: false,
    },
  ];

  return (
    <div style={{ width: '100%', animation: 'fadeIn 0.8s ease-out' }}>
      <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
        <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.4)', marginBottom: '0.3rem' }}>
          🔗 One-time setup
        </div>
        <h3 style={{ fontSize: '1.4rem', fontWeight: 700 }}>
          Connect Your Tools
        </h3>
        <p style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.5)', marginTop: '0.3rem' }}>
          Your agents need access to work for you. This takes 30 seconds.
        </p>
      </div>

      {/* Phone number input — links WhatsApp to their account */}
      <div style={{
        padding: '1rem 1.2rem', borderRadius: '12px', marginBottom: '1rem',
        background: phoneSaved ? 'rgba(34, 197, 94, 0.1)' : 'rgba(99, 102, 241, 0.08)',
        border: `1px solid ${phoneSaved ? 'rgba(34, 197, 94, 0.3)' : 'rgba(99, 102, 241, 0.2)'}`,
      }}>
        <div style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.5rem' }}>
          Your WhatsApp Number
        </div>
        <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.5)', marginBottom: '0.8rem' }}>
          This is how your AI assistant reaches you. Include country code.
        </div>
        {!phoneSaved ? (
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              type="tel"
              placeholder="+1 555 123 4567"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              style={{
                flex: 1, padding: '0.6rem 1rem', borderRadius: '8px',
                border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)',
                color: 'white', fontSize: '0.9rem', outline: 'none',
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
                  // Save phone for deploy-complete step
                  localStorage.setItem('wisdomworks_phone', phoneNumber);
                  setPhoneSaved(true);
                } catch (e) {
                  console.error('Link phone error:', e);
                }
              }}
              style={{
                padding: '0.6rem 1.2rem', borderRadius: '8px', border: 'none',
                background: '#6366f1', color: 'white', fontSize: '0.85rem',
                fontWeight: 600, cursor: 'pointer',
              }}
            >
              Save
            </button>
          </div>
        ) : (
          <div style={{ color: 'rgba(34, 197, 94, 0.9)', fontSize: '0.9rem', fontWeight: 600 }}>
            Connected — your assistant will text you here
          </div>
        )}
      </div>

      {/* Tool connections */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '1.5rem' }}>
        {tools.map((tool) => (
          <div key={tool.key} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '1rem 1.2rem', borderRadius: '12px',
            background: status[tool.key] === 'connected'
              ? 'rgba(34, 197, 94, 0.1)'
              : 'rgba(255, 255, 255, 0.04)',
            border: `1px solid ${status[tool.key] === 'connected' ? 'rgba(34, 197, 94, 0.3)' : 'rgba(255, 255, 255, 0.08)'}`,
            transition: 'all 0.3s ease',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
              <span style={{ fontSize: '1.5rem' }}>{tool.emoji}</span>
              <div>
                <div style={{ fontSize: '0.95rem', fontWeight: 600 }}>
                  {tool.name}
                  {tool.required && <span style={{ fontSize: '0.7rem', color: '#6366f1', marginLeft: '0.5rem' }}>recommended</span>}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.5)' }}>
                  {tool.description}
                </div>
              </div>
            </div>
            <button
              onClick={() => handleConnect(tool.key)}
              disabled={status[tool.key] !== 'disconnected'}
              style={{
                padding: '0.5rem 1.2rem',
                borderRadius: '8px',
                border: 'none',
                fontSize: '0.85rem',
                fontWeight: 600,
                cursor: status[tool.key] === 'disconnected' ? 'pointer' : 'default',
                background: status[tool.key] === 'connected'
                  ? 'rgba(34, 197, 94, 0.2)'
                  : status[tool.key] === 'connecting'
                    ? 'rgba(99, 102, 241, 0.3)'
                    : '#6366f1',
                color: 'white',
                transition: 'all 0.2s',
                minWidth: '100px',
              }}
            >
              {status[tool.key] === 'connected' ? '✓ Connected'
                : status[tool.key] === 'connecting' ? 'Connecting...'
                  : 'Connect'}
            </button>
          </div>
        ))}
      </div>

      {/* Progress */}
      <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.4)' }}>
          {connectedCount}/{tools.length + 1} connected
        </div>
        <div style={{
          height: '4px', borderRadius: '2px', marginTop: '0.5rem',
          background: 'rgba(255, 255, 255, 0.1)', overflow: 'hidden',
        }}>
          <div style={{
            height: '100%', borderRadius: '2px',
            background: '#6366f1',
            width: `${(connectedCount / (tools.length + 1)) * 100}%`,
            transition: 'width 0.5s ease',
          }} />
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'center' }}>
        <button onClick={onComplete} disabled={!phoneSaved} style={{
          padding: '0.7rem 1.8rem', background: phoneSaved ? '#6366f1' : 'rgba(99,102,241,0.5)',
          color: 'white', border: 'none', borderRadius: '10px', fontSize: '0.9rem', fontWeight: 600,
          cursor: phoneSaved ? 'pointer' : 'not-allowed',
        }}>
          {phoneSaved ? 'Deploy My Agents' : 'Enter your phone number first'}
        </button>
        <button onClick={onSkip} style={{
          padding: '0.7rem 1.8rem', background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)',
          border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', fontSize: '0.9rem', cursor: 'pointer',
        }}>
          Skip for now
        </button>
      </div>

      <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  );
}

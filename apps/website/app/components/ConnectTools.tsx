'use client';

import { useEffect, useState } from 'react';

/**
 * Connect Your Tools — real OAuth flows for Email, Calendar, Instagram.
 * Phone number first (required), then optional integrations.
 *
 * Email + Calendar: Google, Microsoft, or Apple (with app-specific password)
 * Instagram: Meta OAuth
 */

interface ConnectToolsProps {
  onComplete: () => void;
  onSkip: () => void;
  businessName?: string;
  businessType?: string;
}

type Provider = 'google' | 'microsoft' | 'apple';

interface ConnectionState {
  emailCalendar: { provider?: Provider; email?: string; status: 'disconnected' | 'connecting' | 'connected' };
  instagram: { username?: string; status: 'disconnected' | 'connecting' | 'connected' };
}

export default function ConnectTools({ onComplete, businessName, businessType }: ConnectToolsProps) {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [phoneSaved, setPhoneSaved] = useState(false);
  const [state, setState] = useState<ConnectionState>({
    emailCalendar: { status: 'disconnected' },
    instagram: { status: 'disconnected' },
  });
  const [showAppleForm, setShowAppleForm] = useState(false);
  const [appleEmail, setAppleEmail] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [websiteStatus, setWebsiteStatus] = useState<'idle' | 'analyzing' | 'connected' | 'error'>('idle');
  const [websiteError, setWebsiteError] = useState('');
  const [websitePlatform, setWebsitePlatform] = useState<string | null>(null);
  const [applePassword, setApplePassword] = useState('');
  const [appleError, setAppleError] = useState('');

  // Check URL for OAuth callback success/error
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauth = params.get('oauth');
    const provider = params.get('provider') as Provider | 'meta' | null;
    const services = params.get('services');
    const email = params.get('email');

    if (oauth === 'success' && provider && email) {
      if (provider === 'meta' && services?.includes('instagram')) {
        setState((s) => ({ ...s, instagram: { username: email, status: 'connected' } }));
      } else if ((provider === 'google' || provider === 'microsoft') && services?.includes('email')) {
        setState((s) => ({
          ...s,
          emailCalendar: { provider: provider as Provider, email, status: 'connected' },
        }));
      }
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname);
    }

    // Restore saved phone
    const savedPhone = localStorage.getItem('wisdomworks_phone');
    if (savedPhone) {
      setPhoneNumber(savedPhone);
      setPhoneSaved(true);
    }
  }, []);

  const connectedCount =
    (phoneSaved ? 1 : 0) +
    (state.emailCalendar.status === 'connected' ? 1 : 0) +
    (state.instagram.status === 'connected' ? 1 : 0);

  const startOAuth = (provider: Provider | 'meta') => {
    if (!phoneSaved) return;
    if (provider === 'apple') {
      setShowAppleForm(true);
      return;
    }
    // Save state before redirect so callback returns here
    localStorage.setItem('wisdomworks_phone', phoneNumber);
    setState((s) => ({
      ...s,
      [provider === 'meta' ? 'instagram' : 'emailCalendar']: { status: 'connecting' },
    }));
    window.location.href = `/api/oauth/${provider}?phone=${encodeURIComponent(phoneNumber)}`;
  };

  const submitApple = async () => {
    setAppleError('');
    try {
      const res = await fetch('/api/oauth/apple', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber, iCloudEmail: appleEmail, appPassword: applePassword }),
      });
      const data = await res.json();
      if (data.success) {
        setState((s) => ({
          ...s,
          emailCalendar: { provider: 'apple', email: appleEmail, status: 'connected' },
        }));
        setShowAppleForm(false);
      } else {
        setAppleError(data.error ?? 'Connection failed');
      }
    } catch (e) {
      setAppleError(String(e));
    }
  };

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
        <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 4, color: 'var(--text)' }}>Your WhatsApp Number</div>
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

      {/* Email + Calendar */}
      <div className="eyebrow" style={{ marginBottom: 10, paddingLeft: 4 }}>Email + Calendar</div>
      <div
        style={{
          padding: '1rem',
          borderRadius: 12,
          marginBottom: '1rem',
          background: state.emailCalendar.status === 'connected' ? 'rgba(44, 176, 112, 0.08)' : 'rgba(255,255,255,0.5)',
          border: `1px solid ${state.emailCalendar.status === 'connected' ? 'rgba(44, 176, 112, 0.3)' : 'var(--glass-border)'}`,
        }}
      >
        {state.emailCalendar.status === 'connected' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: '1.25rem' }}>✓</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                {state.emailCalendar.provider === 'google' ? 'Google' : state.emailCalendar.provider === 'microsoft' ? 'Microsoft' : 'Apple iCloud'} connected
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>{state.emailCalendar.email}</div>
            </div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginBottom: 12 }}>
              Daily briefings, drafted replies, and calendar sync. Pick your provider:
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={() => startOAuth('google')} disabled={!phoneSaved} className="btn" style={{ flex: 1, minWidth: 110, justifyContent: 'center', fontSize: 12 }}>
                <span style={{ marginRight: 6 }}>🟦</span> Google
              </button>
              <button onClick={() => startOAuth('microsoft')} disabled={!phoneSaved} className="btn" style={{ flex: 1, minWidth: 110, justifyContent: 'center', fontSize: 12 }}>
                <span style={{ marginRight: 6 }}>🟧</span> Microsoft
              </button>
              <button onClick={() => startOAuth('apple')} disabled={!phoneSaved} className="btn" style={{ flex: 1, minWidth: 110, justifyContent: 'center', fontSize: 12 }}>
                <span style={{ marginRight: 6 }}>⚫</span> Apple
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Apple form (modal) */}
      {showAppleForm && (
        <div className="glass" style={{ padding: '1.25rem', borderRadius: 12, marginBottom: '1rem' }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Connect Apple iCloud</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginBottom: 12, lineHeight: 1.5 }}>
            1. Go to <a href="https://appleid.apple.com" target="_blank" rel="noopener" style={{ color: 'var(--accent-deep)', textDecoration: 'underline' }}>appleid.apple.com</a> → Sign In<br/>
            2. Account Security → App-Specific Passwords → Generate one called "WisdomWorks"<br/>
            3. Paste the 16-character password below
          </div>
          <input
            type="email"
            placeholder="your@icloud.com"
            value={appleEmail}
            onChange={(e) => setAppleEmail(e.target.value)}
            style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--glass-border-strong)', background: 'rgba(255,255,255,0.65)', fontSize: 13, marginBottom: 8, fontFamily: 'inherit' }}
          />
          <input
            type="password"
            placeholder="xxxx-xxxx-xxxx-xxxx"
            value={applePassword}
            onChange={(e) => setApplePassword(e.target.value)}
            style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--glass-border-strong)', background: 'rgba(255,255,255,0.65)', fontSize: 13, fontFamily: 'monospace', marginBottom: 8 }}
          />
          {appleError && <div style={{ fontSize: 11.5, color: 'var(--bad-text)', marginBottom: 8 }}>{appleError}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={submitApple} className="btn primary" style={{ flex: 1, fontSize: 12, justifyContent: 'center' }}>Connect</button>
            <button onClick={() => { setShowAppleForm(false); setAppleError(''); }} className="btn ghost" style={{ fontSize: 12 }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Instagram */}
      {/* Website */}
      <div className="eyebrow" style={{ marginBottom: 10, paddingLeft: 4 }}>Your Website (optional)</div>
      <div
        style={{
          padding: '1rem',
          borderRadius: 12,
          marginBottom: '1rem',
          background: websiteStatus === 'connected' ? 'rgba(44, 176, 112, 0.08)' : 'rgba(255,255,255,0.5)',
          border: `1px solid ${websiteStatus === 'connected' ? 'rgba(44, 176, 112, 0.3)' : 'var(--glass-border)'}`,
        }}
      >
        {websiteStatus === 'connected' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: '1.25rem' }}>✓</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Website connected</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>
                {websiteUrl} · {websitePlatform ? `Platform: ${websitePlatform}` : 'Analyzed'}
              </div>
            </div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginBottom: 12 }}>
              Your agent will read it and propose improvements. URL only — we don't change anything without your approval.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="url"
                placeholder="https://yourbusiness.com"
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                disabled={websiteStatus === 'analyzing'}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--glass-border-strong)',
                  background: 'rgba(255,255,255,0.65)',
                  color: 'var(--text)',
                  fontSize: 13,
                  outline: 'none',
                  fontFamily: 'inherit',
                }}
              />
              <button
                onClick={async () => {
                  if (!websiteUrl || websiteUrl.length < 4) return;
                  setWebsiteStatus('analyzing');
                  setWebsiteError('');
                  try {
                    const res = await fetch('/api/analyze-website', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ url: websiteUrl, phoneNumber }),
                    });
                    const data = await res.json();
                    if (data.success && data.snapshot) {
                      setWebsiteStatus('connected');
                      setWebsitePlatform(data.snapshot.platform);
                    } else {
                      setWebsiteStatus('error');
                      setWebsiteError(data.error ?? 'Could not reach website');
                    }
                  } catch (e) {
                    setWebsiteStatus('error');
                    setWebsiteError(String(e));
                  }
                }}
                disabled={!phoneSaved || websiteStatus === 'analyzing'}
                className="btn"
                style={{ fontSize: 12, minWidth: 90, justifyContent: 'center' }}
              >
                {websiteStatus === 'analyzing' ? 'Analyzing…' : 'Analyze'}
              </button>
            </div>
            {websiteError && <div style={{ fontSize: 11, color: 'var(--bad-text)', marginTop: 6 }}>{websiteError}</div>}
          </div>
        )}
      </div>

      <div className="eyebrow" style={{ marginBottom: 10, paddingLeft: 4 }}>Instagram (optional)</div>
      <div
        style={{
          padding: '1rem',
          borderRadius: 12,
          marginBottom: '1.25rem',
          background: state.instagram.status === 'connected' ? 'rgba(44, 176, 112, 0.08)' : 'rgba(255,255,255,0.5)',
          border: `1px solid ${state.instagram.status === 'connected' ? 'rgba(44, 176, 112, 0.3)' : 'var(--glass-border)'}`,
        }}
      >
        {state.instagram.status === 'connected' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: '1.25rem' }}>✓</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Instagram connected</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>@{state.instagram.username}</div>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>📱 Instagram</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>Marketing manages DMs and content</div>
            </div>
            <button onClick={() => startOAuth('meta')} disabled={!phoneSaved} className="btn" style={{ fontSize: 12 }}>
              Connect
            </button>
          </div>
        )}
      </div>

      {/* Progress */}
      <div style={{ marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span className="eyebrow">Setup Progress</span>
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>{connectedCount}/3</span>
        </div>
        <div style={{ height: 4, borderRadius: 2, background: 'rgba(20,20,30,0.08)', overflow: 'hidden' }}>
          <div
            style={{
              height: '100%',
              borderRadius: 2,
              background: 'var(--accent)',
              width: `${(connectedCount / 3) * 100}%`,
              transition: 'width 0.5s ease',
            }}
          />
        </div>
      </div>

      {/* Deploy */}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
        <button
          onClick={onComplete}
          disabled={!phoneSaved}
          className="btn primary"
          style={{ padding: '12px 28px', fontSize: 14, opacity: phoneSaved ? 1 : 0.5, cursor: phoneSaved ? 'pointer' : 'not-allowed' }}
        >
          {phoneSaved ? 'Deploy My Agents' : 'Save your phone number first'}
        </button>
      </div>
    </div>
  );
}

'use client';

/**
 * Per-connection actions on the settings page: Disconnect button.
 * Client component because the action is interactive. router.refresh()
 * re-renders the server component so the row's status flips to revoked
 * (or disappears, depending on the table filter).
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function ConnectionActions({
  ownerPhone,
  provider,
  service,
  status,
}: {
  ownerPhone: string;
  provider: string;
  service: string;
  status: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  if (status !== 'active') {
    return <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{status}</span>;
  }

  const disconnect = async () => {
    setError(null);
    try {
      const res = await fetch('/api/connections/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: ownerPhone, provider, service }),
        credentials: 'include',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Failed (${res.status})`);
        return;
      }
      const body = await res.json();
      if (body.next_step_at_provider) {
        // Open the provider's revocation page in a new tab so the owner
        // can fully revoke the OAuth grant on their end too.
        window.open(body.next_step_at_provider, '_blank', 'noopener,noreferrer');
      }
      startTransition(() => router.refresh());
    } catch (err: any) {
      setError(err?.message ?? 'Network error');
    }
  };

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="deck-pill deck-pill-muted"
        style={{ border: 'none', cursor: 'pointer', font: 'inherit', padding: '4px 10px' }}
      >
        Disconnect
      </button>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <button
        type="button"
        onClick={disconnect}
        disabled={pending}
        className="deck-pill"
        style={{
          border: 'none',
          cursor: pending ? 'wait' : 'pointer',
          background: 'rgba(220, 38, 38, 0.15)',
          color: '#b91c1c',
          padding: '4px 10px',
          font: 'inherit',
          opacity: pending ? 0.6 : 1,
        }}
      >
        {pending ? 'Disconnecting…' : 'Confirm'}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={pending}
        style={{
          border: 'none',
          background: 'transparent',
          color: 'var(--text-faint)',
          fontSize: 11,
          cursor: 'pointer',
          padding: '4px 6px',
        }}
      >
        cancel
      </button>
      {error ? <span style={{ fontSize: 11, color: 'var(--bad-text)' }}>{error}</span> : null}
    </div>
  );
}

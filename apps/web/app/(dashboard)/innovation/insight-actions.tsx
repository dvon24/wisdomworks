'use client';

/**
 * Story 3.7 — Approve / Dismiss buttons for an insight card.
 * Client component because the action is interactive. Uses
 * router.refresh() to re-render the server component when the action
 * succeeds, so the card disappears from the open list.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function InsightActions({ insightId, ownerPhone }: { insightId: string; ownerPhone: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const act = async (action: 'approve' | 'dismiss') => {
    setError(null);
    try {
      const res = await fetch('/api/insights/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: insightId, action, phone: ownerPhone }),
        credentials: 'include',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Failed (${res.status})`);
        return;
      }
      startTransition(() => router.refresh());
    } catch (err: any) {
      setError(err?.message ?? 'Network error');
    }
  };

  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
      <button
        type="button"
        onClick={() => act('approve')}
        disabled={pending}
        className="deck-pill deck-pill-ok"
        style={{
          cursor: pending ? 'wait' : 'pointer',
          border: 'none',
          padding: '6px 14px',
          font: 'inherit',
          opacity: pending ? 0.6 : 1,
        }}
      >
        ✓ Approve
      </button>
      <button
        type="button"
        onClick={() => act('dismiss')}
        disabled={pending}
        className="deck-pill deck-pill-muted"
        style={{
          cursor: pending ? 'wait' : 'pointer',
          border: 'none',
          padding: '6px 14px',
          font: 'inherit',
          opacity: pending ? 0.6 : 1,
        }}
      >
        Dismiss
      </button>
      {error ? <span style={{ fontSize: 11, color: 'var(--bad-text)' }}>{error}</span> : null}
    </div>
  );
}

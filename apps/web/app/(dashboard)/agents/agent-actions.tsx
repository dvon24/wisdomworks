'use client';

/**
 * Story 3.5 — Agent lifecycle actions (Start / Stop / Snapshot all).
 *
 * Calls the existing /api/agents/lifecycle endpoint with the owner's
 * session cookie. router.refresh() after each action so the fleet
 * table re-renders with new status / counts.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

type Action = 'start' | 'stop' | 'snapshot' | 'tick';

export function FleetActions({ ownerPhone }: { ownerPhone: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const act = async (action: Action) => {
    setMsg(null);
    try {
      const res = await fetch('/api/agents/lifecycle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: ownerPhone, action }),
        credentials: 'include',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(`✗ ${body.error ?? 'failed'}`);
        return;
      }
      setMsg(formatResult(action, body));
      startTransition(() => router.refresh());
    } catch (err: any) {
      setMsg(`✗ ${err?.message ?? 'network error'}`);
    }
  };

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <button type="button" onClick={() => act('start')} disabled={pending} className="deck-pill deck-pill-ok" style={btnStyle(pending)}>
        ▶ Start all ready
      </button>
      <button type="button" onClick={() => act('tick')} disabled={pending} className="deck-pill deck-pill-info" style={btnStyle(pending)}>
        ⚡ Tick now
      </button>
      <button type="button" onClick={() => act('snapshot')} disabled={pending} className="deck-pill deck-pill-info" style={btnStyle(pending)}>
        📸 Snapshot all
      </button>
      <button type="button" onClick={() => act('stop')} disabled={pending} className="deck-pill deck-pill-warn" style={btnStyle(pending)}>
        ⏸ Pause all running
      </button>
      {msg ? <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{msg}</span> : null}
    </div>
  );
}

export function RecoverButton({ ownerPhone, instanceId }: { ownerPhone: string; instanceId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const recover = async () => {
    if (!confirm(`Roll this agent back to its most recent snapshot? Current state will be preserved (you can undo).`)) return;
    setMsg(null);
    try {
      const res = await fetch('/api/agents/lifecycle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: ownerPhone, action: 'recover', instance_id: instanceId }),
        credentials: 'include',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        setMsg(`✗ ${body.error ?? 'failed'}`);
        return;
      }
      setMsg(`✓ rolled back in ${body.durationMs}ms`);
      startTransition(() => router.refresh());
    } catch (err: any) {
      setMsg(`✗ ${err?.message ?? 'network error'}`);
    }
  };

  return (
    <>
      <button type="button" onClick={recover} disabled={pending} className="deck-pill deck-pill-muted" style={btnStyle(pending)}>
        ↺ Rollback
      </button>
      {msg ? <span style={{ fontSize: 11, color: 'var(--text-faint)', marginLeft: 8 }}>{msg}</span> : null}
    </>
  );
}

function btnStyle(pending: boolean): React.CSSProperties {
  return {
    cursor: pending ? 'wait' : 'pointer',
    border: 'none',
    padding: '6px 14px',
    font: 'inherit',
    opacity: pending ? 0.6 : 1,
  };
}

function formatResult(action: Action, body: any): string {
  if (action === 'start') return `✓ ${body.started ?? 0} started, ${body.alreadyRunning ?? 0} already running`;
  if (action === 'stop') return `✓ ${body.stopped ?? 0} paused (${body.snapshots ?? 0} snapshots taken)`;
  if (action === 'snapshot') return `✓ ${body.snapshots ?? 0} snapshots taken`;
  if (action === 'tick') return `✓ tick fired`;
  return '✓ done';
}

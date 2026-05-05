'use client';

import { useEffect, useState } from 'react';

/**
 * PriceDiff — floating toast that appears for ~3s after team composition changes.
 * Shows the cost delta and the new total. Self-dismisses with fade-out.
 */

interface PriceDiffProps {
  delta: number;
  total: number;
  currencySymbol?: string;
  onDismiss?: () => void;
  /** Auto-dismiss after this many ms (default 3500) */
  autoDismissMs?: number;
}

export function PriceDiff({
  delta,
  total,
  currencySymbol = '$',
  onDismiss,
  autoDismissMs = 3500,
}: PriceDiffProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => {
      setVisible(false);
      setTimeout(() => onDismiss?.(), 400);
    }, autoDismissMs);
    return () => clearTimeout(t);
  }, [autoDismissMs, onDismiss]);

  const isPositive = delta >= 0;
  const sign = isPositive ? '+' : '−';
  const deltaColor = isPositive ? 'var(--accent-deep)' : '#1f7a48';

  return (
    <div
      className="glass-strong"
      style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: `translateX(-50%) ${visible ? 'translateY(0)' : 'translateY(20px)'}`,
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.4s, transform 0.4s',
        padding: '14px 22px',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        boxShadow: '0 12px 40px rgba(20,20,40,0.18)',
        zIndex: 100,
      }}
    >
      <div>
        <div className="eyebrow" style={{ marginBottom: 2 }}>Team change</div>
        <div className="mono" style={{ fontSize: 18, fontWeight: 600, color: deltaColor }}>
          {sign}{currencySymbol}{Math.abs(delta)}/mo
        </div>
      </div>
      <div style={{ width: 1, height: 32, background: 'var(--glass-border)' }} />
      <div>
        <div className="eyebrow" style={{ marginBottom: 2 }}>New total</div>
        <div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>
          {currencySymbol}{total}/mo
        </div>
      </div>
    </div>
  );
}

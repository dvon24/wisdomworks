'use client';

/**
 * ActionCard — proposal card shown inside chat when Iris suggests a team change.
 * Used in both onboarding refine chat and Command Deck sidebar chat.
 *
 * User clicks Approve → action executes, card transitions to "✓ Applied"
 * User clicks Not now → card transitions to "Dismissed"
 */

export type ActionStatus = 'pending' | 'accepted' | 'rejected';

export interface ActionCardData {
  id: string;
  kind: 'add' | 'remove' | 'tier' | 'rename';
  agentId?: string;
  agentLabel: string;
  agentRole: string;
  delta: number;
  note: string;
  fromTier?: string;
  toTier?: string;
  newName?: string;
  status: ActionStatus;
}

interface ActionCardProps {
  action: ActionCardData;
  currencySymbol?: string;
  onAccept: () => void;
  onReject: () => void;
  onOpenPanel?: () => void;
}

export function ActionCard({ action, currencySymbol = '$', onAccept, onReject, onOpenPanel }: ActionCardProps) {
  if (action.status === 'accepted') {
    return (
      <div className="mono" style={{ fontSize: 10, color: '#1f7a48' }}>
        ✓ Applied
      </div>
    );
  }
  if (action.status === 'rejected') {
    return (
      <div className="mono" style={{ fontSize: 10, color: 'var(--text-faint)' }}>
        Dismissed
      </div>
    );
  }

  const isAdd = action.kind === 'add';
  const isRemove = action.kind === 'remove';
  const isTier = action.kind === 'tier';
  const isRename = action.kind === 'rename';
  const deltaStr = action.delta === 0 ? 'no cost change' : (action.delta >= 0 ? '+' : '−') + currencySymbol + Math.abs(action.delta) + '/mo';
  const deltaColor = action.delta === 0 ? 'var(--text-faint)' : action.delta >= 0 ? 'var(--accent-deep)' : '#1f7a48';

  return (
    <div
      style={{
        background: 'rgba(255,255,255,0.85)',
        border: '1px solid var(--glass-border-strong)',
        borderRadius: 14,
        padding: 12,
        width: '92%',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span className="pill info">
          {isAdd ? 'Add agent' : isRemove ? 'Remove agent' : isTier ? 'Tier change' : 'Rename'}
        </span>
        <span style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 11, color: deltaColor, fontWeight: 500 }}>
          {deltaStr}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 10 }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 9,
            background: 'var(--accent-soft)',
            color: 'var(--accent-deep)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          {action.agentLabel[0]}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 500 }}>
            {action.agentLabel}
            <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}> · {action.agentRole}</span>
          </div>
          {isTier ? (
            <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
              {action.fromTier} → {action.toTier}
            </div>
          ) : isRename ? (
            <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
              {action.agentLabel} → {action.newName}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.4, marginTop: 2 }}>{action.note}</div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={onReject} className="btn ghost" style={{ fontSize: 11, padding: '5px 10px' }}>
          Not now
        </button>
        {onOpenPanel && (
          <button onClick={onOpenPanel} className="btn ghost" style={{ fontSize: 11, padding: '5px 10px' }}>
            Open panel
          </button>
        )}
        <span style={{ flex: 1 }} />
        <button onClick={onAccept} className="btn primary" style={{ fontSize: 11, padding: '5px 12px' }}>
          {isAdd ? 'Add' : isRemove ? 'Remove' : isTier ? 'Switch' : 'Rename'}
        </button>
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { Hierarchy, type HierarchyAgent } from '@wisdomworks/ui';

/**
 * Example AI team preview shown below the chat — gives visitors an instant
 * sense of what they'll get before they go through onboarding.
 *
 * Auto-repair shop sample team. Click any agent to see their detail.
 */

const TIER_PRICE = { Haiku: 19, Sonnet: 39, Opus: 79 } as const;
const TIER_DESC = {
  Haiku: 'Fastest, lowest cost',
  Sonnet: 'Day-to-day reasoning',
  Opus: 'Critical reasoning, planning',
} as const;

interface ExampleAgent extends HierarchyAgent {
  desc: string;
  channels: string[];
  skills?: string;
  needs?: string;
}

const EXAMPLE_TEAM: ExampleAgent[] = [
  {
    id: 'iris',
    label: 'Iris',
    role: 'Personal assistant',
    tier: 'Opus',
    status: 'ok',
    required: true,
    desc: 'Daily briefings on orders, customer inquiries and business insights. Coordinates your entire team. Reach her anytime via WhatsApp + SMS.',
    channels: ['WhatsApp', 'Phone'],
  },
  {
    id: 'parts',
    label: 'PartsGenie',
    role: 'Parts specialist',
    tier: 'Sonnet',
    status: 'ok',
    desc: 'Instant parts lookup, compatibility checking, pricing and availability via WhatsApp. Knows your entire inventory.',
    channels: ['WhatsApp', 'Web chat'],
    skills: 'Parts lookup · Compatibility · Full inventory knowledge',
    needs: 'Inventory integration',
    subTeam: {
      count: 4,
      label: 'Specialty technicians',
      agents: [
        { id: 'parts-1', label: 'Cogs', role: 'Engine specialist', tier: 'Haiku' as const },
        { id: 'parts-2', label: 'Sparkle', role: 'Electrical', tier: 'Haiku' as const },
        { id: 'parts-3', label: 'Tread', role: 'Tires & wheels', tier: 'Haiku' as const },
        { id: 'parts-4', label: 'Brake', role: 'Brakes & suspension', tier: 'Haiku' as const },
      ],
    },
  },
  {
    id: 'service',
    label: 'ServiceAdvisor',
    role: 'Maintenance expert',
    tier: 'Opus',
    status: 'ok',
    desc: 'Answers maintenance questions, provides repair guides and schedules service reminders via WhatsApp automation.',
    channels: ['WhatsApp'],
    skills: 'Repair expertise · Repair guidance · Automated reminders',
    needs: 'Cannot perform physical inspections',
  },
  {
    id: 'order',
    label: 'OrderManager',
    role: 'Sales & fulfillment',
    tier: 'Sonnet',
    status: 'ok',
    desc: 'Processes orders, tracks shipments, handles returns and sends automated WhatsApp updates to customers.',
    channels: ['WhatsApp'],
    skills: 'Order automation · Shipment tracking · Customer updates',
    needs: 'E-commerce integration',
  },
  {
    id: 'care',
    label: 'CustomerCare',
    role: 'Support specialist',
    tier: 'Sonnet',
    status: 'warn',
    desc: 'Handles all customer service via WhatsApp Business API, escalates complex issues to you.',
    channels: ['WhatsApp'],
    skills: '24/7 support · Issue resolution · Smart escalation',
    needs: 'Complex issues need human intervention',
  },
];

const TOTAL_PRICE = EXAMPLE_TEAM.reduce((sum, a) => sum + (TIER_PRICE[a.tier as keyof typeof TIER_PRICE] || 0), 0);

export default function ExamplePreview() {
  const [selectedId, setSelectedId] = useState<string>('iris');
  const [focusedSubTeam, setFocusedSubTeam] = useState<string | null>(null);
  const detail = EXAMPLE_TEAM.find((a) => a.id === selectedId);

  return (
    <div style={{ width: '100%', maxWidth: 1240, margin: '0 auto', padding: '60px 24px 40px', position: 'relative', zIndex: 1 }}>
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>Example · Based on a real auto-repair shop</div>
        <div className="num-lg" style={{ fontWeight: 300 }}>What an AI team looks like</div>
        <div style={{ marginTop: 10, fontSize: 14, color: 'var(--text-dim)', maxWidth: 580, margin: '10px auto 0' }}>
          Iris coordinates four specialists. You'll only ever hear from one channel: WhatsApp. Click any agent to see what they do.
        </div>
      </div>

      <div
        className="glass-strong pop-in"
        style={{
          display: 'grid',
          gridTemplateColumns: '1.6fr 1fr',
          gap: 0,
          overflow: 'hidden',
          boxShadow: '0 24px 60px rgba(20,20,40,0.16)',
        }}
      >
        {/* Hierarchy */}
        <div style={{ padding: '24px 12px', borderRight: '1px solid var(--glass-border)', minHeight: 540 }}>
          <Hierarchy
            width={940}
            height={520}
            team={EXAMPLE_TEAM}
            principal={{ initials: 'MR', first: 'Marco', role: 'Owner' }}
            externals={[]}
            showExternals={false}
            showArcs
            accent="var(--accent)"
            onSelect={(agent) => setSelectedId(agent.id)}
            focusedSubTeam={focusedSubTeam}
            onSubTeamOpen={(parentId) => setFocusedSubTeam(parentId)}
            onSubTeamClose={() => setFocusedSubTeam(null)}
          />
        </div>

        {/* Detail panel */}
        <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 16, minHeight: 540 }}>
          <div className="eyebrow">Selected agent</div>
          {detail && (
            <div key={detail.id} style={{ display: 'flex', flexDirection: 'column', gap: 14, animation: 'fadeIn 0.3s ease' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    background: detail.id === 'iris' ? 'var(--accent)' : 'rgba(255,255,255,0.7)',
                    color: detail.id === 'iris' ? 'white' : 'var(--text)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 600,
                    fontSize: 18,
                    border: '1px solid var(--glass-border)',
                  }}
                >
                  {detail.id === 'iris' ? '✦' : detail.label[0]}
                </div>
                <div>
                  <div style={{ fontSize: 17, fontWeight: 600 }}>{detail.label}</div>
                  <div
                    className="mono"
                    style={{ fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.15em', marginTop: 2 }}
                  >
                    {detail.role}
                  </div>
                </div>
              </div>

              <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6 }}>{detail.desc}</div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {detail.channels.map((c) => (
                  <span key={c} className="pill info">
                    {c}
                  </span>
                ))}
              </div>

              {detail.skills && (
                <div style={{ fontSize: 12, color: 'var(--text-dim)', display: 'flex', alignItems: 'flex-start', gap: 6, lineHeight: 1.5 }}>
                  <span style={{ color: '#1f7a48' }}>✓</span>
                  <span>{detail.skills}</span>
                </div>
              )}
              {detail.needs && (
                <div style={{ fontSize: 12, color: 'var(--text-dim)', display: 'flex', alignItems: 'flex-start', gap: 6, lineHeight: 1.5 }}>
                  <span style={{ color: '#8a4f10' }}>⚠</span>
                  <span>{detail.needs}</span>
                </div>
              )}

              {/* Model row */}
              <div
                style={{
                  marginTop: 'auto',
                  padding: 12,
                  background: 'rgba(255,255,255,0.5)',
                  border: '1px solid var(--glass-border)',
                  borderRadius: 12,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span className="eyebrow">Model</span>
                  <span className="mono" style={{ fontSize: 10, color: 'var(--text-faint)' }}>
                    {TIER_DESC[detail.tier as keyof typeof TIER_DESC]}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontSize: 18, fontWeight: 600, color: 'var(--accent-deep)' }}>{detail.tier}</span>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                    €{TIER_PRICE[detail.tier as keyof typeof TIER_PRICE]}/mo
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Quick stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginTop: 18 }}>
        <div className="glass" style={{ padding: 16 }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Team total</div>
          <div className="num-md">€{TOTAL_PRICE}/mo</div>
        </div>
        <div className="glass" style={{ padding: 16 }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Coverage</div>
          <div className="num-md" style={{ fontSize: 18 }}>24/7 · WhatsApp</div>
        </div>
        <div className="glass" style={{ padding: 16 }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Setup time</div>
          <div className="num-md" style={{ fontSize: 18 }}>~2 minutes</div>
        </div>
      </div>
    </div>
  );
}

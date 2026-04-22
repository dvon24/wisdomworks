'use client';

/**
 * Agent Team Preview — dynamically generated from conversation context.
 * Each agent shows: name, role, channels, how they work, strengths, weaknesses, AI model, BMAD badge.
 */

export interface PreviewAgent {
  name: string;
  role: string;
  emoji: string;
  whatTheyDo: string[];
  channels: string[];     // How they communicate: WhatsApp, Instagram DM, Website Chat, etc.
  tools: string[];        // What they connect to: Apple Calendar, Instagram, your website
  strengths: string[];
  limitations: string[];
  aiModel: string;
  color: string;
}

interface AgentPreviewProps {
  businessName: string;
  agents: PreviewAgent[];
  connections: string[];
  estimatedPrice: string;
  employeeCount: number;
  costData?: {
    timeWastePerMonth?: string;
    missedRevenuePerMonth?: string;
    otherLosses?: string;
    totalPerMonth?: string;
    citations?: string[];
  };
  location?: {
    currency?: string;
    currencySymbol?: string;
    costOfLivingMultiplier?: number;
  };
  painPoints?: string[];
  onStartTrial: () => void;
  onAskQuestion: (question: string) => void;
}

export default function AgentPreview({
  businessName, agents, connections, estimatedPrice, employeeCount, costData, painPoints, location, onStartTrial, onAskQuestion,
}: AgentPreviewProps) {
  const coordinator = agents[0];
  const teamAgents = agents.slice(1);

  return (
    <div style={{ width: '100%', animation: 'fadeIn 0.8s ease-out' }}>
      <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
        <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.4)', marginBottom: '0.3rem' }}>✨ Meet your team</div>
        <h3 style={{ fontSize: '1.4rem', fontWeight: 700 }}>AI Team for {businessName}</h3>
      </div>

      {/* Coordinator */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>
        <div style={{
          padding: '1rem 1.5rem',
          background: 'linear-gradient(to right, rgba(99, 102, 241, 0.35) 0%, rgba(99, 102, 241, 0.1) 100%)',
          border: '1px solid rgba(99, 102, 241, 0.3)', borderRadius: '14px',
          textAlign: 'center', maxWidth: '380px', width: '100%',
        }}>
          <div style={{ fontSize: '1.8rem' }}>{coordinator?.emoji}</div>
          <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>{coordinator?.name}</div>
          <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)', marginBottom: '0.3rem' }}>{coordinator?.role}</div>
          {coordinator?.whatTheyDo.map((w, i) => (
            <div key={i} style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.7)' }}>• {w}</div>
          ))}
          <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', marginTop: '0.4rem' }}>
            Talks to you via: {coordinator?.channels.join(', ')}
          </div>
          <div style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.3)', marginTop: '0.2rem' }}>
            {coordinator?.aiModel} · 🔄 BMAD-Enabled
          </div>
        </div>
      </div>

      <div style={{ textAlign: 'center', margin: '0.3rem 0', fontSize: '0.65rem', color: 'rgba(255,255,255,0.2)', letterSpacing: '0.1em' }}>
        ── coordinates your team ──
      </div>

      {/* Team agents */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${Math.min(teamAgents.length, 3)}, 1fr)`,
        gap: '0.6rem', marginBottom: '1.2rem',
      }}>
        {teamAgents.map((agent, index) => {
          const opacityFactor = 1 - (index / Math.max(teamAgents.length, 1)) * 0.5;
          return (
            <div key={agent.name} style={{
              padding: '0.8rem',
              background: `linear-gradient(to right, ${agent.color}30, ${agent.color}08)`,
              border: `1px solid rgba(255,255,255,${(0.12 * opacityFactor).toFixed(2)})`,
              borderRadius: '12px',
              backdropFilter: `blur(${Math.round(25 * opacityFactor)}px)`,
            }}>
              <div style={{ fontSize: '1.3rem', marginBottom: '0.15rem' }}>{agent.emoji}</div>
              <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>{agent.name}</div>
              <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.5)', marginBottom: '0.35rem' }}>{agent.role}</div>

              {/* What they do */}
              {agent.whatTheyDo.map((w, i) => (
                <div key={i} style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.7)', marginBottom: '0.15rem' }}>• {w}</div>
              ))}

              {/* Channels */}
              <div style={{ fontSize: '0.7rem', color: 'rgba(99, 180, 255, 0.8)', marginTop: '0.3rem', marginBottom: '0.2rem' }}>
                📡 {agent.channels.join(' · ')}
              </div>

              {/* Tools */}
              <div style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.4)', marginBottom: '0.3rem' }}>
                🔗 {agent.tools.join(' · ')}
              </div>

              {/* Strengths */}
              <div style={{ fontSize: '0.65rem', marginBottom: '0.15rem' }}>
                <span style={{ color: '#22c55e' }}>✓ </span>
                <span style={{ color: 'rgba(255,255,255,0.6)' }}>{agent.strengths.join(', ')}</span>
              </div>

              {/* Limitations */}
              <div style={{ fontSize: '0.65rem', marginBottom: '0.2rem' }}>
                <span style={{ color: '#f59e0b' }}>△ </span>
                <span style={{ color: 'rgba(255,255,255,0.4)' }}>{agent.limitations.join(', ')}</span>
              </div>

              {/* Model + BMAD */}
              <div style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.3)' }}>
                {agent.aiModel} · 🔄 BMAD
              </div>
            </div>
          );
        })}
      </div>

      {/* Connections */}
      <div style={{ padding: '0.6rem 0.8rem', background: 'rgba(255,255,255,0.03)', borderRadius: '10px', marginBottom: '0.8rem' }}>
        <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', marginBottom: '0.3rem' }}>🔗 Connects to your existing tools:</div>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          {connections.map((c) => (
            <span key={c} style={{ padding: '0.2rem 0.6rem', background: 'rgba(255,255,255,0.07)', borderRadius: '6px', fontSize: '0.75rem', color: 'rgba(255,255,255,0.7)' }}>{c}</span>
          ))}
        </div>
      </div>

      {/* Side-by-side comparison */}
      {(() => {
        // Cost adjusted for location
        const costMultiplier = location?.costOfLivingMultiplier ?? 1.0;
        const sym = location?.currencySymbol ?? '$';
        let totalWithout: number;

        if (costData?.totalPerMonth) {
          const parsed = parseInt(costData.totalPerMonth.replace(/[^0-9]/g, '')) || 0;
          const maxCost = employeeCount <= 2 ? 10000 : employeeCount <= 20 ? 30000 : employeeCount <= 200 ? 100000 : 500000;
          totalWithout = Math.min(parsed, maxCost);
          if (totalWithout < 500) totalWithout = Math.round((employeeCount <= 2 ? 1800 : employeeCount <= 20 ? 8000 : 50000) * costMultiplier);
        } else {
          const base = employeeCount <= 2 ? 1800
            : employeeCount <= 20 ? 3000 + (employeeCount * 250)
            : employeeCount <= 200 ? 10000 + (employeeCount * 500)
            : 50000 + (employeeCount * 300);
          totalWithout = Math.round(base * costMultiplier);
        }

        const priceNum = parseInt(estimatedPrice.replace(/[^0-9]/g, '')) || 75;
        const userPainPoints = painPoints ?? [
          employeeCount <= 2 ? 'Missed calls and bookings while you\'re busy' : 'Time lost to coordination across teams',
          employeeCount <= 2 ? 'Hours spent on admin instead of clients' : `${Math.round(employeeCount * 0.28 * 8)} hours/day lost to admin tasks`,
          employeeCount <= 2 ? 'Clients who don\'t rebook because you forgot to follow up' : 'Inconsistent processes across departments',
          employeeCount <= 2 ? 'No visibility into what\'s working and what\'s not' : 'Knowledge leaves when employees do',
        ];

        return (
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem',
            marginBottom: '1.2rem',
          }}>
            {/* WITHOUT */}
            <div style={{
              padding: '1rem', borderRadius: '12px',
              background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.15), rgba(239, 68, 68, 0.05))',
              border: '1px solid rgba(239, 68, 68, 0.2)',
            }}>
              <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)', marginBottom: '0.5rem' }}>
                ❌ Without WisdomWorks
              </div>
              {userPainPoints.slice(0, 4).map((point, i) => (
                <div key={i} style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.7)', marginBottom: '0.3rem' }}>
                  • {point}{i < 3 ? ['¹', '²', '³'][i] : ''}
                </div>
              ))}
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#ef4444' }}>
                ~{sym}{totalWithout.toLocaleString()}/mo
              </div>
              <div style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.3)' }}>
                in productivity loss and missed revenue
              </div>
            </div>

            {/* WITH */}
            <div style={{
              padding: '1rem', borderRadius: '12px',
              background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.15), rgba(34, 197, 94, 0.05))',
              border: '1px solid rgba(34, 197, 94, 0.2)',
            }}>
              <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)', marginBottom: '0.5rem' }}>
                ✅ With WisdomWorks
              </div>
              <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.7)', marginBottom: '0.3rem' }}>
                • AI handles coordination instantly, 24/7
              </div>
              <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.7)', marginBottom: '0.3rem' }}>
                • Every inquiry answered in seconds
              </div>
              <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.7)', marginBottom: '0.3rem' }}>
                • Knowledge preserved permanently in AI
              </div>
              <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.7)', marginBottom: '0.5rem' }}>
                • Standardized processes enforced by agents
              </div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#22c55e' }}>
                {estimatedPrice}
              </div>
              <div style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.3)' }}>
                {Math.round((1 - priceNum / totalWithout) * 100)}% less than what you're losing
              </div>
            </div>
          </div>
        );
      })()}

      {/* Citations */}
      <div style={{ fontSize: '0.55rem', color: 'rgba(255,255,255,0.2)', marginBottom: '1rem', lineHeight: 1.6 }}>
        ¹ McKinsey Global Institute &nbsp;² Harvard Business Review &nbsp;³ SHRM
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'center' }}>
        <button onClick={onStartTrial} style={{
          padding: '0.7rem 1.8rem', background: '#6366f1', color: 'white', border: 'none',
          borderRadius: '10px', fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer',
        }}>Start Trial</button>
        <button onClick={() => onAskQuestion('')} style={{
          padding: '0.7rem 1.8rem', background: 'rgba(255,255,255,0.08)', color: 'white',
          border: '1px solid rgba(255,255,255,0.12)', borderRadius: '10px', fontSize: '0.9rem', cursor: 'pointer',
        }}>Ask Questions</button>
      </div>

      <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  );
}

// --- Rotating name pools ---
const NAMES: Record<string, string[]> = {
  coordinator: ['Aria', 'Sage', 'Nova', 'Iris', 'Cleo', 'Zara', 'Mira', 'Eden', 'Lyra', 'Vera'],
  booking: ['Luna', 'Stella', 'Ivy', 'Ruby', 'Pearl', 'Hazel', 'Jade', 'Opal', 'Wren', 'Faye'],
  marketing: ['Piper', 'Ember', 'Skye', 'Quinn', 'Remi', 'Bree', 'Kit', 'Tess', 'Blair', 'Sloane'],
  developer: ['Pixel', 'Dash', 'Link', 'Beacon', 'Atlas', 'Frame', 'Flux', 'Prism', 'Vector', 'Neo'],
};
function pick(role: string, seed: number): string {
  const pool = NAMES[role] ?? NAMES.coordinator!;
  return pool[seed % pool.length]!;
}

/**
 * Generate a team based on conversation context.
 * Smart enough to differentiate roles and assign proper channels.
 */
export function generateTeamForBusiness(
  businessName: string,
  hasWebsite: boolean,
  integrations: string[],
  employeeCount: number = 1,
  aiParsedAgents: { name: string; role: string; description: string }[] = [],
): { agents: PreviewAgent[]; connections: string[]; price: string } {
  const seed = businessName.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const colors = ['#6366f1', '#06b6d4', '#f59e0b', '#22c55e', '#a855f7', '#ec4899', '#14b8a6', '#f97316'];
  const emojis = ['✨', '📅', '📱', '💬', '💻', '📊', '🛡️', '👥', '📋', '🎯'];

  // IF the AI recommended specific agents, use THOSE instead of hardcoded ones
  if (aiParsedAgents.length > 0) {
    const agents: PreviewAgent[] = aiParsedAgents.map((parsed: any, i: number) => ({
      name: parsed.name ?? `Agent ${i + 1}`,
      role: parsed.role ?? parsed.name ?? 'AI Agent',
      emoji: parsed.emoji ?? emojis[i % emojis.length]!,
      whatTheyDo: Array.isArray(parsed.description)
        ? parsed.description
        : (parsed.description ?? '').split(/[,;]/).map((s: string) => s.trim()).filter(Boolean).slice(0, 4),
      channels: Array.isArray(parsed.channels) ? parsed.channels : ['WhatsApp', 'Dashboard'],
      tools: Array.isArray(parsed.tools) ? parsed.tools : integrations.slice(0, 3),
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths : ['AI-powered', '24/7 availability', 'Learns and improves'],
      limitations: Array.isArray(parsed.limitations) ? parsed.limitations : ['Escalates complex decisions to you'],
      aiModel: parsed.aiModel ?? (i === 0 ? 'Claude Sonnet 4.6' : 'Claude Opus 4.7'),
      color: colors[i % colors.length]!,
    }));

    // Price scales with agent count AND employee count
    const agentCount = agents.length;
    const perAgentCost = employeeCount <= 2 ? 18 : employeeCount <= 20 ? 15 : employeeCount <= 100 ? 12 : 10;
    const basePrice = Math.round(agentCount * perAgentCost);
    const maxPrice = Math.round(basePrice * 1.25);
    return {
      agents,
      connections: integrations,
      price: `Est. $${basePrice.toLocaleString()}-${maxPrice.toLocaleString()}/month`,
    };
  }

  // Fallback: hardcoded agents if AI didn't provide any
  const hasInstagram = integrations.some((i) => i.toLowerCase().includes('instagram'));
  const hasWhatsApp = integrations.some((i) => i.toLowerCase().includes('whatsapp'));
  const hasCalendar = integrations.some((i) => i.toLowerCase().includes('calendar'));

  const agents: PreviewAgent[] = [
    // COORDINATOR — the one the owner talks to
    {
      name: pick('coordinator', seed),
      role: 'Your Personal AI Assistant',
      emoji: '✨',
      whatTheyDo: [
        'Gives you a daily briefing of everything that happened',
        'Coordinates all your agents behind the scenes',
        'You ask questions, it gets answers from the team',
      ],
      channels: ['WhatsApp', 'SMS', 'Dashboard'],
      tools: ['All agent data'],
      strengths: ['Big picture view', 'Knows everything happening in your business'],
      limitations: ['Delegates specialized work to your other agents'],
      aiModel: 'Claude Sonnet 4.6',
      color: '#6366f1',
    },
    // BOOKING & CLIENT COMMUNICATION — handles scheduling AND chat
    {
      name: pick('booking', seed + 1),
      role: 'Booking & Client Communication',
      emoji: '📅',
      whatTheyDo: [
        'Books and reschedules appointments',
        'Responds to client messages and inquiries',
        'Sends reminders and confirmations',
        'Handles live chat on your website',
      ],
      channels: [
        hasWhatsApp ? 'WhatsApp' : '',
        hasInstagram ? 'Instagram DMs' : '',
        hasWebsite ? 'Website Chat' : '',
        'Phone/Voice AI',
      ].filter(Boolean),
      tools: [
        hasCalendar ? 'Apple Calendar' : 'Google Calendar',
        hasWhatsApp ? 'WhatsApp Business' : '',
        hasWebsite ? 'Your Website' : '',
      ].filter(Boolean),
      strengths: ['24/7 availability', 'Instant response', 'Never double-books'],
      limitations: ['Escalates complex requests to you', 'Can\'t assess service needs'],
      aiModel: 'Claude Opus 4.7',
      color: '#06b6d4',
    },
    // MARKETING — content and growth
    {
      name: pick('marketing', seed + 2),
      role: 'Marketing & Growth',
      emoji: '📱',
      whatTheyDo: [
        'Plans and suggests social media content',
        'Runs seasonal promotions and campaigns',
        'Re-engages past clients who haven\'t booked',
        'Tracks what\'s working and what\'s not',
      ],
      channels: [
        hasInstagram ? 'Instagram' : '',
        'Email',
      ].filter(Boolean),
      tools: [
        hasInstagram ? 'Instagram' : '',
        hasWebsite ? 'Your Website' : '',
      ].filter(Boolean),
      strengths: ['Seasonal awareness', 'Data-driven suggestions', 'Consistent presence'],
      limitations: ['Needs your approval before posting', 'Can\'t create photos/videos'],
      aiModel: 'Claude Sonnet 4.6',
      color: '#f59e0b',
    },
  ];

  // WEBSITE DEVELOPER — only if they have a website with someone managing it
  if (hasWebsite) {
    agents.push({
      name: pick('developer', seed + 3),
      role: 'Website Developer',
      emoji: '💻',
      whatTheyDo: [
        'Keeps your website updated with latest services and pricing',
        'Adds booking widgets and chat functionality',
        'Optimizes for search engines (SEO)',
        'Works alongside your brother\'s existing setup',
      ],
      channels: ['Dashboard'],
      tools: ['Your Website', 'Analytics'],
      strengths: ['Automated updates', 'SEO optimization', 'Adds features without breaking things'],
      limitations: ['Won\'t redesign the whole site', 'Major changes need human review'],
      aiModel: 'Claude Sonnet 4.6',
      color: '#a855f7',
    });
  }

  const perAgent = employeeCount <= 2 ? 18 : employeeCount <= 20 ? 15 : 12;
  const basePrice = Math.round(agents.length * perAgent);
  return {
    agents,
    connections: integrations,
    price: `Est. $${basePrice}-${basePrice + 25}/month`,
  };
}

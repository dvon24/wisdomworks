'use client';

import { useEffect, useState } from 'react';
import { WisdomMarkInline } from './wisdom-mark';

/**
 * Hierarchy diagram — You → Iris → Specialists with optional tools row.
 * Animated comm arc cycles through specialists.
 */

export type AgentTier = 'Haiku' | 'Sonnet' | 'Opus';
export type AgentStatus = 'ok' | 'warn' | 'bad';

export interface HierarchyAgent {
  id: string;
  label: string;
  role: string;
  tier?: AgentTier;
  status?: AgentStatus;
  required?: boolean;
  ghost?: boolean;
}

export interface HierarchyExternal {
  id: string;
  label: string;
  kind: 'client' | 'tool';
  links: string[];
}

export interface HierarchyPrincipal {
  initials: string;
  first: string;
  role: string;
}

interface HierarchyProps {
  width?: number;
  height?: number;
  team: HierarchyAgent[];
  principal: HierarchyPrincipal;
  externals?: HierarchyExternal[];
  showExternals?: boolean;
  showArcs?: boolean;
  accent?: string;
  pendingAdd?: HierarchyAgent | null;
  pendingRemove?: string | null;
  recentlyAdded?: string | null;
  onSelect?: (agent: HierarchyAgent) => void;
}

export function Hierarchy({
  width = 940,
  height = 460,
  team,
  principal,
  externals = [],
  showExternals = true,
  showArcs = true,
  accent = '#7c3aed',
  pendingAdd = null,
  pendingRemove = null,
  recentlyAdded = null,
  onSelect,
}: HierarchyProps) {
  const cx = width / 2;
  const principalPos = { x: cx, y: 50 };
  const personalPos = { x: cx, y: 140 };

  const iris = team.find((a) => a.id === 'iris') ?? team[0];
  const specs = team.filter((a) => a.id !== iris?.id);
  const renderList: HierarchyAgent[] = pendingAdd
    ? [...specs, { ...pendingAdd, id: '__ghost', ghost: true }]
    : specs;

  const specY = 270;
  const span = width - 100;
  const positions = renderList.map((s, i) => ({
    ...s,
    x: 50 + (span * (i + 0.5)) / Math.max(1, renderList.length),
    y: specY,
  }));
  const specById: Record<string, (typeof positions)[number]> = Object.fromEntries(positions.map((s) => [s.id, s]));

  const [activeIdx, setActiveIdx] = useState(0);
  useEffect(() => {
    if (!showArcs || positions.length === 0) return;
    const t = setInterval(() => setActiveIdx((i) => (i + 1) % Math.max(1, positions.length)), 1900);
    return () => clearInterval(t);
  }, [showArcs, positions.length]);

  const exts = showExternals
    ? externals.map((e, i) => ({
        ...e,
        x: 60 + ((width - 120) * (i + 0.5)) / Math.max(1, externals.length),
        y: specY + 130 + (i % 2 === 0 ? 0 : 22),
      }))
    : [];

  const arc = (x1: number, y1: number, x2: number, y2: number, lift = 30) => {
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2 - lift;
    return `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`;
  };

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%" style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <radialGradient id="hierarchy-halo" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={accent} stopOpacity="0.4" />
          <stop offset="100%" stopColor={accent} stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* principal -> personal */}
      <line
        x1={principalPos.x}
        y1={principalPos.y + 22}
        x2={personalPos.x}
        y2={personalPos.y - 30}
        stroke="rgba(20,20,30,0.28)"
        strokeWidth="1.2"
      />

      {/* personal -> specialists */}
      {positions.map((s) => (
        <path
          key={'l1-' + s.id}
          d={arc(personalPos.x, personalPos.y + 30, s.x, s.y - 18, 30)}
          fill="none"
          stroke={s.ghost ? accent : 'rgba(20,20,30,0.18)'}
          strokeWidth={s.ghost ? 1.4 : 1}
          strokeDasharray={s.ghost ? '4 4' : 'none'}
          opacity={s.id === pendingRemove ? 0.25 : 1}
          style={{ transition: 'opacity .4s' }}
        />
      ))}

      {/* specialists -> externals */}
      {exts.map((e) =>
        e.links.map((sid) => {
          const s = specById[sid];
          if (!s) return null;
          return (
            <path
              key={'l2-' + e.id + '-' + sid}
              d={arc(s.x, s.y + 14, e.x, e.y - 8, 16)}
              fill="none"
              stroke="rgba(20,20,30,0.13)"
              strokeWidth="0.8"
              strokeDasharray="3 4"
            />
          );
        }),
      )}

      {/* live comm arc */}
      {showArcs && positions[activeIdx] && !positions[activeIdx].ghost && (
        <g>
          <path
            d={arc(personalPos.x, personalPos.y + 30, positions[activeIdx].x, positions[activeIdx].y - 18, 38)}
            fill="none"
            stroke={accent}
            strokeWidth="2"
            opacity="0.85"
          />
          <circle r="3.5" fill={accent}>
            <animateMotion
              dur="1.4s"
              repeatCount="indefinite"
              path={arc(personalPos.x, personalPos.y + 30, positions[activeIdx].x, positions[activeIdx].y - 18, 38)}
            />
          </circle>
        </g>
      )}

      {/* Principal (You) */}
      <g>
        <circle cx={principalPos.x} cy={principalPos.y} r="22" fill="rgba(255,255,255,0.88)" stroke="rgba(20,20,30,0.2)" />
        <text x={principalPos.x} y={principalPos.y + 4} textAnchor="middle" fontSize="11" fontWeight="600" fill="#1a1a22">
          {principal.initials}
        </text>
        <text
          x={principalPos.x}
          y={principalPos.y + 38}
          textAnchor="middle"
          fontSize="9"
          fill="rgba(26,26,34,0.55)"
          fontFamily="Geist Mono"
        >
          {principal.first.toUpperCase()} · {principal.role.toUpperCase()}
        </text>
      </g>

      {/* Iris (Personal Assistant) */}
      {iris && (
        <g style={{ cursor: onSelect ? 'pointer' : 'default' }} onClick={() => onSelect?.(iris)}>
          <circle cx={personalPos.x} cy={personalPos.y} r="38" fill="url(#hierarchy-halo)" className="breathe" />
          <circle
            cx={personalPos.x}
            cy={personalPos.y}
            r="28"
            fill="rgba(255,255,255,0.96)"
            stroke={accent}
            strokeOpacity="0.4"
            strokeWidth="1"
          />
          <WisdomMarkInline cx={personalPos.x} cy={personalPos.y} scale={0.46} accent={accent} satellite={accent} animate />
          <text
            x={personalPos.x}
            y={personalPos.y + 46}
            textAnchor="middle"
            fontSize="10"
            fontWeight="600"
            fill="#1a1a22"
            style={{ pointerEvents: 'none' }}
          >
            {iris.label}
          </text>
          {iris.tier && (
            <text
              x={personalPos.x}
              y={personalPos.y + 60}
              textAnchor="middle"
              fontSize="9"
              fill={accent}
              fontFamily="Geist Mono"
              fontWeight="500"
              letterSpacing="0.06em"
              style={{ pointerEvents: 'none' }}
            >
              {iris.tier.toUpperCase()}
            </text>
          )}
        </g>
      )}

      {/* Specialists */}
      {positions.map((s, i) => {
        const isActive = i === activeIdx && showArcs && !s.ghost;
        const dotColor =
          s.status === 'ok' ? '#2cb070' : s.status === 'warn' ? '#d99b3b' : s.status === 'bad' ? '#c84545' : '#888';
        const isRemoving = s.id === pendingRemove;
        const isAdded = s.id === recentlyAdded;
        const className = s.ghost || isAdded ? 'pop-in' : isRemoving ? 'fade-out' : '';
        return (
          <g
            key={s.id}
            className={className}
            opacity={s.ghost ? 0.7 : 1}
            style={{ cursor: onSelect && !s.ghost ? 'pointer' : 'default' }}
            onClick={() => !s.ghost && onSelect?.(s)}
          >
            {isActive && <circle cx={s.x} cy={s.y} r="22" fill={accent} opacity="0.18" />}
            <circle
              cx={s.x}
              cy={s.y}
              r="14"
              fill={s.ghost ? 'rgba(124,58,237,0.18)' : 'rgba(255,255,255,0.94)'}
              stroke={isActive ? accent : s.ghost ? accent : 'rgba(20,20,30,0.18)'}
              strokeWidth={isActive || s.ghost ? 1.6 : 1}
              strokeDasharray={s.ghost ? '3 3' : 'none'}
            />
            {!s.ghost && s.status && <circle cx={s.x + 9} cy={s.y - 9} r="3" fill={dotColor} />}
            <text
              x={s.x}
              y={s.y + 4}
              textAnchor="middle"
              fontSize="10"
              fontWeight="600"
              fill={s.ghost ? accent : '#1a1a22'}
              style={{ pointerEvents: 'none' }}
            >
              {s.ghost ? '+' : s.label[0]}
            </text>
            <text x={s.x} y={s.y + 30} textAnchor="middle" fontSize="10" fontWeight="500" fill="#1a1a22" style={{ pointerEvents: 'none' }}>
              {s.label}
            </text>
            <text
              x={s.x}
              y={s.y + 43}
              textAnchor="middle"
              fontSize="9"
              fill="rgba(26,26,34,0.5)"
              fontFamily="Geist Mono"
              style={{ pointerEvents: 'none' }}
            >
              {s.role.toUpperCase()}
            </text>
            {!s.ghost && s.tier && (
              <g style={{ pointerEvents: 'none' }}>
                <rect
                  x={s.x - 26}
                  y={s.y + 49}
                  width="52"
                  height="14"
                  rx="7"
                  fill={accent}
                  fillOpacity="0.12"
                  stroke={accent}
                  strokeOpacity="0.4"
                  strokeWidth="0.8"
                />
                <text
                  x={s.x}
                  y={s.y + 59}
                  textAnchor="middle"
                  fontSize="8.5"
                  fontFamily="Geist Mono"
                  fontWeight="500"
                  fill={accent}
                  letterSpacing="0.06em"
                >
                  {s.tier.toUpperCase()}
                </text>
              </g>
            )}
          </g>
        );
      })}

      {/* Externals */}
      {exts.map((e) => (
        <g key={e.id} opacity="0.85">
          <rect x={e.x - 30} y={e.y - 9} width="60" height="18" rx="9" fill="rgba(255,255,255,0.62)" stroke="rgba(20,20,30,0.12)" />
          <text x={e.x} y={e.y + 4} textAnchor="middle" fontSize="9" fill="rgba(26,26,34,0.7)" fontFamily="Geist Mono">
            {e.label.toUpperCase()}
          </text>
        </g>
      ))}
    </svg>
  );
}

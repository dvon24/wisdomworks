'use client';

import { useEffect, useState } from 'react';
import { WisdomMarkInline } from './wisdom-mark';

/**
 * Hierarchy diagram — You → Iris → Specialists with optional tools row.
 * Animated comm arc cycles through specialists.
 */

export type AgentTier = 'Haiku' | 'Sonnet' | 'Opus';
export type AgentStatus = 'ok' | 'warn' | 'bad';

export interface HierarchySubAgent {
  id: string;
  label: string;
  role: string;
  tier?: AgentTier;
}

export interface HierarchySubTeam {
  count: number;
  label: string;
  agents: HierarchySubAgent[];
}

export interface HierarchyAgent {
  id: string;
  label: string;
  role: string;
  tier?: AgentTier;
  status?: AgentStatus;
  required?: boolean;
  ghost?: boolean;
  /** When set, shows a pulsing badge on this agent. Click opens focused sub-team view. */
  subTeam?: HierarchySubTeam;
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
  /** Max specialists to render individually before clustering (default 8) */
  maxIndividualNodes?: number;
  /** ID of the parent agent whose sub-team is currently focused (zoomed-in view) */
  focusedSubTeam?: string | null;
  /** Called when user clicks the sub-team badge on a parent agent */
  onSubTeamOpen?: (parentId: string) => void;
  /** Called when user clicks "Back to team" in the focused sub-team view */
  onSubTeamClose?: () => void;
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
  maxIndividualNodes = 8,
  focusedSubTeam = null,
  onSubTeamOpen,
  onSubTeamClose,
}: HierarchyProps) {
  const cx = width / 2;
  const principalPos = { x: cx, y: 50 };
  const personalPos = { x: cx, y: 140 };

  const iris = team.find((a) => a.id === 'iris') ?? team[0];
  const specs = team.filter((a) => a.id !== iris?.id);

  // Cluster employee assistants when there are too many to render individually.
  // Identify them by Tier 3 (Haiku) + role contains "employee" or "assistant"
  const isEmployeeAssistant = (a: HierarchyAgent) =>
    a.tier === 'Haiku' &&
    (a.role.toLowerCase().includes('employee') || a.role.toLowerCase().includes('personal'));

  let displaySpecs = specs;
  let clusteredCount = 0;
  if (specs.length > maxIndividualNodes) {
    const employeeAssistants = specs.filter(isEmployeeAssistant);
    const others = specs.filter((a) => !isEmployeeAssistant(a));

    // If clustering employees brings us under the threshold, do it
    if (employeeAssistants.length >= 4 && others.length + 1 <= maxIndividualNodes) {
      clusteredCount = employeeAssistants.length;
      const clusterNode: HierarchyAgent = {
        id: '__cluster_employees',
        label: `${clusteredCount} Employees`,
        role: 'Personal Assistants',
        tier: 'Haiku',
        status: 'ok',
      };
      displaySpecs = [...others, clusterNode];
    }
  }

  const renderList: HierarchyAgent[] = pendingAdd
    ? [...displaySpecs, { ...pendingAdd, id: '__ghost', ghost: true }]
    : displaySpecs;

  const specY = 270;
  const span = width - 100;
  // Stagger y-positions when there are many specialists so labels don't collide.
  // Even-indexed agents sit on the top row, odd-indexed sit lower.
  const stagger = renderList.length >= 7;
  const positions = renderList.map((s, i) => ({
    ...s,
    x: 50 + (span * (i + 0.5)) / Math.max(1, renderList.length),
    y: stagger && i % 2 === 1 ? specY + 80 : specY,
  }));
  const specById: Record<string, (typeof positions)[number]> = Object.fromEntries(positions.map((s) => [s.id, s]));

  const [activeIdx, setActiveIdx] = useState(0);
  useEffect(() => {
    if (!showArcs || positions.length === 0) return;
    const t = setInterval(() => setActiveIdx((i) => (i + 1) % Math.max(1, positions.length)), 1900);
    return () => clearInterval(t);
  }, [showArcs, positions.length]);

  // Sub-team peer comm pulse — runs when a sub-team is focused
  const [peerIdx, setPeerIdx] = useState(0);
  useEffect(() => {
    if (!focusedSubTeam) return;
    const t = setInterval(() => setPeerIdx((i) => i + 1), 1700);
    return () => clearInterval(t);
  }, [focusedSubTeam]);

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

  // Focused sub-team view rendering
  const renderFocusedSubTeam = () => {
    const parent = team.find((a) => a.id === focusedSubTeam);
    if (!parent || !parent.subTeam) return null;

    // If subTeam.count > agents listed, generate placeholder agents with friendly names.
    // This happens when the AI says "20 employee assistants" but doesn't list each by name.
    const listed = parent.subTeam.agents;
    const count = parent.subTeam.count;
    const subs: HierarchySubAgent[] = [...listed];
    if (count > listed.length) {
      // Curated pool of short, modern, gender-neutral names — pick deterministically by index
      // so the same agent always has the same name across renders.
      const names = [
        'Sage', 'River', 'Quinn', 'Avery', 'Rowan', 'Sky', 'Wren', 'Emery',
        'Kai', 'Nova', 'Phoenix', 'Reese', 'Indigo', 'Lark', 'Vale', 'Ember',
        'Cove', 'Ash', 'Linden', 'Marlow', 'Tate', 'Sloane', 'Briar', 'Onyx',
        'Pax', 'Lux', 'Wynn', 'Echo', 'Rune', 'Eden', 'Auden', 'Soren',
        'Nova', 'Astrid', 'Holland', 'Elliot', 'Finley', 'Hadley', 'Iver', 'June',
        'Kit', 'Lane', 'Mae', 'Nico', 'Ocean', 'Poe', 'Remy', 'Sage',
      ];
      // Skip names that are already used by listed agents to avoid duplicates
      const usedLabels = new Set(listed.map((a) => a.label.toLowerCase()));
      let nameIdx = 0;
      for (let i = listed.length; i < count; i++) {
        let name = names[nameIdx % names.length]!;
        while (usedLabels.has(name.toLowerCase())) {
          nameIdx++;
          name = names[nameIdx % names.length]!;
        }
        usedLabels.add(name.toLowerCase());
        nameIdx++;
        subs.push({
          id: `${parent.id}-generated-${i}`,
          label: name,
          role: parent.subTeam.label.replace(/s$/, ''),
          tier: parent.tier ?? 'Haiku',
        });
      }
    }

    const fcx = width / 2;
    const parentY = 100;

    // Multi-row layout when there are many sub-agents.
    // 6 per row max — keeps labels readable
    const PER_ROW = 6;
    const rows = Math.ceil(subs.length / PER_ROW);
    const ROW_HEIGHT = 110;
    const firstRowY = 240;
    const innerSpan = width - 200;

    const subPos = subs.map((sub, j) => {
      const row = Math.floor(j / PER_ROW);
      const colInRow = j % PER_ROW;
      const itemsInRow = row === rows - 1 ? subs.length - row * PER_ROW : PER_ROW;
      return {
        sub,
        x: 100 + (innerSpan * (colInRow + 0.5)) / itemsInRow,
        y: firstRowY + row * ROW_HEIGHT,
      };
    });

    // Peer pulse — within first row only (visual clarity)
    const firstRowSubs = subPos.slice(0, Math.min(PER_ROW, subs.length));
    const peerActive = (() => {
      const n = firstRowSubs.length;
      if (n < 2) return null;
      const a = peerIdx % n;
      const b = (a + 1 + (peerIdx % 2)) % n;
      if (a === b) return null;
      return { a, b };
    })();
    const peerActivePath = peerActive
      ? (() => {
          const sx = firstRowSubs[peerActive.a]!.x;
          const sx2 = firstRowSubs[peerActive.b]!.x;
          const sy = firstRowSubs[peerActive.a]!.y;
          const dist = Math.abs(peerActive.b - peerActive.a);
          const lift = 30 + Math.min(dist, 3) * 12;
          return `M ${sx} ${sy - 18} Q ${(sx + sx2) / 2} ${sy - lift} ${sx2} ${sy - 18}`;
        })()
      : null;
    const mgrActiveIdx = subPos.length > 0 ? peerIdx % subPos.length : 0;
    const mgrTarget = subPos[mgrActiveIdx];
    const mgrPath = mgrTarget ? arc(fcx, parentY + 28, mgrTarget.x, mgrTarget.y - 22, 38) : '';

    return (
      <g key={'focus-' + focusedSubTeam} style={{ animation: 'fadeIn 0.4s ease' }}>
        {/* Back button */}
        <foreignObject x="14" y="14" width="160" height="32">
          <button
            onClick={() => onSubTeamClose?.()}
            style={{
              padding: '6px 12px',
              background: 'rgba(255,255,255,0.7)',
              border: '1px solid rgba(20,20,30,0.12)',
              borderRadius: 999,
              fontSize: 12,
              color: 'rgba(26,26,34,0.7)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontFamily: 'inherit',
            }}
          >
            <span style={{ fontSize: 14 }}>‹</span> Back to team
          </button>
        </foreignObject>

        {/* Parent agent */}
        <circle cx={fcx} cy={parentY} r="44" fill="url(#hierarchy-halo)" className="breathe" />
        <circle cx={fcx} cy={parentY} r="28" fill="rgba(255,255,255,0.96)" stroke={accent} strokeWidth="2" />
        <text x={fcx} y={parentY + 5} textAnchor="middle" fontSize="14" fontWeight="600" fill="#1a1a22">
          {parent.label[0]}
        </text>
        <text x={fcx} y={parentY + 56} textAnchor="middle" fontSize="13" fontWeight="600" fill="#1a1a22">
          {parent.label}
        </text>
        <text x={fcx} y={parentY + 74} textAnchor="middle" fontSize="10" fill="rgba(26,26,34,0.55)" fontFamily="Geist Mono" letterSpacing="0.06em">
          {parent.role.toUpperCase()}
        </text>

        {/* Parent → sub connectors (only first row to avoid clutter) */}
        {subPos.slice(0, PER_ROW).map(({ sub, x, y }) => (
          <path
            key={'l-sub-' + sub.id}
            d={arc(fcx, parentY + 28, x, y - 22, 30)}
            fill="none"
            stroke={accent}
            strokeOpacity="0.3"
            strokeWidth="1"
            strokeDasharray="3 4"
          />
        ))}

        {/* Static peer-to-peer arcs (within first row) */}
        {firstRowSubs.map((_, j) =>
          firstRowSubs.slice(j + 1).map((__, k) => {
            const j2 = j + 1 + k;
            const dist = j2 - j;
            if (dist > 2) return null;
            const sx = firstRowSubs[j]!.x;
            const sx2 = firstRowSubs[j2]!.x;
            const sy = firstRowSubs[j]!.y;
            const lift = 30 + dist * 12;
            return (
              <path
                key={`peer-${j}-${j2}`}
                d={`M ${sx} ${sy - 18} Q ${(sx + sx2) / 2} ${sy - lift} ${sx2} ${sy - 18}`}
                fill="none"
                stroke={accent}
                strokeOpacity="0.15"
                strokeWidth="0.8"
                strokeDasharray="2 3"
              />
            );
          }),
        )}

        {/* Active peer pulse */}
        {peerActive && peerActivePath && (
          <g key={`pulse-${peerIdx}`}>
            <path d={peerActivePath} fill="none" stroke={accent} strokeWidth="1.6" strokeOpacity="0.7" />
            <circle r="3" fill={accent}>
              <animateMotion dur="1.4s" repeatCount="indefinite" path={peerActivePath} />
            </circle>
          </g>
        )}

        {/* Active manager → sub-agent pulse */}
        {mgrPath && (
          <g key={`mgr-${peerIdx}`}>
            <path d={mgrPath} fill="none" stroke={accent} strokeWidth="2" opacity="0.85" />
            <circle r="3.5" fill={accent}>
              <animateMotion dur="1.4s" repeatCount="indefinite" path={mgrPath} />
            </circle>
          </g>
        )}

        {/* Row count indicator if multiple rows */}
        {rows > 1 && (
          <text x={width - 24} y={36} textAnchor="end" fontSize="10" fill="rgba(26,26,34,0.55)" fontFamily="Geist Mono" letterSpacing="0.05em">
            {subs.length} AGENTS · {rows} ROWS
          </text>
        )}

        {/* Sub-agents */}
        {subPos.map(({ sub, x, y }, j) => {
          const sx = x;
          const sy = y;
          return (
            <g
              key={sub.id}
              className="pop-in"
              style={{ animationDelay: 180 + j * 30 + 'ms', cursor: onSelect ? 'pointer' : 'default' }}
              onClick={() => onSelect?.(sub as HierarchyAgent)}
            >
              <circle cx={sx} cy={sy} r="20" fill="rgba(255,255,255,0.96)" stroke={accent} strokeOpacity="0.4" strokeWidth="1.2" />
              <text x={sx} y={sy + 5} textAnchor="middle" fontSize="12" fontWeight="600" fill="#1a1a22" style={{ pointerEvents: 'none' }}>
                {sub.label[0]}
              </text>
              <text x={sx} y={sy + 38} textAnchor="middle" fontSize="10" fontWeight="500" fill="#1a1a22" style={{ pointerEvents: 'none' }}>
                {sub.label.length > 14 ? sub.label.slice(0, 13) + '…' : sub.label}
              </text>
              {sub.role && (
                <text
                  x={sx}
                  y={sy + 52}
                  textAnchor="middle"
                  fontSize="8.5"
                  fill="rgba(26,26,34,0.5)"
                  fontFamily="Geist Mono"
                  letterSpacing="0.05em"
                  style={{ pointerEvents: 'none' }}
                >
                  {sub.role.length > 16 ? sub.role.slice(0, 15).toUpperCase() + '…' : sub.role.toUpperCase()}
                </text>
              )}
              {sub.tier && (
                <g style={{ pointerEvents: 'none' }}>
                  <rect x={sx - 22} y={sy + 60} width="44" height="13" rx="6.5" fill={accent} fillOpacity="0.12" stroke={accent} strokeOpacity="0.4" strokeWidth="0.8" />
                  <text x={sx} y={sy + 69} textAnchor="middle" fontSize="8" fontFamily="Geist Mono" fontWeight="500" fill={accent} letterSpacing="0.06em">
                    {sub.tier.toUpperCase()}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </g>
    );
  };

  // Expand SVG height when focused view needs multiple rows
  const focusedRows = focusedSubTeam
    ? Math.ceil((team.find((a) => a.id === focusedSubTeam)?.subTeam?.count ?? 1) / 6)
    : 1;
  const effectiveHeight = focusedSubTeam && focusedRows > 1
    ? Math.max(height, 240 + focusedRows * 110 + 80)
    : height;

  return (
    <svg viewBox={`0 0 ${width} ${effectiveHeight}`} width="100%" height="100%" style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <radialGradient id="hierarchy-halo" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={accent} stopOpacity="0.4" />
          <stop offset="100%" stopColor={accent} stopOpacity="0" />
        </radialGradient>
      </defs>

      {focusedSubTeam && renderFocusedSubTeam()}

      {!focusedSubTeam && (
        <>
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
        const isCluster = s.id === '__cluster_employees';
        const dotColor =
          s.status === 'ok' ? '#2cb070' : s.status === 'warn' ? '#d99b3b' : s.status === 'bad' ? '#c84545' : '#888';
        const isRemoving = s.id === pendingRemove;
        const isAdded = s.id === recentlyAdded;
        const className = s.ghost || isAdded ? 'pop-in' : isRemoving ? 'fade-out' : '';
        const radius = isCluster ? 20 : 14;

        return (
          <g
            key={s.id}
            className={className}
            opacity={s.ghost ? 0.7 : 1}
            style={{ cursor: onSelect && !s.ghost ? 'pointer' : 'default' }}
            onClick={() => !s.ghost && onSelect?.(s)}
          >
            {/* Cluster: stacked rings showing many employees */}
            {isCluster && (
              <>
                <circle cx={s.x - 6} cy={s.y - 4} r={radius} fill="rgba(124,58,237,0.08)" stroke={accent} strokeOpacity="0.25" strokeWidth="1" />
                <circle cx={s.x + 6} cy={s.y - 2} r={radius} fill="rgba(124,58,237,0.10)" stroke={accent} strokeOpacity="0.3" strokeWidth="1" />
              </>
            )}
            {isActive && <circle cx={s.x} cy={s.y} r={radius + 8} fill={accent} opacity="0.18" />}
            <circle
              cx={s.x}
              cy={s.y}
              r={radius}
              fill={
                s.ghost ? 'rgba(124,58,237,0.18)' :
                isCluster ? 'rgba(124,58,237,0.18)' :
                'rgba(255,255,255,0.94)'
              }
              stroke={isActive ? accent : s.ghost ? accent : isCluster ? accent : 'rgba(20,20,30,0.18)'}
              strokeWidth={isActive || s.ghost || isCluster ? 1.6 : 1}
              strokeDasharray={s.ghost ? '3 3' : 'none'}
            />
            {!s.ghost && s.status && !isCluster && <circle cx={s.x + 9} cy={s.y - 9} r="3" fill={dotColor} />}
            <text
              x={s.x}
              y={s.y + 4}
              textAnchor="middle"
              fontSize={isCluster ? '11' : '10'}
              fontWeight="700"
              fill={s.ghost ? accent : isCluster ? accent : '#1a1a22'}
              style={{ pointerEvents: 'none' }}
            >
              {s.ghost ? '+' : isCluster ? `${s.label.split(' ')[0]}` : s.label[0]}
            </text>
            {/* Calculate per-agent width to truncate labels that would overflow */}
            {(() => {
              const perAgentWidth = (width - 100) / Math.max(1, positions.length);
              const labelMaxChars = Math.max(8, Math.floor(perAgentWidth / 7));
              const roleMaxChars = Math.max(8, Math.floor(perAgentWidth / 6));
              const truncatedLabel = s.label.length > labelMaxChars ? s.label.slice(0, labelMaxChars - 1) + '…' : s.label;
              const truncatedRole = s.role.length > roleMaxChars ? s.role.slice(0, roleMaxChars - 1).toUpperCase() + '…' : s.role.toUpperCase();
              return (
                <>
                  <text x={s.x} y={s.y + 30} textAnchor="middle" fontSize="10" fontWeight="500" fill="#1a1a22" style={{ pointerEvents: 'none' }}>
                    <title>{s.label}</title>
                    {truncatedLabel}
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
                    <title>{s.role}</title>
                    {truncatedRole}
                  </text>
                </>
              );
            })()}
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
            {/* Sub-team badge — pulsing circle with count, click to focus */}
            {!s.ghost && s.subTeam && (
              <g
                style={{ cursor: 'pointer' }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSubTeamOpen?.(s.id);
                }}
              >
                <circle cx={s.x + 14} cy={s.y - 14} r="9" fill={accent} stroke="white" strokeWidth="1.5">
                  <animate attributeName="r" values="9;10.5;9" dur="2s" repeatCount="indefinite" />
                </circle>
                <text x={s.x + 14} y={s.y - 11} textAnchor="middle" fontSize="9" fontWeight="700" fill="white" style={{ pointerEvents: 'none' }}>
                  {s.subTeam.count}
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
        </>
      )}
    </svg>
  );
}

// Hierarchy diagram with live add/remove animation. Pure SVG.

function Hierarchy({
  width = 980,
  height = 480,
  team,        // current team (incl. Iris first)
  externals = EXTERNALS,
  showExternals = true,
  showArcs = true,
  accent = "#6366f1",
  pendingAdd = null,    // ghost-render an agent being proposed
  pendingRemove = null, // id being faded out
  recentlyAdded = null, // id pulse-in
  onSelect,             // click handler -> agent
}) {
  const cx = width / 2;
  const principal = { x: cx, y: 50 };
  const personal  = { x: cx, y: 140 };

  const specs = team.filter((a) => a.id !== "iris");
  const ghostKey = pendingAdd ? "__ghost" : null;
  const renderList = ghostKey ? [...specs, { ...pendingAdd, id: ghostKey, ghost: true }] : specs;

  const specY = 270;
  const span = width - 100;
  const positions = renderList.map((s, i) => ({
    ...s, x: 50 + (span * (i + 0.5)) / renderList.length, y: specY,
  }));
  const specById = Object.fromEntries(positions.map((s) => [s.id, s]));

  // active comm arc
  const [activeIdx, setActiveIdx] = React.useState(0);
  React.useEffect(() => {
    if (!showArcs) return;
    const t = setInterval(() => setActiveIdx((i) => (i + 1) % Math.max(1, positions.length)), 1900);
    return () => clearInterval(t);
  }, [showArcs, positions.length]);

  const exts = showExternals ? externals.map((e, i) => ({
    ...e,
    x: 60 + ((width - 120) * (i + 0.5)) / externals.length,
    y: specY + 130 + (i % 2 === 0 ? 0 : 22),
  })) : [];

  const arc = (x1, y1, x2, y2, lift = 30) => {
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2 - lift;
    return `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`;
  };

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%" style={{ display: "block", overflow: "visible" }}>
      <defs>
        <radialGradient id="halo" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={accent} stopOpacity="0.4" />
          <stop offset="100%" stopColor={accent} stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* principal -> personal */}
      <line x1={principal.x} y1={principal.y + 22} x2={personal.x} y2={personal.y - 30}
            stroke="rgba(20,20,30,0.28)" strokeWidth="1.2" />

      {/* personal -> specialists */}
      {positions.map((s) => (
        <path key={"l1-" + s.id}
              d={arc(personal.x, personal.y + 30, s.x, s.y - 18, 30)}
              fill="none"
              stroke={s.ghost ? accent : "rgba(20,20,30,0.18)"}
              strokeWidth={s.ghost ? 1.4 : 1}
              strokeDasharray={s.ghost ? "4 4" : "none"}
              opacity={s.id === pendingRemove ? 0.25 : 1}
              style={{ transition: "opacity .4s" }} />
      ))}

      {/* specialists -> externals */}
      {exts.map((e) => e.links.map((sid) => {
        const s = specById[sid];
        if (!s) return null;
        return (
          <path key={"l2-" + e.id + "-" + sid}
                d={arc(s.x, s.y + 14, e.x, e.y - 8, 16)}
                fill="none"
                stroke="rgba(20,20,30,0.13)"
                strokeWidth="0.8"
                strokeDasharray="3 4" />
        );
      }))}

      {/* live comm arc */}
      {showArcs && positions[activeIdx] && !positions[activeIdx].ghost && (
        <g>
          <path d={arc(personal.x, personal.y + 30, positions[activeIdx].x, positions[activeIdx].y - 18, 38)}
                fill="none" stroke={accent} strokeWidth="2" opacity="0.85" />
          <circle r="3.5" fill={accent}>
            <animateMotion dur="1.4s" repeatCount="indefinite"
              path={arc(personal.x, personal.y + 30, positions[activeIdx].x, positions[activeIdx].y - 18, 38)} />
          </circle>
        </g>
      )}

      {/* Principal */}
      <g>
        <circle cx={principal.x} cy={principal.y} r="22" fill="rgba(255,255,255,0.88)" stroke="rgba(20,20,30,0.2)" />
        <text x={principal.x} y={principal.y + 4} textAnchor="middle" fontSize="11" fontWeight="600" fill="#1a1a22">{TENANT.user.initials}</text>
        <text x={principal.x} y={principal.y + 38} textAnchor="middle" fontSize="9" fill="rgba(26,26,34,0.55)" fontFamily="Geist Mono">{TENANT.user.first.toUpperCase()} · {TENANT.user.role.toUpperCase()}</text>
      </g>

      {/* Iris */}
      <g style={{ cursor: onSelect ? "pointer" : "default" }} onClick={() => onSelect && onSelect(team.find((a) => a.id === "iris"))}>
        <circle cx={personal.x} cy={personal.y} r="38" fill="url(#halo)" className="breathe" />
        <circle cx={personal.x} cy={personal.y} r="28" fill="rgba(255,255,255,0.96)" stroke={accent} strokeOpacity="0.4" strokeWidth="1" />
        <WisdomMarkInline cx={personal.x} cy={personal.y} scale={0.46} accent={accent} satellite={accent} animate />
        <text x={personal.x} y={personal.y + 46} textAnchor="middle" fontSize="10" fontWeight="600" fill="#1a1a22" style={{ pointerEvents: "none" }}>Iris</text>
        <text x={personal.x} y={personal.y + 60} textAnchor="middle" fontSize="9" fill={accent} fontFamily="Geist Mono" fontWeight="500" letterSpacing="0.06em" style={{ pointerEvents: "none" }}>OPUS</text>
      </g>

      {/* Specialists */}
      {positions.map((s, i) => {
        const isActive = i === activeIdx && showArcs && !s.ghost;
        const dotColor = s.status === "ok" ? "#2cb070" : s.status === "warn" ? "#d99b3b" : s.status === "bad" ? "#c84545" : "#888";
        const isRemoving = s.id === pendingRemove;
        const isAdded = s.id === recentlyAdded;
        const className = s.ghost || isAdded ? "pop-in" : isRemoving ? "fade-out" : "";
        return (
          <g key={s.id} className={className} opacity={s.ghost ? 0.7 : 1}
             style={{ cursor: onSelect && !s.ghost ? "pointer" : "default" }}
             onClick={() => !s.ghost && onSelect && onSelect(team.find((a) => a.id === s.id))}>
            {isActive && <circle cx={s.x} cy={s.y} r="22" fill={accent} opacity="0.18" />}
            <circle cx={s.x} cy={s.y} r="14"
                    fill={s.ghost ? "rgba(99,102,241,0.18)" : "rgba(255,255,255,0.94)"}
                    stroke={isActive ? accent : s.ghost ? accent : "rgba(20,20,30,0.18)"}
                    strokeWidth={isActive || s.ghost ? 1.6 : 1}
                    strokeDasharray={s.ghost ? "3 3" : "none"} />
            {!s.ghost && <circle cx={s.x + 9} cy={s.y - 9} r="3" fill={dotColor} />}
            <text x={s.x} y={s.y + 4} textAnchor="middle" fontSize="10" fontWeight="600" fill={s.ghost ? accent : "#1a1a22"} style={{ pointerEvents: "none" }}>
              {s.ghost ? "+" : s.label[0]}
            </text>
            <text x={s.x} y={s.y + 30} textAnchor="middle" fontSize="10" fontWeight="500" fill="#1a1a22" style={{ pointerEvents: "none" }}>{s.label}</text>
            <text x={s.x} y={s.y + 43} textAnchor="middle" fontSize="9" fill="rgba(26,26,34,0.5)" fontFamily="Geist Mono" style={{ pointerEvents: "none" }}>
              {s.role.toUpperCase()}
            </text>
            {!s.ghost && s.tier && (
              <g style={{ pointerEvents: "none" }}>
                <rect x={s.x - 26} y={s.y + 49} width="52" height="14" rx="7"
                      fill={accent} fillOpacity="0.12"
                      stroke={accent} strokeOpacity="0.4" strokeWidth="0.8" />
                <text x={s.x} y={s.y + 59} textAnchor="middle" fontSize="8.5"
                      fontFamily="Geist Mono" fontWeight="500"
                      fill={accent} letterSpacing="0.06em">
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
          <rect x={e.x - 30} y={e.y - 9} width="60" height="18" rx="9"
                fill="rgba(255,255,255,0.62)" stroke="rgba(20,20,30,0.12)" />
          <text x={e.x} y={e.y + 4} textAnchor="middle" fontSize="9" fill="rgba(26,26,34,0.7)" fontFamily="Geist Mono">{e.label.toUpperCase()}</text>
        </g>
      ))}
    </svg>
  );
}

window.Hierarchy = Hierarchy;

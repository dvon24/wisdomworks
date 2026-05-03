// Shared building blocks for all dashboard variants.
// Each variant is a self-contained Frame at a fixed pixel size (we render
// inside DCArtboard cards so the user can compare side-by-side).

function Frame({ width, height, bg, dim = false, children, veil = "soft" }) {
  return (
    <div className={"ww" + (dim ? " dim" : "")} style={{ width, height }}>
      <div className="bg" style={{ backgroundImage: `url(${bg})` }} />
      <div className={"veil " + (veil === "softer" ? "softer" : "")} />
      <div className="grain" />
      <div style={{ position: "relative", zIndex: 1, width: "100%", height: "100%", display: "flex", flexDirection: "column" }}>
        {children}
      </div>
    </div>
  );
}

function TopNav({ right }) {
  return (
    <header className="topnav">
      <div className="logo">w</div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>WisdomWorks</div>
        <div className="mono" style={{ fontSize: 9, color: "var(--text-faint)", letterSpacing: "0.18em" }}>{TENANT.name.toUpperCase()}</div>
      </div>
      <div style={{ flex: 1 }} />
      {right}
    </header>
  );
}

function Greeting({ size = "lg" }) {
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 8 }}>{TENANT.time}</div>
      <div className={size === "xxl" ? "num-xxl" : "num-lg"} style={{ fontWeight: 250 }}>
        Good morning, {TENANT.user.first}.
      </div>
      <div style={{ marginTop: 10, color: "var(--text-dim)", fontSize: 14, maxWidth: 540, lineHeight: 1.5 }}>
        Your team handled <strong>1,284 decisions</strong> overnight.
        Three things genuinely need you today.
      </div>
    </div>
  );
}

// — Hierarchy graph —
// Layered radial tree: principal at top, personal agent next, specialists in a fan,
// externals on a thin outer ring. Soft connection arcs; one or two pulse to suggest
// live agent communication.
function Hierarchy({ width = 720, height = 480, accent = "#6366f1", live = true, externals = true, compact = false }) {
  const cx = width / 2;
  const principal = { x: cx, y: 56, ...HIERARCHY.principal };
  const personal  = { x: cx, y: 152, ...HIERARCHY.personal };
  const specs = HIERARCHY.specialists;
  const specY = 280;
  const specSpan = width - 80;
  const specs2 = specs.map((s, i) => ({ ...s, x: 40 + (specSpan * (i + 0.5)) / specs.length, y: specY }));

  // externals: dispersed below at varying y
  const exts = externals ? HIERARCHY.externals.map((e, i) => ({
    ...e,
    x: 60 + ((width - 120) * (i + 0.5)) / HIERARCHY.externals.length,
    y: specY + 130 + (i % 2 === 0 ? 0 : 24),
  })) : [];

  const specById = Object.fromEntries(specs2.map((s) => [s.id, s]));

  // Animation: which spec is "talking"
  const [activeIdx, setActiveIdx] = React.useState(0);
  React.useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setActiveIdx((i) => (i + 1) % specs2.length), 1800);
    return () => clearInterval(t);
  }, [live, specs2.length]);

  const arc = (x1, y1, x2, y2, lift = 30) => {
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2 - lift;
    return `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`;
  };

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%" style={{ display: "block" }}>
      <defs>
        <radialGradient id="halo" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={accent} stopOpacity="0.35" />
          <stop offset="100%" stopColor={accent} stopOpacity="0" />
        </radialGradient>
        <linearGradient id="arc-grad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor={accent} stopOpacity="0" />
          <stop offset="50%"  stopColor={accent} stopOpacity="0.55" />
          <stop offset="100%" stopColor={accent} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* principal → personal trunk */}
      <line x1={principal.x} y1={principal.y + 22} x2={personal.x} y2={personal.y - 22}
            stroke="rgba(20,20,30,0.25)" strokeWidth="1.2" />

      {/* personal → specialists */}
      {specs2.map((s) => (
        <path key={"l1-" + s.id} d={arc(personal.x, personal.y + 22, s.x, s.y - 18, 28)}
              fill="none" stroke="rgba(20,20,30,0.18)" strokeWidth="1" />
      ))}

      {/* specialists → externals */}
      {exts.map((e) => e.links.map((sid) => {
        const s = specById[sid];
        if (!s) return null;
        return (
          <path key={"l2-" + e.id + "-" + sid} d={arc(s.x, s.y + 14, e.x, e.y - 8, 18)}
                fill="none" stroke="rgba(20,20,30,0.12)" strokeWidth="0.8"
                strokeDasharray="3 4" />
        );
      }))}

      {/* live arc */}
      {live && specs2[activeIdx] && (
        <g>
          <path d={arc(personal.x, personal.y + 22, specs2[activeIdx].x, specs2[activeIdx].y - 18, 36)}
                fill="none" stroke={accent} strokeWidth="2" opacity="0.8" />
          <circle r="3.5" fill={accent}>
            <animateMotion dur="1.4s" repeatCount="indefinite"
              path={arc(personal.x, personal.y + 22, specs2[activeIdx].x, specs2[activeIdx].y - 18, 36)} />
          </circle>
        </g>
      )}

      {/* Principal node */}
      <g>
        <circle cx={principal.x} cy={principal.y} r="22" fill="rgba(255,255,255,0.85)" stroke="rgba(20,20,30,0.2)" />
        <text x={principal.x} y={principal.y + 4} textAnchor="middle" fontSize="11" fontWeight="600" fill="#1a1a22">{principal.label}</text>
        <text x={principal.x} y={principal.y + 36} textAnchor="middle" fontSize="9" fill="rgba(26,26,34,0.55)" fontFamily="Geist Mono">{principal.sub}</text>
      </g>

      {/* Personal agent */}
      <g>
        <circle cx={personal.x} cy={personal.y} r="36" fill="url(#halo)" className="breathe" />
        <circle cx={personal.x} cy={personal.y} r="22" fill={accent} />
        <text x={personal.x} y={personal.y + 4} textAnchor="middle" fontSize="11" fontWeight="600" fill="white">{personal.label}</text>
        <text x={personal.x} y={personal.y + 38} textAnchor="middle" fontSize="9" fill="rgba(26,26,34,0.6)" fontFamily="Geist Mono">{personal.sub}</text>
      </g>

      {/* Specialist nodes */}
      {specs2.map((s, i) => {
        const isActive = i === activeIdx && live;
        const dotColor = s.status === "ok" ? "#2cb070" : s.status === "warn" ? "#d99b3b" : "#c84545";
        return (
          <g key={s.id}>
            {isActive && <circle cx={s.x} cy={s.y} r="22" fill={accent} opacity="0.18" />}
            <circle cx={s.x} cy={s.y} r="14" fill="rgba(255,255,255,0.92)"
                    stroke={isActive ? accent : "rgba(20,20,30,0.18)"} strokeWidth={isActive ? 1.6 : 1} />
            <circle cx={s.x + 9} cy={s.y - 9} r="3" fill={dotColor} />
            <text x={s.x} y={s.y + 4} textAnchor="middle" fontSize="10" fontWeight="600" fill="#1a1a22">{s.label[0]}</text>
            <text x={s.x} y={s.y + 30} textAnchor="middle" fontSize="10" fontWeight="500" fill="#1a1a22">{s.label}</text>
            {!compact && <text x={s.x} y={s.y + 44} textAnchor="middle" fontSize="9" fill="rgba(26,26,34,0.55)" fontFamily="Geist Mono">{s.role}</text>}
          </g>
        );
      })}

      {/* Externals */}
      {exts.map((e) => (
        <g key={e.id} opacity="0.85">
          <rect x={e.x - 28} y={e.y - 8} width="56" height="18" rx="9"
                fill="rgba(255,255,255,0.6)" stroke="rgba(20,20,30,0.12)" />
          <text x={e.x} y={e.y + 4} textAnchor="middle" fontSize="9" fill="rgba(26,26,34,0.7)" fontFamily="Geist Mono">{e.label.toUpperCase()}</text>
        </g>
      ))}
    </svg>
  );
}

// Sidebar: chat with Iris (compact)
function IrisChat({ height = 280 }) {
  return (
    <div className="glass" style={{ display: "flex", flexDirection: "column", padding: 14, gap: 10, height }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="dot acc" />
        <span className="mono" style={{ fontSize: 10, color: "var(--text-faint)" }}>IRIS · 06:42</span>
        <span style={{ flex: 1 }} />
        <span className="pill info">briefing</span>
      </div>
      <div className="scroll" style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, fontSize: 12.5, lineHeight: 1.5 }}>
        <div style={{ background: "rgba(255,255,255,0.7)", padding: "10px 12px", borderRadius: 12, borderTopLeftRadius: 4 }}>
          Good morning, Maya. I closed 1,284 small decisions while you slept. Seven things genuinely need you.
        </div>
        <div style={{ background: "rgba(255,255,255,0.7)", padding: "10px 12px", borderRadius: 12, borderTopLeftRadius: 4 }}>
          The thing I'd handle first: <strong>Vega found a 31% Tuesday capacity hole</strong> — three moves, ready to deploy.
        </div>
        <div style={{ background: "rgba(255,255,255,0.7)", padding: "10px 12px", borderRadius: 12, borderTopLeftRadius: 4 }}>
          Heads-up: Orin is offline. Slack OAuth expired. One-click reconnect in Approvals.
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", borderTop: "1px solid var(--glass-border)", paddingTop: 10 }}>
        <input placeholder="Ask Iris…" style={{ flex: 1, background: "transparent", border: 0, outline: 0, font: "inherit", fontSize: 12, color: "var(--text)" }} />
        <button className="btn primary" style={{ padding: "6px 12px" }}>Send</button>
      </div>
    </div>
  );
}

function ApprovalsList({ compact = false }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {PROPOSALS.map((p) => (
        <div key={p.id} className="glass" style={{ padding: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span className={"pill " + (p.sev === "high" ? "warn" : p.sev === "med" ? "info" : "dim")}>{p.sev.toUpperCase()}</span>
            <span className="mono" style={{ fontSize: 10, color: "var(--text-faint)" }}>{p.agent}</span>
            <span style={{ flex: 1 }} />
            <span className="mono" style={{ fontSize: 10, color: "var(--text-faint)" }}>{Math.round(p.confidence * 100)}%</span>
          </div>
          <div style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.35, marginBottom: 8 }}>{p.title}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span className="mono" style={{ fontSize: 11, color: "#4338ca" }}>{p.impact}</span>
            <span style={{ flex: 1 }} />
            {!compact && <button className="btn ghost" style={{ padding: "4px 8px", fontSize: 11 }}>Modify</button>}
            <button className="btn primary" style={{ padding: "4px 12px", fontSize: 11 }}>Approve</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function FeedRows({ rows = FEED, max = 8 }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {rows.slice(0, max).map((f, i) => (
        <div key={i} style={{
          display: "grid", gridTemplateColumns: "44px 64px 1fr", gap: 10, alignItems: "baseline",
          padding: "8px 0", borderTop: i ? "1px solid var(--glass-border)" : "none", fontSize: 12,
        }}>
          <span className="mono" style={{ fontSize: 10, color: "var(--text-faint)" }}>{f.t}</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span className={"dot " + (f.sev === "bad" ? "bad" : f.sev === "warn" ? "warn" : "ok")} />
            <span className="mono" style={{ fontSize: 10 }}>{f.agent}</span>
          </span>
          <span style={{ lineHeight: 1.4 }}>
            <span style={{ color: "var(--text-dim)", marginRight: 4 }}>{f.verb}</span>{f.text}
          </span>
        </div>
      ))}
    </div>
  );
}

function KPIInline({ stacked = false }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: stacked ? "1fr 1fr" : `repeat(${KPIS.length}, 1fr)`, gap: 12 }}>
      {KPIS.map((k, i) => (
        <div key={i} className="glass" style={{ padding: 14 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>{k.label}</div>
          <div className="num-md">{k.value}</div>
          <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>{k.note}</div>
        </div>
      ))}
    </div>
  );
}

Object.assign(window, { Frame, TopNav, Greeting, Hierarchy, IrisChat, ApprovalsList, FeedRows, KPIInline });

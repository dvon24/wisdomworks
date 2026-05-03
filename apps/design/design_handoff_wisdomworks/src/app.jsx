// Main app: full-bleed dashboard. Hierarchy hero + Iris mini-chat + agent panel + price diff.

function replyFor(agent, text) {
  if (!agent) return "Acknowledged.";
  const t = text.toLowerCase();
  if (/thank|thanks|good/.test(t)) return `Thanks, ${TENANT.user.first}. I'll keep going.`;
  if (/why|how|what/.test(t))      return `Good question. Here's the short version — I'll send the full reasoning to your inbox.`;
  if (/stop|pause|hold/.test(t))   return `Paused. I won't act until you say go.`;
  return `Got it. Working on "${text.slice(0, 60)}${text.length > 60 ? "…" : ""}" now.`;
}

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "#7c3aed",
  "showExternals": true,
  "showArcs": true,
  "blur": 20,
  "background": 0
}/*EDITMODE-END*/;

// Cinematic background with crossfade
function Background({ idx }) {
  return (
    <div className="bg-root" aria-hidden>
      {BG_IMAGES.map((src, i) => (
        <div key={src} className={"bg-img" + (i === idx ? " active" : "")} style={{ backgroundImage: `url(${src})` }} />
      ))}
      <div className="bg-veil" />
      <div className="bg-grain" />
    </div>
  );
}

function App() {
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [team, setTeam] = React.useState(INITIAL_TEAM);
  const [messages, setMessages] = React.useState([
    { from: "iris", text: `Good morning, ${TENANT.user.first}. I closed 1,284 small decisions while you slept. Three things genuinely need you today.` },
    { from: "iris", text: "First up: Vega found a 31% Tuesday capacity hole. I built the fix — three moves, ready to deploy whenever you're ready." },
    { from: "iris", text: "You can also ask me to add or remove agents — try \"add a recruiter\" or \"can Cedar move to Sonnet to save money?\"" },
  ]);
  const [chatOpen, setChatOpen] = React.useState(false);
  const [panelOpen, setPanelOpen] = React.useState(false);
  const [pendingAdd, setPendingAdd] = React.useState(null);
  const [pendingRemove, setPendingRemove] = React.useState(null);
  const [recentlyAdded, setRecentlyAdded] = React.useState(null);
  const [bgIdx, setBgIdx] = React.useState(tweaks.background || 0);
  const [priceEvent, setPriceEvent] = React.useState(null); // { delta, total }
  const [detailAgentId, setDetailAgentId] = React.useState(null);
  const detailAgent = detailAgentId ? team.find((a) => a.id === detailAgentId) : null;
  // per-agent direct chat threads, keyed by agent id
  const [threads, setThreads] = React.useState({});

  // Honor tweak: which background
  React.useEffect(() => { setBgIdx((tweaks.background || 0) % BG_IMAGES.length); }, [tweaks.background]);

  // Update CSS vars from tweaks
  React.useEffect(() => {
    document.documentElement.style.setProperty("--accent", tweaks.accent);
    const r = parseInt(tweaks.accent.slice(1,3), 16);
    const g = parseInt(tweaks.accent.slice(3,5), 16);
    const b = parseInt(tweaks.accent.slice(5,7), 16);
    document.documentElement.style.setProperty("--accent-soft", `rgba(${r},${g},${b},0.16)`);
    document.documentElement.style.setProperty("--accent-line", `rgba(${r},${g},${b},0.45)`);
  }, [tweaks.accent]);

  const totalPrice = priceForTeam(team);

  // Append a message helper that returns the index for later mutation
  const append = (m) => {
    setMessages((ms) => [...ms, m]);
  };
  const updateAction = (actionId, patch) => {
    setMessages((ms) => ms.map((m) =>
      m.action && m.action.id === actionId ? { ...m, action: { ...m.action, ...patch } } : m
    ));
  };

  // ── Iris parsing of free-text commands ───────────────────────────
  const parseIntent = (text) => {
    const t = text.toLowerCase();

    // ADD
    if (/\b(add|hire|bring on|i need|get me|deploy)\b/.test(t)) {
      // try match a catalog role keyword
      for (const c of AGENT_CATALOG) {
        if (team.find((x) => x.id === c.id)) continue;
        const keys = [c.label.toLowerCase(), c.role.toLowerCase(), ...c.role.toLowerCase().split(" ")];
        if (keys.some((k) => k && t.includes(k))) return { kind: "add", agent: c };
      }
      // fallback: first available
      const first = AGENT_CATALOG.find((c) => !team.find((x) => x.id === c.id));
      if (first) return { kind: "add", agent: first };
    }

    // REMOVE
    if (/\b(remove|delete|drop|fire|let go|don't need)\b/.test(t)) {
      for (const a of team) {
        if (a.required) continue;
        if (t.includes(a.label.toLowerCase()) || t.includes(a.role.toLowerCase())) {
          return { kind: "remove", agent: a };
        }
      }
    }

    // TIER
    const tierMatch = t.match(/\b(haiku|sonnet|opus)\b/);
    if (tierMatch) {
      const toTier = tierMatch[1][0].toUpperCase() + tierMatch[1].slice(1);
      for (const a of team) {
        if (a.required) continue;
        if (t.includes(a.label.toLowerCase()) || t.includes(a.role.toLowerCase())) {
          if (a.tier === toTier) return null;
          return { kind: "tier", agent: a, fromTier: a.tier, toTier };
        }
      }
    }

    return null;
  };

  const onSend = (text) => {
    append({ from: "user", text });
    const intent = parseIntent(text);

    setTimeout(() => {
      if (!intent) {
        append({ from: "iris", text: "I can help with that. (Demo: try 'add a recruiter', 'remove Cedar', or 'move Mira to Sonnet'.)" });
        return;
      }

      const id = "act-" + Date.now();
      if (intent.kind === "add") {
        const a = intent.agent;
        const delta = TIER_PRICE[a.tier];
        append({
          from: "iris",
          text: `Got it — adding ${a.label} (${a.role}). ${a.desc}`,
          action: { id, kind: "add", agent: a, delta, status: "pending", note: a.desc },
        });
        setPendingAdd(a);
      } else if (intent.kind === "remove") {
        const a = intent.agent;
        const delta = -TIER_PRICE[a.tier];
        const note = a.savings ? `${a.label} saved you ${a.savings} this month — are you sure?` : `${a.label} handled ${a.handled || 0} decisions last week.`;
        append({
          from: "iris",
          text: `Heads up — ${note} Confirm and I'll pause them.`,
          action: { id, kind: "remove", agent: a, delta, status: "pending", note },
        });
      } else if (intent.kind === "tier") {
        const a = intent.agent;
        const delta = TIER_PRICE[intent.toTier] - TIER_PRICE[a.tier];
        append({
          from: "iris",
          text: `${intent.toTier === "Haiku" ? "Cheaper, faster, less depth" : intent.toTier === "Opus" ? "Smarter — better for hard calls" : "Solid middle ground"}. Switch ${a.label} from ${a.fromTier} to ${intent.toTier}?`,
          action: { id, kind: "tier", agent: a, fromTier: a.fromTier, toTier: intent.toTier, delta, status: "pending" },
        });
      }
    }, 600);
  };

  const onAcceptAction = (actionId) => {
    const msg = messages.find((m) => m.action && m.action.id === actionId);
    if (!msg) return;
    const ac = msg.action;
    const before = priceForTeam(team);

    if (ac.kind === "add") {
      const a = { ...ac.agent, status: "ok", handled: 0 };
      setTeam((t) => [...t, a]);
      setPendingAdd(null);
      setRecentlyAdded(a.id);
      setTimeout(() => setRecentlyAdded(null), 800);
      const after = before + TIER_PRICE[a.tier];
      setPriceEvent({ delta: TIER_PRICE[a.tier], total: after });
    } else if (ac.kind === "remove") {
      setPendingRemove(ac.agent.id);
      setTimeout(() => {
        setTeam((t) => t.filter((x) => x.id !== ac.agent.id));
        setPendingRemove(null);
      }, 420);
      const after = before - TIER_PRICE[ac.agent.tier];
      setPriceEvent({ delta: -TIER_PRICE[ac.agent.tier], total: after });
    } else if (ac.kind === "tier") {
      setTeam((t) => t.map((x) => x.id === ac.agent.id ? { ...x, tier: ac.toTier } : x));
      const after = before + ac.delta;
      setPriceEvent({ delta: ac.delta, total: after });
    }

    updateAction(actionId, { status: "accepted" });
    setTimeout(() => append({ from: "iris", text: "Done. I'll keep watching." }), 700);
  };

  const onRejectAction = (actionId) => {
    updateAction(actionId, { status: "rejected" });
    setPendingAdd(null);
  };

  // Programmatic helpers (for panel + tweaks demo)
  const onAdd = (agent) => {
    const before = priceForTeam(team);
    const a = { ...agent, status: "ok", handled: 0 };
    setTeam((t) => [...t, a]);
    setRecentlyAdded(a.id);
    setTimeout(() => setRecentlyAdded(null), 800);
    setPriceEvent({ delta: TIER_PRICE[a.tier], total: before + TIER_PRICE[a.tier] });
    append({ from: "iris", text: `Added ${a.label} (${a.role}). Briefing them now.` });
  };
  const onRemove = (id) => {
    const a = team.find((x) => x.id === id);
    if (!a || a.required) return;
    const before = priceForTeam(team);
    setPendingRemove(id);
    setTimeout(() => {
      setTeam((t) => t.filter((x) => x.id !== id));
      setPendingRemove(null);
    }, 420);
    setPriceEvent({ delta: -TIER_PRICE[a.tier], total: before - TIER_PRICE[a.tier] });
    append({ from: "iris", text: `Paused ${a.label}. Their work is archived — you can re-add anytime.` });
  };
  const onTierChange = (id, toTier) => {
    const a = team.find((x) => x.id === id);
    if (!a) return;
    const before = priceForTeam(team);
    const delta = TIER_PRICE[toTier] - TIER_PRICE[a.tier];
    setTeam((t) => t.map((x) => x.id === id ? { ...x, tier: toTier } : x));
    setPriceEvent({ delta, total: before + delta });
    append({ from: "iris", text: `Switched ${a.label} to ${toTier}. ${TIER_DESC[toTier]}` });
  };

  // Demo flows triggered from Tweaks
  const demoAdd = () => {
    const next = AGENT_CATALOG.find((c) => !team.find((t) => t.id === c.id));
    if (!next) return;
    setChatOpen(true);
    onSend("add a " + next.role.toLowerCase());
  };
  const demoRemove = () => {
    const candidate = team.find((a) => !a.required && a.id === "cedar") || team.find((a) => !a.required);
    if (!candidate) return;
    setChatOpen(true);
    onSend("remove " + candidate.label);
  };
  const demoTier = () => {
    const candidate = team.find((a) => !a.required && a.tier === "Opus") || team.find((a) => !a.required);
    if (!candidate) return;
    const target = candidate.tier === "Opus" ? "Sonnet" : candidate.tier === "Haiku" ? "Sonnet" : "Opus";
    setChatOpen(true);
    onSend(`move ${candidate.label} to ${target}`);
  };

  return (
    <>
      <Background idx={bgIdx} />

      {/* Top chrome */}
      <header style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 20, display: "flex", alignItems: "center", padding: "14px 24px", gap: 12 }}>
        <WisdomLockup size={28} tagline="because it does." accent="var(--accent)" />
        <div style={{ flex: 1 }} />
        <span className="pill info" style={{ flexShrink: 0 }}>7 pending</span>
        <button className="btn ghost" onClick={() => setPanelOpen(true)} style={{ fontSize: 12, flexShrink: 0 }}>
          <span style={{ marginRight: 6 }}>✦</span>{team.length} agents · €{totalPrice}/mo
        </button>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: "var(--accent)", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600, flexShrink: 0 }}>{TENANT.user.initials}</div>
      </header>

      {/* Hero */}
      <main style={{ position: "relative", minHeight: "100vh", paddingTop: 76, paddingBottom: 200, display: "flex", flexDirection: "column", alignItems: "center", zIndex: 1 }}>
        <div style={{ textAlign: "center", padding: "8px 24px 4px", maxWidth: 880 }}>
          <div className="eyebrow" style={{ marginBottom: 10 }}>{TENANT.time}</div>
          <div className="num-xxl" style={{ fontWeight: 250, color: "#1a1a22" }}>
            Three things, then your day is yours.
          </div>
          <div style={{ marginTop: 14, color: "var(--text-dim)", fontSize: 14, lineHeight: 1.55 }}>
            Your team handled <strong>1,284 decisions</strong> overnight · Atlas, Vega and Sable are talking now.
          </div>
        </div>

        {/* Hierarchy */}
        <div style={{ flex: 1, width: "100%", maxWidth: 940, padding: "8px 24px", minHeight: 360 }}>
          <Hierarchy
            width={940} height={460}
            team={team}
            externals={EXTERNALS}
            showExternals={tweaks.showExternals}
            showArcs={tweaks.showArcs}
            accent={tweaks.accent}
            pendingAdd={pendingAdd}
            pendingRemove={pendingRemove}
            recentlyAdded={recentlyAdded}
            onSelect={(a) => a && setDetailAgentId(a.id)}
          />
        </div>

        {/* Single decision card */}
        <div style={{ width: "100%", maxWidth: 980, padding: "0 24px" }}>
          <div className="glass-strong" style={{ padding: 16, display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 16, alignItems: "center" }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: "var(--accent-soft)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent-deep)", fontWeight: 600 }}>V</div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span className="pill warn">HIGH</span>
                <span className="mono" style={{ fontSize: 10, color: "var(--text-faint)" }}>VEGA · 86% CONFIDENCE</span>
              </div>
              <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 3 }}>Reduce Tuesday wasted capacity by 31%</div>
              <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.45 }}>
                Three moves ready to deploy: shift internal reviews to Tue AM, open a half-day client clinic, repurpose 14:00 dead slot. <span className="mono" style={{ color: "var(--accent-deep)" }}>+€7,200/mo</span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn">Modify</button>
              <button className="btn ghost">Dismiss</button>
              <button className="btn primary">Approve</button>
            </div>
          </div>
        </div>
      </main>

      {/* Mini-chat */}
      <MiniChat
        open={chatOpen}
        setOpen={setChatOpen}
        messages={messages}
        onSend={onSend}
        onAcceptAction={onAcceptAction}
        onRejectAction={onRejectAction}
        onOpenPanel={() => setPanelOpen(true)}
      />

      {/* Agent panel */}
      <AgentPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        team={team}
        onAdd={onAdd}
        onRemove={onRemove}
        onTierChange={onTierChange}
      />

      {/* Floating price diff */}
      {priceEvent && (
        <PriceDiff delta={priceEvent.delta} total={priceEvent.total} onDismiss={() => setPriceEvent(null)} />
      )}

      {/* Agent detail */}
      <AgentDetail
        agent={detailAgent}
        onClose={() => setDetailAgentId(null)}
        onTierChange={onTierChange}
        messages={detailAgent ? (threads[detailAgent.id] || []) : []}
        onSend={(agentId, text, share) => {
          const a = team.find((x) => x.id === agentId);
          const others = team.filter((x) => x.id !== agentId).map((x) => x.label);
          setThreads((th) => {
            const cur = th[agentId] || [];
            const userMsg = { from: "user", text, shared: share, sharedWith: share ? others : [] };
            const reply = { from: "agent", text: replyFor(a, text) };
            return { ...th, [agentId]: [...cur, userMsg, reply] };
          });
          if (share) {
            setTimeout(() => {
              append({ from: "iris", text: `${a.label} just got new context from you — I shared it with ${others.length} other agents.` });
            }, 700);
          }
        }}
      />

      {/* Tweaks */}
      <TweaksPanel>
        <TweakSection label="Demo flows">
          <TweakButton label="Demo · Add agent via chat" onClick={demoAdd} />
          <TweakButton label="Demo · Remove agent via chat" onClick={demoRemove} />
          <TweakButton label="Demo · Suggest tier change" onClick={demoTier} />
        </TweakSection>
        <TweakSection label="Look">
          <TweakColor label="Accent" value={tweaks.accent} onChange={(v) => setTweak("accent", v)} />
          <TweakSelect label="Background" value={tweaks.background}
            options={BG_IMAGES.map((_, i) => ({ value: i, label: ["Coast","Mountain","Forest","Dunes"][i] || ("Image " + i) }))}
            onChange={(v) => setTweak("background", Number(v))} />
        </TweakSection>
        <TweakSection label="Hierarchy">
          <TweakToggle label="Show clients & tools" value={tweaks.showExternals} onChange={(v) => setTweak("showExternals", v)} />
          <TweakToggle label="Live communication arcs" value={tweaks.showArcs} onChange={(v) => setTweak("showArcs", v)} />
        </TweakSection>
      </TweaksPanel>
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);

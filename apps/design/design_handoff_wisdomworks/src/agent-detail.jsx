// Per-agent detail screen.
// - Activity timeline (what the agent did, with outcomes)
// - Direct chat (sent messages flow into the global Iris context as "context shared")
// - KPIs and a quick "share this with the team" toggle

const AGENT_ACTIVITY = {
  atlas: [
    { t: "06:14", verb: "Drafted",   text: "reply to Sven Hinrich re: Thursday review", impact: "Saved 12 min", live: true },
    { t: "05:48", verb: "Approved",  text: "ACME contract renewal · standard terms" },
    { t: "04:30", verb: "Logged",    text: "Patagonia kickoff call · 8 action items synced to Linear" },
    { t: "Yesterday", verb: "Detected", text: "Hinrich → 11 days no contact, churn risk amber", flag: true },
    { t: "Yesterday", verb: "Drafted",   text: "weekly client digest · 14 accounts" },
  ],
  vega: [
    { t: "06:32", verb: "Proposed", text: "reduce Tuesday capacity hole by 31% · ready to deploy", flag: true, impact: "+€7,200/mo" },
    { t: "05:19", verb: "Detected", text: "3 contractors logged 14h+ Friday · investigating" },
    { t: "Yesterday", verb: "Adjusted", text: "rebalanced studio room bookings for Q3" },
  ],
  juno: [
    { t: "00:21", verb: "Published", text: "LinkedIn post · 14.2k impressions in 2h", impact: "Top 3% engagement" },
    { t: "Yesterday", verb: "Drafted", text: "newsletter v17 · waiting for your edit" },
    { t: "Yesterday", verb: "A/B-tested", text: "subject lines · winner: 'a quieter Tuesday'" },
  ],
  sable: [
    { t: "Yesterday", verb: "Flagged", text: "ACME invoice 18 days overdue · chase ready", flag: true, impact: "€12,400 at risk" },
    { t: "Mon",       verb: "Reconciled", text: "Stripe + bank · €€ matched, 2 anomalies queued" },
  ],
  iris: [
    { t: "06:42", verb: "Briefing", text: "Morning briefing sent to your WhatsApp" },
    { t: "Overnight", verb: "Closed", text: "1,284 small decisions · €0 spend approved over policy" },
  ],
  default: [
    { t: "Today", verb: "Working", text: "no notable events yet" },
  ],
};

const AGENT_KPI = {
  atlas: { handled: 412, savedHours: 38, accuracy: 96 },
  vega:  { handled: 287, savedHours: 22, accuracy: 91 },
  juno:  { handled: 198, savedHours: 14, accuracy: 88 },
  sable: { handled: 156, savedHours: 47, accuracy: 99 },
  wren:  { handled: 89,  savedHours: 11, accuracy: 94 },
  cedar: { handled: 64,  savedHours: 9,  accuracy: 97 },
  orin:  { handled: 38,  savedHours: 5,  accuracy: 84 },
  mira:  { handled: 142, savedHours: 18, accuracy: 92 },
  iris:  { handled: 1284, savedHours: 186, accuracy: 99 },
};

function AgentDetail({ agent, onClose, messages, onSend, onTierChange }) {
  if (!agent) return null;
  const activity = AGENT_ACTIVITY[agent.id] || AGENT_ACTIVITY.default;
  const kpi = AGENT_KPI[agent.id] || { handled: agent.handled || 0, savedHours: 0, accuracy: 90 };
  const dotClass = agent.status === "ok" ? "ok" : agent.status === "warn" ? "warn" : "bad";
  const [draft, setDraft] = React.useState("");
  const [share, setShare] = React.useState(true);
  const scrollRef = React.useRef(null);
  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const submit = () => {
    if (!draft.trim()) return;
    onSend(agent.id, draft.trim(), share);
    setDraft("");
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", alignItems: "stretch", justifyContent: "center", padding: 24, background: "rgba(20,20,30,0.35)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}
         onClick={onClose}>
      <div className="glass-strong" onClick={(e) => e.stopPropagation()}
           style={{ width: "100%", maxWidth: 1100, display: "grid", gridTemplateColumns: "1.3fr 1fr", overflow: "hidden", boxShadow: "0 24px 80px rgba(20,20,40,0.4)" }}>

        {/* Left — agent overview & activity */}
        <div style={{ padding: 28, display: "flex", flexDirection: "column", gap: 20, minHeight: 0, borderRight: "1px solid var(--glass-border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: agent.id === "iris" ? "var(--accent)" : "rgba(255,255,255,0.85)", color: agent.id === "iris" ? "white" : "var(--text)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, fontSize: 22, border: "1px solid var(--glass-border)" }}>
              {agent.id === "iris" ? "✦" : agent.label[0]}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div className="num-md" style={{ fontWeight: 500, fontSize: 20 }}>{agent.label}</div>
                <span className={"dot " + dotClass} />
                <span className="mono" style={{ fontSize: 10, color: "var(--text-faint)" }}>
                  {agent.status === "ok" ? "HEALTHY" : agent.status === "warn" ? "ATTENTION" : "OFFLINE"}
                </span>
              </div>
              <div style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 2 }}>{agent.role}</div>
            </div>
            <button className="btn ghost" onClick={onClose} style={{ padding: "4px 10px", fontSize: 14 }}>✕</button>
          </div>

          {/* Model picker */}
          <div className="glass" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div className="eyebrow">Model</div>
              <span style={{ flex: 1 }} />
              <span className="mono" style={{ fontSize: 10, color: "var(--text-faint)" }}>
                CURRENT · €{TIER_PRICE[agent.tier]}/MO
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
              {["Haiku", "Sonnet", "Opus"].map((t) => {
                const active = t === agent.tier;
                const disabled = agent.required && !active;
                return (
                  <button key={t}
                    onClick={() => !active && !disabled && onTierChange && onTierChange(agent.id, t)}
                    disabled={disabled}
                    className="btn"
                    style={{
                      padding: "10px 8px",
                      textAlign: "left",
                      cursor: disabled ? "not-allowed" : (active ? "default" : "pointer"),
                      opacity: disabled ? 0.4 : 1,
                      background: active ? "var(--accent-soft)" : "rgba(255,255,255,0.55)",
                      border: active ? "1px solid var(--accent-line)" : "1px solid var(--glass-border)",
                      color: active ? "var(--accent-deep)" : "var(--text)",
                    }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600 }}>
                      {t}
                      {active && <span className="mono" style={{ fontSize: 9, opacity: 0.7 }}>· active</span>}
                    </div>
                    <div className="mono" style={{ fontSize: 9.5, color: active ? "var(--accent-deep)" : "var(--text-faint)", marginTop: 4, lineHeight: 1.4 }}>
                      €{TIER_PRICE[t]}/MO
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4, lineHeight: 1.4 }}>
                      {TIER_DESC[t]}
                    </div>
                  </button>
                );
              })}
            </div>
            {agent.required && (
              <div className="mono" style={{ fontSize: 10, color: "var(--text-faint)" }}>
                {agent.label} runs on Opus by default — recommended for the personal assistant role.
              </div>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <div className="glass" style={{ padding: 12 }}>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Decisions / wk</div>
              <div className="num-md">{kpi.handled.toLocaleString()}</div>
            </div>
            <div className="glass" style={{ padding: 12 }}>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Hours saved</div>
              <div className="num-md">{kpi.savedHours}h</div>
            </div>
            <div className="glass" style={{ padding: 12 }}>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Accuracy</div>
              <div className="num-md">{kpi.accuracy}%</div>
            </div>
          </div>

          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10, minHeight: 0 }}>
            <div className="eyebrow">Recent activity</div>
            <div className="scroll" style={{ flex: 1, minHeight: 0 }}>
              {activity.map((a, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "70px 1fr", gap: 10, padding: "10px 0", borderTop: i ? "1px solid var(--glass-border)" : "none", fontSize: 12.5 }}>
                  <span className="mono" style={{ fontSize: 10, color: "var(--text-faint)" }}>{a.t}</span>
                  <div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                      <span style={{ color: "var(--text-dim)" }}>{a.verb}</span>
                      <span style={{ lineHeight: 1.45 }}>{a.text}</span>
                      {a.live && <span className="pill info" style={{ marginLeft: 4, fontSize: 10 }}>live</span>}
                      {a.flag && <span className="pill warn" style={{ marginLeft: 4, fontSize: 10 }}>flag</span>}
                    </div>
                    {a.impact && <div className="mono" style={{ fontSize: 10, color: "var(--accent-deep)", marginTop: 3 }}>{a.impact}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right — direct chat with this agent */}
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0, background: "rgba(255,255,255,0.4)" }}>
          <header style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 20px", borderBottom: "1px solid var(--glass-border)" }}>
            <div className="eyebrow">Talk to {agent.label}</div>
            <span style={{ flex: 1 }} />
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-dim)", cursor: "pointer" }}>
              <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
              Share with team
            </label>
          </header>
          <div ref={scrollRef} className="scroll" style={{ flex: 1, padding: 16, display: "flex", flexDirection: "column", gap: 10, minHeight: 0 }}>
            {messages.length === 0 && (
              <div style={{ textAlign: "center", color: "var(--text-faint)", fontSize: 12, padding: "40px 20px", lineHeight: 1.6 }}>
                Direct line to {agent.label}.<br/>
                <span className="mono" style={{ fontSize: 10 }}>What you say here can be shared as context with the rest of the team.</span>
              </div>
            )}
            {messages.map((m, i) => {
              const isUser = m.from === "user";
              return (
                <div key={i} style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: isUser ? "flex-end" : "flex-start" }}>
                  <div style={{
                    maxWidth: "85%", padding: "10px 14px", borderRadius: 14, fontSize: 13, lineHeight: 1.5,
                    background: isUser ? "var(--accent)" : "rgba(255,255,255,0.85)",
                    color: isUser ? "white" : "var(--text)",
                    borderTopRightRadius: isUser ? 4 : 14,
                    borderTopLeftRadius: isUser ? 14 : 4,
                    border: isUser ? "none" : "1px solid var(--glass-border)",
                  }}>
                    {m.text}
                  </div>
                  {m.shared && (
                    <div className="mono" style={{ fontSize: 9, color: "var(--accent-deep)", letterSpacing: "0.1em" }}>
                      ↗ SHARED · {m.sharedWith?.length || 0} agents now have this context
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 8, padding: 12, borderTop: "1px solid var(--glass-border)" }}>
            <input value={draft} onChange={(e) => setDraft(e.target.value)}
                   onKeyDown={(e) => e.key === "Enter" && submit()}
                   placeholder={`Message ${agent.label}…`}
                   style={{ flex: 1, background: "rgba(255,255,255,0.6)", border: "1px solid var(--glass-border)", borderRadius: 10, padding: "10px 12px", outline: 0, font: "inherit", fontSize: 13 }} />
            <button className="btn primary" onClick={submit}>Send</button>
          </div>
        </div>
      </div>
    </div>
  );
}

window.AgentDetail = AgentDetail;

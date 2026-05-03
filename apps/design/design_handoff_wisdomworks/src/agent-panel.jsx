// Slide-in side panel: list current agents, swap tier (Iris recommends, user approves),
// remove (with consequence-aware confirm), and add from catalog.

function AgentPanel({ open, onClose, team, onAdd, onRemove, onTierChange }) {
  const [tab, setTab] = React.useState("active");
  const [confirming, setConfirming] = React.useState(null); // agent id
  const total = priceForTeam(team);

  return (
    <aside className={"panel-slide glass-strong " + (open ? "open" : "")}
           style={{ display: "flex", flexDirection: "column", boxShadow: "-20px 0 60px rgba(20,20,40,0.2)" }}>
      <header style={{ display: "flex", alignItems: "center", padding: "16px 18px", borderBottom: "1px solid var(--glass-border)" }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Your team</div>
          <div className="mono" style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 2 }}>{team.length} agents · €{total}/mo</div>
        </div>
        <span style={{ flex: 1 }} />
        <button className="btn ghost" onClick={onClose} style={{ padding: "4px 10px", fontSize: 14 }}>✕</button>
      </header>

      <div style={{ display: "flex", padding: "10px 18px 0", gap: 4 }}>
        {[["active","Active"],["catalog","Add agent"]].map(([k,l]) => (
          <button key={k} onClick={() => { setTab(k); setConfirming(null); }}
                  className="btn ghost"
                  style={{ fontSize: 12, padding: "6px 12px",
                           background: tab===k ? "rgba(255,255,255,0.7)" : "transparent",
                           border: tab===k ? "1px solid var(--glass-border)" : "1px solid transparent" }}>
            {l}
          </button>
        ))}
      </div>

      <div className="scroll" style={{ flex: 1, padding: 12, minHeight: 0 }}>
        {tab === "active" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {team.map((a) => (
              <ActiveAgentRow key={a.id} a={a}
                onTierChange={onTierChange}
                confirming={confirming === a.id}
                onAskRemove={() => setConfirming(a.id)}
                onCancelRemove={() => setConfirming(null)}
                onConfirmRemove={() => { onRemove(a.id); setConfirming(null); }}
              />
            ))}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {AGENT_CATALOG.filter((c) => !team.find((t) => t.id === c.id)).map((c) => (
              <div key={c.id} className="agent-row" style={{ alignItems: "flex-start" }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: "var(--accent-soft)", color: "var(--accent-deep)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600 }}>
                  {c.label[0]}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{c.label} <span style={{ color: "var(--text-faint)", fontWeight: 400 }}>· {c.role}</span></div>
                  <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.45, marginTop: 2 }}>{c.desc}</div>
                  <div className="mono" style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 4 }}>{c.tier.toUpperCase()} · €{TIER_PRICE[c.tier]}/mo</div>
                </div>
                <button className="btn primary" onClick={() => onAdd(c)} style={{ fontSize: 11, padding: "5px 12px" }}>Add</button>
              </div>
            ))}
            {AGENT_CATALOG.filter((c) => !team.find((t) => t.id === c.id)).length === 0 && (
              <div style={{ padding: 32, textAlign: "center", color: "var(--text-faint)", fontSize: 12 }}>
                You've added every available agent.
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

function ActiveAgentRow({ a, onTierChange, confirming, onAskRemove, onCancelRemove, onConfirmRemove }) {
  const [tierOpen, setTierOpen] = React.useState(false);
  const dotClass = a.status === "ok" ? "ok" : a.status === "warn" ? "warn" : "bad";
  return (
    <div style={{ borderBottom: "1px solid var(--glass-border)", padding: "10px 8px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "36px 1fr auto", gap: 12, alignItems: "center" }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: a.id === "iris" ? "var(--accent)" : "rgba(255,255,255,0.7)", color: a.id === "iris" ? "white" : "var(--text)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, border: "1px solid var(--glass-border)" }}>
          {a.id === "iris" ? "✦" : a.label[0]}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 500 }}>
            <span className={"dot " + dotClass} />
            {a.label}
            <span style={{ color: "var(--text-faint)", fontWeight: 400 }}>· {a.role}</span>
          </div>
          <div className="mono" style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 3 }}>
            {a.tier.toUpperCase()} · €{TIER_PRICE[a.tier]}/mo
            {a.handled ? <> · {a.handled} decisions/wk</> : null}
          </div>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {!a.required && (
            <button className="btn ghost" onClick={() => setTierOpen(!tierOpen)} style={{ fontSize: 11, padding: "4px 8px" }}>Tier</button>
          )}
          {!a.required && (
            <button className="btn ghost danger" onClick={onAskRemove} style={{ fontSize: 11, padding: "4px 8px" }}>Remove</button>
          )}
          {a.required && <span className="pill dim mono" style={{ fontSize: 10 }}>required</span>}
        </div>
      </div>

      {tierOpen && !a.required && (
        <div style={{ marginTop: 8, padding: 10, background: "rgba(255,255,255,0.5)", borderRadius: 10, border: "1px solid var(--glass-border)" }}>
          <div className="mono" style={{ fontSize: 10, color: "var(--text-faint)", marginBottom: 8 }}>IRIS RECOMMENDS · SONNET FOR THIS ROLE</div>
          <div style={{ display: "flex", gap: 6 }}>
            {["Haiku","Sonnet","Opus"].map((t) => {
              const active = t === a.tier;
              return (
                <button key={t} onClick={() => { if (!active) onTierChange(a.id, t); setTierOpen(false); }}
                        className="btn"
                        style={{ flex: 1, fontSize: 11, padding: "8px 6px",
                                 background: active ? "var(--accent-soft)" : "rgba(255,255,255,0.7)",
                                 borderColor: active ? "var(--accent-line)" : "var(--glass-border)",
                                 color: active ? "var(--accent-deep)" : "var(--text)" }}>
                  <div style={{ fontWeight: 500 }}>{t}</div>
                  <div className="mono" style={{ fontSize: 10, opacity: 0.7, marginTop: 2 }}>€{TIER_PRICE[t]}/mo</div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {confirming && (
        <div style={{ marginTop: 8, padding: 12, background: "rgba(200,60,60,0.06)", borderRadius: 10, border: "1px solid rgba(200,60,60,0.2)" }}>
          <div style={{ fontSize: 12, color: "#8a2a2a", lineHeight: 1.5, marginBottom: 8 }}>
            <strong>Are you sure?</strong>{a.savings ? <> {a.label} saved you {a.savings} this month.</> : a.handled ? <> {a.label} handled {a.handled} decisions in the last week.</> : null} You can always re-add later.
          </div>
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
            <button className="btn ghost" onClick={onCancelRemove} style={{ fontSize: 11, padding: "5px 10px" }}>Keep</button>
            <button className="btn danger" onClick={onConfirmRemove} style={{ fontSize: 11, padding: "5px 10px" }}>Remove agent</button>
          </div>
        </div>
      )}
    </div>
  );
}

window.AgentPanel = AgentPanel;

// Mini-chat that expands. Iris suggests team changes inline; user can accept/reject.
// Triggers can also open the agent management side panel for fine-tuning.

function MiniChat({ open, setOpen, messages, onSend, onAcceptAction, onRejectAction, onOpenPanel }) {
  const inputRef = React.useRef(null);
  const scrollRef = React.useRef(null);
  const [draft, setDraft] = React.useState("");

  React.useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 250);
  }, [open]);
  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, open]);

  const submit = () => {
    if (!draft.trim()) return;
    onSend(draft.trim());
    setDraft("");
  };

  return (
    <div className={"chat-root glass-strong " + (open ? "chat-expanded" : "chat-collapsed")}
         style={{ display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(20,20,40,0.25)" }}>
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          style={{ all: "unset", cursor: "pointer", display: "flex", alignItems: "center", gap: 12, padding: "0 16px", height: "100%", width: "100%" }}>
          <div style={{ width: 32, height: 32, borderRadius: 10, background: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontWeight: 600, flexShrink: 0 }} className="breathe">✦</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 500 }}>Talk to Iris</div>
            <div style={{ fontSize: 11, color: "var(--text-faint)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {messages[messages.length - 1]?.text || "Briefing waiting · 7 decisions today"}
            </div>
          </div>
          <span className="pill info" style={{ flexShrink: 0 }}>3 new</span>
        </button>
      ) : (
        <>
          <header style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid var(--glass-border)" }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontWeight: 600 }}>✦</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>Iris</div>
              <div className="mono" style={{ fontSize: 10, color: "var(--text-faint)" }}>Personal · also on WhatsApp {TENANT.whatsapp}</div>
            </div>
            <button className="btn ghost" onClick={onOpenPanel} title="Manage team" style={{ padding: 6 }}>⚙</button>
            <button className="btn ghost" onClick={() => setOpen(false)} style={{ padding: "4px 10px", fontSize: 14 }}>✕</button>
          </header>

          <div ref={scrollRef} className="scroll" style={{ flex: 1, padding: 16, display: "flex", flexDirection: "column", gap: 10, minHeight: 0 }}>
            {messages.map((m, i) => (
              <ChatMessage key={i} m={m} onAcceptAction={onAcceptAction} onRejectAction={onRejectAction} onOpenPanel={onOpenPanel} />
            ))}
          </div>

          <div style={{ display: "flex", gap: 8, padding: 12, borderTop: "1px solid var(--glass-border)" }}>
            <input ref={inputRef} value={draft} onChange={(e) => setDraft(e.target.value)}
                   onKeyDown={(e) => e.key === "Enter" && submit()}
                   placeholder="Try: 'add a recruiter' or 'remove Cedar'…"
                   style={{ flex: 1, background: "rgba(255,255,255,0.5)", border: "1px solid var(--glass-border)", borderRadius: 10, padding: "10px 12px", outline: 0, font: "inherit", fontSize: 13 }} />
            <button className="btn primary" onClick={submit}>Send</button>
          </div>
        </>
      )}
    </div>
  );
}

function ChatMessage({ m, onAcceptAction, onRejectAction, onOpenPanel }) {
  const isUser = m.from === "user";
  const bubbleStyle = {
    maxWidth: "82%",
    padding: "10px 14px",
    borderRadius: 14,
    fontSize: 13,
    lineHeight: 1.5,
    background: isUser ? "var(--accent)" : "rgba(255,255,255,0.78)",
    color: isUser ? "white" : "var(--text)",
    borderTopRightRadius: isUser ? 4 : 14,
    borderTopLeftRadius: isUser ? 14 : 4,
    alignSelf: isUser ? "flex-end" : "flex-start",
    border: isUser ? "none" : "1px solid var(--glass-border)",
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: isUser ? "flex-end" : "flex-start" }}>
      <div style={bubbleStyle}>{m.text}</div>
      {m.action && m.action.status === "pending" && (
        <ActionCard action={m.action} onAccept={() => onAcceptAction(m.action.id)} onReject={() => onRejectAction(m.action.id)} onOpenPanel={onOpenPanel} />
      )}
      {m.action && m.action.status === "accepted" && (
        <div className="mono" style={{ fontSize: 10, color: "#1f7a48" }}>✓ Applied</div>
      )}
      {m.action && m.action.status === "rejected" && (
        <div className="mono" style={{ fontSize: 10, color: "var(--text-faint)" }}>Dismissed</div>
      )}
    </div>
  );
}

function ActionCard({ action, onAccept, onReject, onOpenPanel }) {
  const isAdd = action.kind === "add";
  const isRemove = action.kind === "remove";
  const isTier = action.kind === "tier";
  const a = action.agent;
  const delta = action.delta;
  const deltaStr = (delta >= 0 ? "+" : "") + "€" + Math.abs(delta) + "/mo";
  return (
    <div style={{ background: "rgba(255,255,255,0.85)", border: "1px solid var(--glass-border-strong)", borderRadius: 14, padding: 12, width: "82%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span className="pill info">
          {isAdd ? "Add agent" : isRemove ? "Remove agent" : "Tier change"}
        </span>
        <span style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 11, color: delta >= 0 ? "var(--accent-deep)" : "#1f7a48", fontWeight: 500 }}>{deltaStr}</span>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: 9, background: "var(--accent-soft)", color: "var(--accent-deep)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, flexShrink: 0 }}>
          {a.label[0]}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500 }}>
            {a.label} <span style={{ color: "var(--text-faint)", fontWeight: 400 }}>· {a.role}</span>
          </div>
          {isTier ? (
            <div className="mono" style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>
              {action.fromTier} → {action.toTier} · {TIER_DESC[action.toTier]}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.4, marginTop: 2 }}>{action.note}</div>
          )}
        </div>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button className="btn ghost" onClick={onReject} style={{ fontSize: 11, padding: "5px 10px" }}>Not now</button>
        <button className="btn ghost" onClick={onOpenPanel} style={{ fontSize: 11, padding: "5px 10px" }}>Open panel</button>
        <span style={{ flex: 1 }} />
        <button className="btn primary" onClick={onAccept} style={{ fontSize: 11, padding: "5px 12px" }}>
          {isAdd ? "Add" : isRemove ? "Remove" : "Switch"}
        </button>
      </div>
    </div>
  );
}

window.MiniChat = MiniChat;

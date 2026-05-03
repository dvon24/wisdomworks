// Four dashboard variants. Each is a self-contained component returning a Frame.

// ── A. Calm — generous whitespace, hierarchy front and center, minimal chrome
function VariantCalm() {
  return (
    <Frame width={1280} height={820} bg={BG.coast}>
      <TopNav right={
        <>
          <span className="pill info">7 pending</span>
          <button className="btn ghost" style={{ padding: 6 }}>⌘K</button>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: "var(--accent)", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600 }}>MO</div>
        </>
      } />
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 380px", gap: 24, padding: 28, minHeight: 0 }}>
        <div className="glass-strong" style={{ padding: 36, display: "flex", flexDirection: "column", gap: 24, minHeight: 0 }}>
          <Greeting size="xxl" />
          <div style={{ flex: 1, minHeight: 0 }}>
            <Hierarchy width={760} height={460} accent="#6366f1" externals={true} />
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span className="eyebrow">Live · 3 agents talking</span>
            <span style={{ flex: 1 }} />
            <button className="btn">Connected</button>
            <button className="btn ghost">Fractured</button>
          </div>
        </div>
        <aside style={{ display: "flex", flexDirection: "column", gap: 14, minHeight: 0 }}>
          <IrisChat height={300} />
          <div className="glass-strong" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10, minHeight: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="eyebrow">Pending approvals</span>
              <span style={{ flex: 1 }} />
              <span className="pill info">3</span>
            </div>
            <div className="scroll" style={{ flex: 1, minHeight: 0 }}>
              <ApprovalsList compact />
            </div>
          </div>
        </aside>
      </div>
    </Frame>
  );
}

// ── B. Briefing-first — chat is the hero, hierarchy is a calm header strip
function VariantBriefing() {
  return (
    <Frame width={1280} height={820} bg={BG.mtns}>
      <TopNav right={
        <>
          <button className="btn ghost" style={{ fontSize: 11 }}>Today</button>
          <button className="btn ghost" style={{ fontSize: 11 }}>Team</button>
          <button className="btn ghost" style={{ fontSize: 11 }}>Activity</button>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: "var(--accent)", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600 }}>MO</div>
        </>
      } />
      {/* Compact hierarchy ribbon */}
      <div className="glass" style={{ margin: "20px 28px 0", padding: 16, height: 200 }}>
        <Hierarchy width={1200} height={170} accent="#6366f1" externals={false} compact />
      </div>
      {/* Two-column conversation + decisions */}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 20, padding: 20, paddingTop: 16, minHeight: 0 }}>
        <div className="glass-strong" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 18, minHeight: 0 }}>
          <Greeting size="lg" />
          <div className="scroll" style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10, minHeight: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="dot acc" /><span className="mono" style={{ fontSize: 10, color: "var(--text-faint)" }}>IRIS · 06:42</span>
            </div>
            <div style={{ background: "rgba(255,255,255,0.7)", padding: "12px 14px", borderRadius: 14, borderTopLeftRadius: 4, fontSize: 13.5, lineHeight: 1.55 }}>
              The thing I'd handle first: Vega found a 31% Tuesday capacity hole. I built the fix — three moves, ready to deploy. Open it when you're at coffee #1.
            </div>
            <div style={{ background: "rgba(255,255,255,0.7)", padding: "12px 14px", borderRadius: 14, borderTopLeftRadius: 4, fontSize: 13.5, lineHeight: 1.55 }}>
              Sven Hinrich asked about Thursday — I drafted a reply in your tone. One tap to send.
            </div>
            <div style={{ background: "rgba(255,255,255,0.7)", padding: "12px 14px", borderRadius: 14, borderTopLeftRadius: 4, fontSize: 13.5, lineHeight: 1.55 }}>
              Heads-up: Orin is offline. No onboarding harmed. Reconnect Slack here →
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", borderTop: "1px solid var(--glass-border)", paddingTop: 12 }}>
            <input placeholder="Ask Iris anything…" style={{ flex: 1, background: "rgba(255,255,255,0.5)", border: "1px solid var(--glass-border)", borderRadius: 10, padding: "10px 12px", outline: 0, font: "inherit", fontSize: 13 }} />
            <button className="btn primary">Send</button>
          </div>
          <div className="mono" style={{ fontSize: 10, color: "var(--text-faint)", textAlign: "center" }}>Iris also messages you on WhatsApp · +49 30 ••• 4421</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minHeight: 0 }}>
          <div className="eyebrow">Today's three decisions</div>
          <div className="scroll" style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1, minHeight: 0 }}>
            <ApprovalsList />
          </div>
        </div>
      </div>
    </Frame>
  );
}

// ── C. Operations — denser, KPI-driven, hierarchy as a sidebar diagram
function VariantOps() {
  return (
    <Frame width={1280} height={820} bg={BG.dunes} dim>
      <TopNav right={
        <>
          <div style={{ display: "flex", padding: 3, gap: 2, background: "rgba(255,255,255,0.5)", borderRadius: 999, border: "1px solid var(--glass-border)" }}>
            <span style={{ padding: "6px 12px", borderRadius: 999, background: "white", fontSize: 11, fontWeight: 500 }}>Overview</span>
            <span style={{ padding: "6px 12px", fontSize: 11, color: "var(--text-dim)" }}>Individual</span>
            <span style={{ padding: "6px 12px", fontSize: 11, color: "var(--text-dim)" }}>Team</span>
            <span style={{ padding: "6px 12px", fontSize: 11, color: "var(--text-dim)" }}>Enterprise</span>
          </div>
          <span style={{ flex: "0 0 8px" }} />
          <div style={{ width: 28, height: 28, borderRadius: 8, background: "var(--accent)", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600 }}>MO</div>
        </>
      } />
      <div style={{ padding: "16px 24px 0" }}>
        <KPIInline />
      </div>
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1.1fr 1.4fr 0.9fr", gap: 16, padding: 16, minHeight: 0 }}>
        <div className="glass" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10, minHeight: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div className="eyebrow">Agent hierarchy</div>
            <span style={{ flex: 1 }} />
            <span className="pill ok">8 healthy</span>
            <span className="pill bad">1 down</span>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <Hierarchy width={380} height={520} accent="#6366f1" externals={true} compact />
          </div>
        </div>

        <div className="glass" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10, minHeight: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div className="eyebrow">Live activity feed</div>
            <span className="dot ok" style={{ animation: "breath 1.4s ease-in-out infinite" }} />
            <span style={{ flex: 1 }} />
            <span className="pill dim mono">All</span>
            <span className="pill dim mono">Needs attention</span>
          </div>
          <div className="scroll" style={{ flex: 1, minHeight: 0 }}>
            <FeedRows max={12} />
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, minHeight: 0 }}>
          <div className="glass" style={{ padding: 16 }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Iris · briefing</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.55, color: "var(--text-dim)" }}>
              <strong style={{ color: "var(--text)" }}>3 things, then your day is yours.</strong> I drafted the responses, moved the meetings, prepared the brief. You just need to nod.
            </div>
            <button className="btn primary" style={{ marginTop: 12, width: "100%" }}>Open briefing</button>
          </div>
          <div className="glass" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8, flex: 1, minHeight: 0 }}>
            <div className="eyebrow">Approvals · 3</div>
            <div className="scroll" style={{ flex: 1, minHeight: 0 }}>
              <ApprovalsList compact />
            </div>
          </div>
        </div>
      </div>
    </Frame>
  );
}

// ── D. Cinematic — full-bleed background, spotlit hierarchy, single decision card
function VariantCinematic() {
  return (
    <Frame width={1280} height={820} bg={BG.forest} dim veil="softer">
      <header style={{ display: "flex", alignItems: "center", padding: "16px 24px", gap: 14 }}>
        <div className="logo">w</div>
        <span style={{ fontSize: 13, fontWeight: 600 }}>WisdomWorks</span>
        <span className="mono" style={{ fontSize: 10, color: "var(--text-faint)", letterSpacing: "0.18em" }}>· {TENANT.name.toUpperCase()}</span>
        <span style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 10, color: "var(--text-faint)" }}>{TENANT.time.toUpperCase()}</span>
        <span style={{ width: 1, height: 16, background: "var(--glass-border-strong)" }} />
        <span className="pill info">7 pending</span>
        <div style={{ width: 28, height: 28, borderRadius: 8, background: "var(--accent)", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600 }}>MO</div>
      </header>

      {/* Hero hierarchy */}
      <div style={{ flex: 1, position: "relative", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", padding: "0 40px", minHeight: 0 }}>
        <div style={{ textAlign: "center", marginBottom: 8 }}>
          <div className="eyebrow" style={{ marginBottom: 10 }}>{TENANT.time}</div>
          <div className="num-xxl" style={{ fontWeight: 250 }}>Three things, then your day is yours.</div>
          <div style={{ marginTop: 10, color: "var(--text-dim)", fontSize: 14 }}>
            Your team handled <strong>1,284 decisions</strong> overnight · Atlas, Vega and Sable are talking now.
          </div>
        </div>
        <div style={{ flex: 1, width: "100%", maxWidth: 980, minHeight: 0 }}>
          <Hierarchy width={980} height={400} accent="#6366f1" externals={true} />
        </div>
      </div>

      {/* Single decision card pinned to bottom */}
      <div style={{ padding: "0 28px 24px", display: "grid", gridTemplateColumns: "1fr auto", gap: 16, alignItems: "stretch" }}>
        <div className="glass-strong" style={{ padding: 18, display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 18, alignItems: "center" }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: "var(--accent-soft)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent)", fontWeight: 600 }}>V</div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span className="pill warn">HIGH</span>
              <span className="mono" style={{ fontSize: 10, color: "var(--text-faint)" }}>VEGA · 86% confidence</span>
            </div>
            <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 4 }}>Reduce Tuesday wasted capacity by 31%</div>
            <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.45 }}>
              Three moves, ready to deploy: shift internal reviews to Tue AM, open a half-day client clinic, repurpose the dead 14:00 slot. <span className="mono" style={{ color: "#4338ca" }}>+€7,200/mo</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn">Modify</button>
            <button className="btn ghost">Dismiss</button>
            <button className="btn primary">Approve</button>
          </div>
        </div>
        <div className="glass" style={{ padding: 14, minWidth: 220, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div className="eyebrow" style={{ marginBottom: 4 }}>Next</div>
          <div style={{ fontSize: 13, fontWeight: 500 }}>2 more decisions</div>
          <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 2 }}>~6 min total</div>
        </div>
      </div>
    </Frame>
  );
}

Object.assign(window, { VariantCalm, VariantBriefing, VariantOps, VariantCinematic });

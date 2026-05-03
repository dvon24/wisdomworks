// Floating price diff card. Appears when team changes; auto-dismisses after a moment.

function PriceDiff({ delta, total, onDismiss }) {
  React.useEffect(() => {
    const t = setTimeout(onDismiss, 6000);
    return () => clearTimeout(t);
  }, [delta, total, onDismiss]);

  if (delta == null) return null;
  const sign = delta >= 0 ? "+" : "−";
  const positive = delta > 0;
  return (
    <div className="price-card glass-strong pop-in"
         style={{ padding: "14px 18px", display: "flex", alignItems: "center", gap: 14, boxShadow: "0 16px 48px rgba(20,20,40,0.22)", borderRadius: 14, minWidth: 240 }}>
      <div style={{
        width: 40, height: 40, borderRadius: 12,
        background: positive ? "var(--accent-soft)" : "rgba(34,150,90,0.14)",
        color: positive ? "var(--accent-deep)" : "#1f7a48",
        display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600
      }}>
        {sign}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>
          {sign}€{Math.abs(delta)}/mo
        </div>
        <div className="mono" style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 2 }}>NEW TOTAL · €{total}/MO</div>
      </div>
      <button className="btn ghost" onClick={onDismiss} style={{ padding: 4, fontSize: 14 }}>✕</button>
    </div>
  );
}

window.PriceDiff = PriceDiff;

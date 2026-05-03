// WisdomWorks logo: orbital atom mark + wordmark lockup.
// - <WisdomMark size accent /> : just the icon, scales to any size
// - <WisdomLockup tagline accent /> : mark + "WisdomWorks" + optional tagline
// - <WisdomMarkSVG ...inner/> : returns SVG <g> children, for embedding in another SVG (e.g. Iris node in hierarchy)

function WisdomMark({ size = 32, accent = "var(--accent)", satellite = "var(--accent-deep)" }) {
  // 80x80 viewBox, mark is centered around (40,40)
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" style={{ display: "block", flexShrink: 0 }}>
      <g>
        <ellipse cx="40" cy="40" rx="38" ry="15" fill="none" stroke={accent} strokeWidth="1.8" transform="rotate(-20 40 40)"/>
        <ellipse cx="40" cy="40" rx="30" ry="8"  fill="none" stroke={accent} strokeWidth="1.2" opacity="0.4" transform="rotate(40 40 40)"/>
        <ellipse cx="40" cy="40" rx="22" ry="5"  fill="none" stroke={accent} strokeWidth="1.2" opacity="0.4" transform="rotate(75 40 40)"/>
        <circle cx="40" cy="40" r="8"  fill={accent}/>
        <circle cx="40" cy="40" r="12" fill="none" stroke={accent} strokeWidth="1" opacity="0.5"/>
        <circle cx="74" cy="26" r="4"   fill={satellite}/>
        <circle cx="4"  cy="54" r="4"   fill={satellite}/>
        <circle cx="62" cy="64" r="2.6" fill={satellite} opacity="0.7"/>
      </g>
    </svg>
  );
}

// Inline SVG group — for embedding inside another SVG. cx/cy = center, scale = size factor (1 = 80x80 box)
function WisdomMarkInline({ cx, cy, scale = 1, accent = "currentColor", satellite, opacity = 1, animate = false }) {
  const sat = satellite || accent;
  return (
    <g transform={`translate(${cx - 40 * scale} ${cy - 40 * scale}) scale(${scale})`} opacity={opacity}>
      <ellipse cx="40" cy="40" rx="38" ry="15" fill="none" stroke={accent} strokeWidth="1.8" transform="rotate(-20 40 40)">
        {animate && <animateTransform attributeName="transform" type="rotate" from="-20 40 40" to="340 40 40" dur="22s" repeatCount="indefinite" />}
      </ellipse>
      <ellipse cx="40" cy="40" rx="30" ry="8"  fill="none" stroke={accent} strokeWidth="1.2" opacity="0.45" transform="rotate(40 40 40)">
        {animate && <animateTransform attributeName="transform" type="rotate" from="40 40 40" to="-320 40 40" dur="28s" repeatCount="indefinite" />}
      </ellipse>
      <ellipse cx="40" cy="40" rx="22" ry="5"  fill="none" stroke={accent} strokeWidth="1.2" opacity="0.45" transform="rotate(75 40 40)">
        {animate && <animateTransform attributeName="transform" type="rotate" from="75 40 40" to="435 40 40" dur="18s" repeatCount="indefinite" />}
      </ellipse>
      <circle cx="40" cy="40" r="8"  fill={accent}/>
      <circle cx="40" cy="40" r="12" fill="none" stroke={accent} strokeWidth="1" opacity="0.5"/>
      <circle cx="74" cy="26" r="4"   fill={sat}/>
      <circle cx="4"  cy="54" r="4"   fill={sat}/>
      <circle cx="62" cy="64" r="2.6" fill={sat} opacity="0.7"/>
    </g>
  );
}

function WisdomLockup({ size = 28, tagline = "because it does.", accent = "var(--accent)", color = "#1a1a22" }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <WisdomMark size={size + 8} accent={accent} satellite={accent} />
      <div style={{ lineHeight: 1.1 }}>
        <div style={{ fontSize: size * 0.5, fontWeight: 600, color, letterSpacing: "-0.01em" }}>WisdomWorks</div>
        {tagline && (
          <div style={{ fontFamily: "Georgia, serif", fontSize: size * 0.34, fontStyle: "italic", color: accent, marginTop: 2, letterSpacing: "0.01em" }}>
            {tagline}
          </div>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { WisdomMark, WisdomMarkInline, WisdomLockup });

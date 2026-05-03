// Cinematic photo background — same vibe as landing page (aerial timelapse).
// Slow crossfade + subtle Ken Burns. Replaces the aurora.

const BG_IMAGES = [
  "https://images.unsplash.com/photo-1505144808419-1957a94ca61e?auto=format&fit=crop&w=2400&q=80", // turquoise coast aerial (matches your screenshot)
  "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=2400&q=80", // mountain clouds
  "https://images.unsplash.com/photo-1418489098061-ce87b5dc3aee?auto=format&fit=crop&w=2400&q=80", // aerial coastline
  "https://images.unsplash.com/photo-1419242902214-272b3f66ee7a?auto=format&fit=crop&w=2400&q=80", // forest mist
];

function Background({ light = true }) {
  const [idx, setIdx] = React.useState(0);
  React.useEffect(() => {
    const t = setInterval(() => setIdx(i => (i + 1) % BG_IMAGES.length), 11000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="bg-root" aria-hidden>
      {BG_IMAGES.map((src, i) => (
        <div key={src}
          className={"bg-img" + (i === idx ? " active" : "")}
          style={{ backgroundImage: `url(${src})` }} />
      ))}
      <div className={"bg-veil " + (light ? "light" : "dark")} />
    </div>
  );
}

window.Background = Background;
window.BG_IMAGES = BG_IMAGES;

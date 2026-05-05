import { useEffect, useState } from 'react';

// Production Command Deck URL — change this when deployed to its own domain.
// In dev, run apps/web at localhost:3000 and Tauri will load it.
const DEV_URL = 'http://localhost:3000';
const PROD_URL = 'https://wisdomworks.vercel.app';

export default function App() {
  const [isDev, setIsDev] = useState(true);

  useEffect(() => {
    // Detect Tauri dev vs prod via environment
    const tauriEnv = (window as any).__TAURI_INTERNALS__?.metadata?.env ?? 'production';
    setIsDev(tauriEnv === 'development');
  }, []);

  const url = isDev ? DEV_URL : PROD_URL;

  return (
    <div style={{ width: '100vw', height: '100vh', margin: 0, padding: 0 }}>
      {/* Embed the Command Deck. Tauri's webview handles cookies, auth, etc. */}
      <iframe
        src={url}
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          display: 'block',
        }}
        title="WisdomWorks Command Deck"
        // Allow camera/mic for future voice features
        allow="microphone; camera; clipboard-read; clipboard-write"
      />
    </div>
  );
}

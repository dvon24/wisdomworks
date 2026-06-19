/**
 * Connect interstitial — the step between "tap the link in WhatsApp" and the
 * provider's OAuth screen.
 *
 * Why it exists: WhatsApp (and Instagram/Facebook) open links in an embedded
 * webview, and Google/Microsoft BLOCK OAuth inside embedded webviews
 * ("disallowed_useragent" / "this browser may not be secure"). So a raw OAuth
 * link tapped in WhatsApp fails. This page detects the in-app webview and steers
 * the user into a real browser before sending them to the provider; in a normal
 * browser it just shows a clean Continue button.
 *
 * Security: the provider is whitelisted to a fixed map of first-party OAuth
 * routes, so the redirect target can't be attacker-controlled (no open-redirect).
 */

import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

// Whitelist — provider → first-party OAuth start route. Anything not here is
// rejected, so ?provider= can never point the user off-site.
const OAUTH_ROUTES: Record<string, string> = {
  google: '/api/oauth/google',
  microsoft: '/api/oauth/microsoft',
  quickbooks: '/api/oauth/quickbooks',
  square: '/api/oauth/square',
  stripe: '/api/oauth/stripe',
  calendly: '/api/oauth/calendly',
  mindbody: '/api/oauth/mindbody',
  meta: '/api/oauth/meta',
};

const PROVIDER_LABEL: Record<string, string> = {
  google: 'Google',
  microsoft: 'Microsoft',
  quickbooks: 'QuickBooks',
  square: 'Square',
  stripe: 'Stripe',
  calendly: 'Calendly',
  mindbody: 'Mindbody',
  meta: 'Meta',
};

/** In-app webview user-agents where provider OAuth is blocked or unreliable. */
function isInAppWebview(ua: string): boolean {
  return /(WhatsApp|FBAN|FBAV|FB_IAB|Instagram|Line|MicroMessenger|; wv\)|GSA\/)/i.test(ua);
}

interface PageProps {
  searchParams: Promise<{ provider?: string; phone?: string; service?: string }>;
}

export default async function ConnectPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const provider = (sp.provider ?? '').toLowerCase();
  const route = OAUTH_ROUTES[provider];
  const label = PROVIDER_LABEL[provider] ?? provider;
  const phone = sp.phone ?? '';
  const service = sp.service ?? '';

  const wrap: React.CSSProperties = {
    minHeight: '100dvh', margin: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: '#0b0f14', color: '#e6edf3', fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', padding: 20,
  };
  const card: React.CSSProperties = {
    width: '100%', maxWidth: 420, background: '#11171f', border: '1px solid #1f2937', borderRadius: 16, padding: 24,
  };

  if (!route) {
    return (
      <main style={wrap}>
        <div style={card}>
          <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>Unknown service</h1>
          <p style={{ color: '#9aa7b4', margin: 0 }}>
            “{provider || '—'}” isn’t a connectable service. Head back to WhatsApp and ask Iris to connect it again.
          </p>
        </div>
      </main>
    );
  }

  const oauthUrl = `${route}?phone=${encodeURIComponent(phone)}${service ? `&service=${encodeURIComponent(service)}` : ''}`;
  const base = (process.env.NEXT_PUBLIC_APP_BASE_URL ?? '').replace(/\/$/, '');
  const thisPageUrl = `${base}/connect?provider=${encodeURIComponent(provider)}&phone=${encodeURIComponent(phone)}${service ? `&service=${encodeURIComponent(service)}` : ''}`;

  const ua = (await headers()).get('user-agent') ?? '';
  const webview = isInAppWebview(ua);

  return (
    <main style={wrap}>
      <div style={card}>
        <div style={{ fontSize: 13, letterSpacing: 0.4, color: '#5eead4', textTransform: 'uppercase', marginBottom: 8 }}>WisdomWorks</div>
        <h1 style={{ fontSize: 22, margin: '0 0 6px' }}>Connect {label}</h1>
        <p style={{ color: '#9aa7b4', margin: '0 0 20px', lineHeight: 1.5 }}>
          You’ll sign in with {label}{service ? ` and grant access to your ${service}` : ''}. WisdomWorks only uses it to do the work you ask for.
        </p>

        {webview && (
          <div style={{ background: '#3a2a12', border: '1px solid #7c5314', borderRadius: 12, padding: 14, marginBottom: 18 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>⚠️ Open this in your browser first</div>
            <p style={{ color: '#e8d4ab', margin: '0 0 10px', fontSize: 14, lineHeight: 1.5 }}>
              {label} blocks sign-in inside chat apps. Tap the <b>⋮ / Share</b> menu (top corner) and choose <b>“Open in Chrome / Safari”</b>, or copy this link into your browser:
            </p>
            <code style={{ display: 'block', wordBreak: 'break-all', background: '#0b0f14', border: '1px solid #1f2937', borderRadius: 8, padding: 10, fontSize: 12, color: '#cbd5e1' }}>
              {thisPageUrl}
            </code>
          </div>
        )}

        <a
          href={oauthUrl}
          style={{
            display: 'block', textAlign: 'center', textDecoration: 'none',
            background: '#14b8a6', color: '#04201c', fontWeight: 700, fontSize: 16,
            padding: '14px 16px', borderRadius: 12,
          }}
        >
          Continue to {label} →
        </a>

        <p style={{ color: '#5b6b7a', fontSize: 12, margin: '14px 0 0', textAlign: 'center' }}>
          {webview ? 'If you tap Continue here and see “browser not secure,” use the browser steps above.' : 'Secure OAuth — your password is never shared with WisdomWorks.'}
        </p>
      </div>
    </main>
  );
}

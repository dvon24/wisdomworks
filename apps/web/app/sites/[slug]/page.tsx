import { notFound } from 'next/navigation';
import { getTenantSiteBySlug, buildEmbedScriptTag } from '../../api/_lib/tenant-sites';

export const dynamic = 'force-dynamic';
export const revalidate = 60;

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  const site = await getTenantSiteBySlug(slug);
  if (!site) return { title: 'Not found' };
  return {
    title: site.business_name,
    description: site.meta_description ?? site.hero_subtitle ?? site.business_name,
    openGraph: {
      title: site.business_name,
      description: site.meta_description ?? site.hero_subtitle ?? '',
      images: site.hero_image_url ? [site.hero_image_url] : undefined,
    },
  };
}

export default async function TenantSitePage({ params }: PageProps) {
  const { slug } = await params;
  const site = await getTenantSiteBySlug(slug);
  if (!site) notFound();

  const accent = site.theme.accent || '#0f766e';
  const apiBase = process.env.NEXT_PUBLIC_APP_BASE_URL || '';
  const embeds = site.widget_api_key_plain
    ? buildEmbedScriptTag(site.widget_api_key_plain, apiBase)
    : { chat: '', booking: '' };

  const formatHours = (entry: { open: string; close: string } | null | undefined) => {
    if (!entry) return 'Closed';
    return `${entry.open} – ${entry.close}`;
  };
  const days: Array<{ key: string; label: string }> = [
    { key: 'mon', label: 'Monday' },
    { key: 'tue', label: 'Tuesday' },
    { key: 'wed', label: 'Wednesday' },
    { key: 'thu', label: 'Thursday' },
    { key: 'fri', label: 'Friday' },
    { key: 'sat', label: 'Saturday' },
    { key: 'sun', label: 'Sunday' },
  ];
  const hasHours = days.some((d) => site.hours[d.key]);

  return (
    <main style={{
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      color: '#1a1a1a',
      lineHeight: 1.6,
      minHeight: '100vh',
      background: '#fafafa',
    }}>
      {/* Hero */}
      <section style={{
        background: `linear-gradient(135deg, ${accent} 0%, ${darken(accent)} 100%)`,
        color: 'white',
        padding: '80px 24px 100px',
        textAlign: 'center',
      }}>
        <h1 style={{ fontSize: 'clamp(2rem, 5vw, 3.5rem)', fontWeight: 700, margin: 0, lineHeight: 1.2 }}>
          {site.hero_title || site.business_name}
        </h1>
        {site.hero_subtitle && (
          <p style={{ fontSize: 'clamp(1rem, 2vw, 1.25rem)', marginTop: 16, opacity: 0.95, maxWidth: 640, marginLeft: 'auto', marginRight: 'auto' }}>
            {site.hero_subtitle}
          </p>
        )}
        <div style={{ marginTop: 36, display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <span className="wisdomworks-book-button" />
        </div>
      </section>

      {/* Services */}
      {site.services.length > 0 && (
        <section style={{ maxWidth: 960, margin: '0 auto', padding: '60px 24px' }}>
          <h2 style={{ fontSize: '2rem', fontWeight: 600, marginBottom: 32, textAlign: 'center' }}>Services</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
            {site.services.map((s, i) => (
              <article key={i} style={{
                background: 'white',
                padding: 24,
                borderRadius: 12,
                boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                border: '1px solid #e5e7eb',
              }}>
                <h3 style={{ fontSize: '1.15rem', fontWeight: 600, margin: '0 0 8px' }}>{s.name}</h3>
                {s.description && (
                  <p style={{ fontSize: '0.95rem', color: '#6b7280', margin: '0 0 12px' }}>{s.description}</p>
                )}
                <div style={{ fontSize: '0.9rem', color: '#374151', display: 'flex', gap: 12 }}>
                  {s.durationMinutes && <span>{s.durationMinutes} min</span>}
                  {s.priceUsd != null && <span style={{ fontWeight: 600 }}>${s.priceUsd.toFixed(2)}</span>}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* Hours + Contact */}
      <section style={{
        maxWidth: 960, margin: '0 auto', padding: '60px 24px',
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 32,
      }}>
        {hasHours && (
          <div>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 600, marginBottom: 16 }}>Hours</h2>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: '0.95rem' }}>
              {days.map((d) => (
                <li key={d.key} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f0f0f0' }}>
                  <span>{d.label}</span>
                  <span style={{ color: '#6b7280' }}>{formatHours(site.hours[d.key])}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {(site.contact_email || site.contact_phone || site.address) && (
          <div>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 600, marginBottom: 16 }}>Get in touch</h2>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: '0.95rem' }}>
              {site.contact_phone && (
                <li style={{ padding: '6px 0' }}>
                  <a href={`tel:${site.contact_phone}`} style={{ color: accent, textDecoration: 'none' }}>{site.contact_phone}</a>
                </li>
              )}
              {site.contact_email && (
                <li style={{ padding: '6px 0' }}>
                  <a href={`mailto:${site.contact_email}`} style={{ color: accent, textDecoration: 'none' }}>{site.contact_email}</a>
                </li>
              )}
              {site.address && (
                <li style={{ padding: '6px 0', color: '#374151' }}>{site.address}</li>
              )}
            </ul>
          </div>
        )}
      </section>

      {/* Testimonials */}
      {site.testimonials.length > 0 && (
        <section style={{ maxWidth: 960, margin: '0 auto', padding: '40px 24px 80px' }}>
          <h2 style={{ fontSize: '1.6rem', fontWeight: 600, marginBottom: 24, textAlign: 'center' }}>What clients say</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
            {site.testimonials.map((t, i) => (
              <blockquote key={i} style={{
                background: 'white', padding: 24, borderRadius: 12, margin: 0,
                borderLeft: `4px solid ${accent}`, fontSize: '0.95rem', color: '#374151',
              }}>
                <p style={{ margin: '0 0 8px', fontStyle: 'italic' }}>"{t.quote}"</p>
                <footer style={{ fontSize: '0.85rem', color: '#6b7280' }}>— {t.author}</footer>
              </blockquote>
            ))}
          </div>
        </section>
      )}

      {/* Footer */}
      <footer style={{
        textAlign: 'center', padding: '24px', fontSize: '0.85rem', color: '#9ca3af',
        borderTop: '1px solid #e5e7eb', background: 'white',
      }}>
        © {new Date().getFullYear()} {site.business_name}. Powered by{' '}
        <a href="https://wisdomworks.app" style={{ color: '#6b7280' }}>WisdomWorks</a>.
      </footer>

      {/* Embed widgets — pasted in raw so the client-side JS mounts on visit */}
      {embeds.booking && (
        <script dangerouslySetInnerHTML={{ __html: `(function(){var s=document.createElement('script');s.src=${JSON.stringify(`${apiBase}/api/widget/booking.js?key=${site.widget_api_key_plain}&accent=${encodeURIComponent(accent)}`)};s.defer=true;document.body.appendChild(s);})();` }} />
      )}
      {embeds.chat && (
        <script dangerouslySetInnerHTML={{ __html: `(function(){var s=document.createElement('script');s.src=${JSON.stringify(`${apiBase}/api/widget/embed.js?key=${site.widget_api_key_plain}`)};s.defer=true;document.body.appendChild(s);})();` }} />
      )}
    </main>
  );
}

// Tiny color helper — darken a hex by 20% for the hero gradient
function darken(hex: string): string {
  const m = hex.match(/^#([0-9a-f]{6})$/i);
  if (!m) return hex;
  const num = parseInt(m[1]!, 16);
  const r = Math.max(0, ((num >> 16) & 0xff) - 40);
  const g = Math.max(0, ((num >> 8) & 0xff) - 40);
  const b = Math.max(0, (num & 0xff) - 40);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

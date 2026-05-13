-- Story 2b.7 — Client Website Generation.
--
-- Multi-tenant website rendering: one row per tenant site, served by a
-- single Next.js render route at /sites/[slug] (and eventually a
-- subdomain when wildcard DNS is configured).
--
-- Custom domain support is opportunistic — owner can point their domain
-- at our render endpoint via Vercel's domain settings; we look up by
-- Host header.
--
-- Run once in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS tenant_sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_phone TEXT NOT NULL UNIQUE,
  -- URL-safe slug, unique across all tenants. Becomes
  -- wisdomworks.app/sites/<slug> and eventually <slug>.wisdomworks.app
  slug TEXT NOT NULL UNIQUE,
  -- Lifecycle
  status TEXT NOT NULL DEFAULT 'draft',
  -- Hero / above-the-fold
  business_name TEXT NOT NULL,
  hero_title TEXT,
  hero_subtitle TEXT,
  hero_image_url TEXT,
  -- Contact
  contact_email TEXT,
  contact_phone TEXT,
  address TEXT,
  -- Hours of operation — JSONB shape:
  --   { mon: { open: '09:00', close: '18:00' }, tue: {...}, ... }
  -- A day missing or null means closed.
  hours JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Services to display on the site — JSONB array:
  --   [{ name, description, durationMinutes?, priceUsd?, square_id? }]
  -- Auto-populated from Square if connected; owner can also add manually.
  services JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Theme — JSONB:
  --   { accent: '#0f766e', vertical: 'Salon', layout: 'standard' }
  theme JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Embed widget API key id (links to widget_api_keys.id) — auto-created
  -- on site provision so booking + chat widgets work out of the box.
  widget_api_key_id UUID REFERENCES widget_api_keys(id) ON DELETE SET NULL,
  -- Plain key needed so server-side renders can inject the embed
  -- <script src=...?key=...> tag. The key is PUBLIC anyway (visible in
  -- the rendered HTML); origin allowlist on widget_api_keys is the
  -- security boundary, not key secrecy.
  widget_api_key_plain TEXT,
  -- Custom domain if owner has pointed one. NULL = subdomain/path only.
  custom_domain TEXT UNIQUE,
  -- SEO basics
  meta_description TEXT,
  -- Gallery / additional content
  gallery JSONB NOT NULL DEFAULT '[]'::jsonb,
  testimonials JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Bookkeeping
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT tenant_sites_status_check CHECK (status IN ('draft', 'published', 'archived')),
  CONSTRAINT tenant_sites_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$')
);

CREATE INDEX IF NOT EXISTS tenant_sites_status_idx
  ON tenant_sites (status, published_at DESC);

SELECT 'tenant_sites ready' AS status;

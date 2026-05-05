/**
 * Website integration — crawl, analyze, and detect platform.
 *
 * Stage 1 (this file): READ — fetch the site, extract content, detect platform.
 * Stage 2 (per-platform clients): WRITE — Shopify Admin API, WP REST, etc.
 */

import * as cheerio from 'cheerio';
import type { IntegrationResult } from './types';

export type WebsitePlatform =
  | 'shopify'
  | 'wordpress'
  | 'wix'
  | 'squarespace'
  | 'webflow'
  | 'next.js'
  | 'react'
  | 'static'
  | 'unknown';

export interface WebsiteSnapshot {
  url: string;
  title?: string;
  description?: string;
  platform: WebsitePlatform;
  pages: { url: string; title?: string; wordCount: number }[];
  headings: string[];
  navigation: string[];
  hasContactPage: boolean;
  hasBookingFlow: boolean;
  hasPricing: boolean;
  hasReviews: boolean;
  hasMobileMeta: boolean;
  performance: {
    loadTimeMs?: number;
    htmlSizeKb: number;
  };
  socialLinks: { platform: string; url: string }[];
  /** Detected business signals — products listed, services described, etc. */
  signals: string[];
  fetchedAt: string;
}

/**
 * Fetch the homepage and analyze it.
 * Returns a structured snapshot the agent can reason about.
 */
export async function analyzeWebsite(url: string): Promise<IntegrationResult<WebsiteSnapshot>> {
  try {
    const cleanUrl = normalizeUrl(url);
    const start = Date.now();

    const res = await fetch(cleanUrl, {
      headers: {
        'User-Agent': 'WisdomWorks-Crawler/1.0 (+https://wisdomworks.app)',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      return { success: false, error: `Fetch failed: ${res.status}` };
    }

    const html = await res.text();
    const loadTimeMs = Date.now() - start;
    const $ = cheerio.load(html);

    // Title and meta
    const title = $('title').first().text().trim() || $('meta[property="og:title"]').attr('content');
    const description =
      $('meta[name="description"]').attr('content') ??
      $('meta[property="og:description"]').attr('content');

    // Detect platform
    const platform = detectPlatform(html, $);

    // Headings (top of mental model — what the site says it does)
    const headings = $('h1, h2')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((t) => t && t.length < 200)
      .slice(0, 20);

    // Navigation links
    const navigation = $('nav a, header a')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((t) => t && t.length > 1 && t.length < 50)
      .slice(0, 30);

    // Pages — internal links from nav
    const internalLinks: string[] = [];
    const baseUrl = new URL(cleanUrl);
    $('nav a[href], header a[href], main a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      try {
        const linkUrl = new URL(href, cleanUrl);
        if (linkUrl.hostname === baseUrl.hostname && !internalLinks.includes(linkUrl.href)) {
          internalLinks.push(linkUrl.href);
        }
      } catch {}
    });

    // Detect common patterns
    const lowerHtml = html.toLowerCase();
    const hasContactPage = /contact|reach\s*us|get\s*in\s*touch/i.test(navigation.join(' ')) || $('a[href*="contact"]').length > 0;
    const hasBookingFlow = /book\s*(now|appointment|online)|schedule|appointment/i.test(lowerHtml);
    const hasPricing = $('a[href*="pricing"], a[href*="prices"]').length > 0 || /\$\d+|\€\d+|\£\d+/.test(html);
    const hasReviews = /review|testimonial|rating|stars?/i.test(navigation.join(' ')) || $('[class*="review"], [class*="testimonial"]').length > 0;
    const hasMobileMeta = $('meta[name="viewport"]').length > 0;

    // Social links
    const socialPatterns = [
      { platform: 'instagram', regex: /instagram\.com\/([^"'\s/]+)/i },
      { platform: 'facebook', regex: /facebook\.com\/([^"'\s/]+)/i },
      { platform: 'twitter', regex: /(?:twitter\.com|x\.com)\/([^"'\s/]+)/i },
      { platform: 'linkedin', regex: /linkedin\.com\/(company|in)\/([^"'\s/]+)/i },
      { platform: 'tiktok', regex: /tiktok\.com\/@([^"'\s/]+)/i },
      { platform: 'youtube', regex: /youtube\.com\/(@?[^"'\s/]+)/i },
    ];
    const socialLinks: { platform: string; url: string }[] = [];
    for (const { platform: p, regex } of socialPatterns) {
      const match = html.match(regex);
      if (match) {
        socialLinks.push({ platform: p, url: match[0] });
      }
    }

    // Business signals — what does the site tell us?
    const signals: string[] = [];
    if (hasBookingFlow) signals.push('Has online booking');
    if (hasPricing) signals.push('Pricing visible');
    if (hasReviews) signals.push('Shows customer reviews');
    if (!hasMobileMeta) signals.push('Missing mobile viewport meta — may have mobile UX issues');
    if (!hasContactPage) signals.push('No contact page detected');
    if (socialLinks.length === 0) signals.push('No social media links found');
    if (loadTimeMs > 3000) signals.push(`Slow page load (${loadTimeMs}ms)`);

    return {
      success: true,
      data: {
        url: cleanUrl,
        title,
        description,
        platform,
        pages: internalLinks.slice(0, 20).map((p) => ({ url: p, wordCount: 0 })),
        headings,
        navigation: Array.from(new Set(navigation)),
        hasContactPage,
        hasBookingFlow,
        hasPricing,
        hasReviews,
        hasMobileMeta,
        performance: {
          loadTimeMs,
          htmlSizeKb: Math.round(html.length / 1024),
        },
        socialLinks,
        signals,
        fetchedAt: new Date().toISOString(),
      },
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

function normalizeUrl(url: string): string {
  let u = url.trim();
  if (!u.startsWith('http://') && !u.startsWith('https://')) {
    u = 'https://' + u;
  }
  return u.replace(/\/$/, '');
}

function detectPlatform(html: string, $: cheerio.CheerioAPI): WebsitePlatform {
  // Shopify signatures
  if (html.includes('Shopify.theme') || html.includes('cdn.shopify.com') || html.includes('myshopify.com')) {
    return 'shopify';
  }
  // WordPress
  if (
    html.includes('wp-content/') ||
    html.includes('wp-includes/') ||
    $('meta[name="generator"][content*="WordPress"]').length > 0
  ) {
    return 'wordpress';
  }
  // Wix
  if (html.includes('wixstatic.com') || html.includes('X-Wix-')) {
    return 'wix';
  }
  // Squarespace
  if (html.includes('squarespace.com') || html.includes('static1.squarespace.com')) {
    return 'squarespace';
  }
  // Webflow
  if (html.includes('webflow.io') || html.includes('Webflow') || $('html[data-wf-page]').length > 0) {
    return 'webflow';
  }
  // Next.js
  if (html.includes('__NEXT_DATA__') || $('#__next').length > 0) {
    return 'next.js';
  }
  // Generic React
  if (html.includes('id="root"') && html.includes('react')) {
    return 'react';
  }
  return 'unknown';
}

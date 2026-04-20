/**
 * Stories 2b.7-2b.8 — Website Generation + Embeddable Widgets
 *
 * WisdomWorks can BUILD a website for clients (via Vercel API)
 * or CONNECT to existing websites (via embeddable widgets).
 */

// Story 2b.7 — Website Generation
export interface GeneratedWebsite {
  tenantId: string;
  projectId: string; // Vercel project ID
  subdomain: string; // businessname.wisdomworks.com
  customDomain?: string; // salonbella.com
  template: string; // industry-specific template
  pages: WebsitePage[];
  status: 'generating' | 'deployed' | 'updating' | 'error';
  deployedAt?: string;
}

export interface WebsitePage {
  path: string;
  title: string;
  type: 'home' | 'services' | 'booking' | 'contact' | 'about' | 'custom';
  content: Record<string, unknown>;
}

// Story 2b.8 — Embeddable Widgets
export interface WidgetConfig {
  tenantId: string;
  apiKey: string; // tenant-scoped API key
  widgetType: WidgetType;
  styling: {
    primaryColor: string;
    fontFamily: string;
    position: 'bottom-right' | 'bottom-left';
    size: 'compact' | 'standard' | 'large';
  };
}

export type WidgetType = 'booking' | 'chat' | 'contact_form';

export interface WidgetEmbed {
  /** HTML snippet to embed on external website */
  iframeCode: string;
  /** JS snippet for dynamic embed */
  scriptCode: string;
  /** API endpoint for custom integration */
  apiEndpoint: string;
}

/**
 * Generate embed code for a widget.
 */
export function generateEmbedCode(config: WidgetConfig): WidgetEmbed {
  const baseUrl = 'https://widgets.wisdomworks.com';
  const widgetUrl = `${baseUrl}/${config.widgetType}?key=${config.apiKey}`;

  return {
    iframeCode: `<iframe src="${widgetUrl}" style="border:none;width:400px;height:600px;" title="WisdomWorks ${config.widgetType}"></iframe>`,
    scriptCode: `<script src="${baseUrl}/embed.js" data-widget="${config.widgetType}" data-key="${config.apiKey}"></script>`,
    apiEndpoint: `${baseUrl}/api/${config.widgetType}/${config.apiKey}`,
  };
}

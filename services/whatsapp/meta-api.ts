/**
 * WhatsApp Meta Cloud API — official integration.
 * No Baileys, no QR codes, no blocks.
 *
 * Send: POST to graph.facebook.com
 * Receive: Webhook at /api/webhooks/whatsapp
 */

const GRAPH_API = 'https://graph.facebook.com/v25.0';

export interface WhatsAppConfig {
  phoneId: string;
  accessToken: string;
  businessId: string;
}

function getConfig(): WhatsAppConfig {
  return {
    phoneId: process.env.WHATSAPP_PHONE_ID ?? '',
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN ?? '',
    businessId: process.env.WHATSAPP_BUSINESS_ID ?? '',
  };
}

/**
 * Send a text message via WhatsApp.
 */
export async function sendWhatsAppMessage(
  to: string,
  text: string,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const config = getConfig();
  if (!config.phoneId || !config.accessToken) {
    return { success: false, error: 'WhatsApp credentials not configured' };
  }

  // Clean phone number — remove +, spaces, dashes
  const cleanTo = to.replace(/[\s\-\+]/g, '');

  try {
    const response = await fetch(`${GRAPH_API}/${config.phoneId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: cleanTo,
        type: 'text',
        text: { body: text },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[whatsapp] Send failed:', data);
      return { success: false, error: data.error?.message ?? 'Unknown error' };
    }

    return {
      success: true,
      messageId: data.messages?.[0]?.id,
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * Send the hello_world template message (for testing).
 */
export async function sendTemplateMessage(
  to: string,
  templateName: string = 'hello_world',
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const config = getConfig();
  if (!config.phoneId || !config.accessToken) {
    return { success: false, error: 'WhatsApp credentials not configured' };
  }

  const cleanTo = to.replace(/[\s\-\+]/g, '');

  try {
    const response = await fetch(`${GRAPH_API}/${config.phoneId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: cleanTo,
        type: 'template',
        template: {
          name: templateName,
          language: { code: 'en_US' },
        },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return { success: false, error: data.error?.message ?? 'Unknown error' };
    }

    return { success: true, messageId: data.messages?.[0]?.id };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * Verify webhook (Meta sends a GET to verify your endpoint).
 */
export function verifyWebhook(
  mode: string | null,
  token: string | null,
  challenge: string | null,
  verifyToken: string,
): { valid: boolean; challenge?: string } {
  if (mode === 'subscribe' && token === verifyToken) {
    return { valid: true, challenge: challenge ?? '' };
  }
  return { valid: false };
}

/**
 * Parse incoming webhook message from Meta.
 */
export function parseWebhookMessage(body: any): {
  from: string;
  text: string;
  messageId: string;
  timestamp: string;
} | null {
  try {
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    if (!message) return null;

    return {
      from: message.from,
      text: message.text?.body ?? '',
      messageId: message.id,
      timestamp: message.timestamp,
    };
  } catch {
    return null;
  }
}

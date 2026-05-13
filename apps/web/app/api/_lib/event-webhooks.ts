/**
 * Event webhooks — outbound firehose to Zapier / Make / IFTTT / n8n /
 * custom endpoints. When important things happen in WisdomWorks
 * (booking created, lead captured, insight emitted, etc.), we POST a
 * JSON payload to each subscribed webhook URL.
 *
 * The breadth multiplier: tenants pipe our events into the automation
 * platform of their choice, gaining access to 7000+ apps without us
 * building each integration ourselves.
 *
 * Signature: HMAC-SHA256 of the JSON body, hex-encoded, in
 * X-WisdomWorks-Signature header. Receivers verify with the signing
 * secret shown once at webhook creation.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

export type WebhookEventType =
  | 'booking_created'
  | 'client_created'
  | 'client_visit_logged'
  | 'insight_emitted'
  | 'lead_captured'
  | 'team_gap_proposed'
  | 'review_received'
  | 'photo_uploaded';

export interface EventWebhook {
  id: string;
  tenant_phone: string;
  url: string;
  label: string | null;
  event_types: string[];
  signing_secret: string;
  status: 'active' | 'paused' | 'revoked';
  last_fired_at: string | null;
  fire_count: number;
  failure_count: number;
}

function generateSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function createWebhook(input: {
  tenantPhone: string;
  url: string;
  label?: string;
  eventTypes?: WebhookEventType[];
}): Promise<{ id: string; signingSecret: string } | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  // Basic URL validation
  try { new URL(input.url); } catch { return null; }
  if (!input.url.startsWith('https://')) return null;
  const cleanPhone = input.tenantPhone.replace(/[\s\-+()]/g, '');
  const signingSecret = generateSecret();
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/event_webhooks`, {
      method: 'POST',
      headers: { ...headers(), Prefer: 'return=representation' },
      body: JSON.stringify({
        tenant_phone: cleanPhone,
        url: input.url,
        label: input.label ?? null,
        event_types: input.eventTypes ?? [],
        signing_secret: signingSecret,
        status: 'active',
      }),
    });
    if (!res.ok) {
      console.warn('[event-webhooks] create failed:', await res.text());
      return null;
    }
    const rows = await res.json();
    return { id: rows[0]?.id, signingSecret };
  } catch (err) {
    console.warn('[event-webhooks] create exception:', err);
    return null;
  }
}

export async function listWebhooks(tenantPhone: string): Promise<EventWebhook[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/event_webhooks?tenant_phone=eq.${cleanPhone}&order=created_at.desc&select=*`,
      { headers: headers() },
    );
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export async function revokeWebhook(webhookId: string, tenantPhone: string): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false;
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/event_webhooks?id=eq.${webhookId}&tenant_phone=eq.${cleanPhone}`,
      {
        method: 'PATCH',
        headers: { ...headers(), Prefer: 'return=minimal' },
        body: JSON.stringify({
          status: 'revoked',
          revoked_at: new Date().toISOString(),
        }),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

async function hmacSha256(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Fire an event to all subscribed webhooks for the tenant. Fire-and-
 * forget; never blocks the caller. Records delivery to
 * event_webhook_deliveries for owner-side debugging.
 */
export async function fireEvent(input: {
  tenantPhone: string;
  eventType: WebhookEventType;
  payload: Record<string, any>;
}): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  const cleanPhone = input.tenantPhone.replace(/[\s\-+()]/g, '');
  try {
    // Find active webhooks that subscribe to this event (empty array = all)
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/event_webhooks?tenant_phone=eq.${cleanPhone}&status=eq.active&select=*`,
      { headers: headers() },
    );
    if (!res.ok) return;
    const webhooks: EventWebhook[] = await res.json();
    const matching = webhooks.filter((w) =>
      w.event_types.length === 0 || w.event_types.includes(input.eventType),
    );

    const envelope = {
      event_type: input.eventType,
      tenant_phone: cleanPhone,
      timestamp: new Date().toISOString(),
      payload: input.payload,
    };
    const body = JSON.stringify(envelope);

    // Fire all in parallel
    await Promise.all(matching.map((w) => deliverOne(w, input.eventType, body, envelope)));
  } catch (err) {
    console.warn('[event-webhooks] fireEvent exception:', err);
  }
}

async function deliverOne(webhook: EventWebhook, eventType: string, body: string, envelope: any): Promise<void> {
  const started = Date.now();
  let responseStatus: number | undefined;
  let responseBody = '';
  try {
    const signature = await hmacSha256(webhook.signing_secret, body);
    const res = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-WisdomWorks-Signature': signature,
        'X-WisdomWorks-Event': eventType,
      },
      body,
      // Don't wait forever — Zapier should respond fast
      signal: AbortSignal.timeout(10_000),
    });
    responseStatus = res.status;
    try { responseBody = (await res.text()).slice(0, 1000); } catch {}
    await updateWebhookStats(webhook.id, res.ok, res.status, res.ok ? null : responseBody);
  } catch (err: any) {
    responseStatus = 0;
    responseBody = err?.message ?? String(err);
    await updateWebhookStats(webhook.id, false, 0, responseBody);
  } finally {
    // Log delivery for debugging (truncated payload)
    if (SUPABASE_URL && SUPABASE_KEY) {
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/event_webhook_deliveries`, {
          method: 'POST',
          headers: { ...headers(), Prefer: 'return=minimal' },
          body: JSON.stringify({
            webhook_id: webhook.id,
            event_type: eventType,
            payload: envelope.payload,
            response_status: responseStatus,
            response_body: responseBody.slice(0, 500),
            duration_ms: Date.now() - started,
          }),
        });
      } catch {}
    }
  }
}

async function updateWebhookStats(
  webhookId: string,
  ok: boolean,
  statusCode: number,
  errorBody: string | null,
): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    // Read current counts so we can increment atomically-enough
    const cur = await fetch(
      `${SUPABASE_URL}/rest/v1/event_webhooks?id=eq.${webhookId}&select=fire_count,failure_count`,
      { headers: headers() },
    );
    if (!cur.ok) return;
    const rows = await cur.json();
    const row = rows[0];
    if (!row) return;
    await fetch(`${SUPABASE_URL}/rest/v1/event_webhooks?id=eq.${webhookId}`, {
      method: 'PATCH',
      headers: { ...headers(), Prefer: 'return=minimal' },
      body: JSON.stringify({
        last_fired_at: new Date().toISOString(),
        last_status_code: statusCode,
        last_error: ok ? null : errorBody,
        fire_count: row.fire_count + 1,
        failure_count: row.failure_count + (ok ? 0 : 1),
      }),
    });
  } catch {
    // Non-fatal
  }
}

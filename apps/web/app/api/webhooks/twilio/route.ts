/**
 * Twilio inbound webhook — the SMS customer lane for the SMB framework.
 *
 * A CUSTOMER texts a business's dedicated Twilio number. We resolve the inbound
 * `To` (the business line) → tenant, treat the `From` as the customer, and run
 * generateCustomerReply. THE ROUTING SPLIT: this handler ONLY ever calls
 * generateCustomerReply — there is no import of / path to generateIrisReply, so
 * a customer can never reach the owner brain (the dangerous failure mode). The
 * owner's control plane is a separate channel (WhatsApp/Telegram), never this
 * number.
 *
 * Reply is sent via the Twilio REST API (sendSms) FROM the business number (the
 * inbound `To`) — correct for multi-tenant, and decoupled from this webhook's
 * HTTP response so a slow LLM turn still delivers (we just ACK empty TwiML).
 *
 * Setup per tenant: provision a Twilio number, point its inbound webhook here,
 * and register it: INSERT into tenant_channels (channel='sms', external_id=<the
 * business number>, tenant_phone=<tenant>, status='active').
 */

import crypto from 'crypto';
import { claimMessage } from '../../_lib/message-idempotency';
import { resolveTenantForChannel } from '../../_lib/messaging-adapters';
import { generateCustomerReply } from '../../_lib/customer-reply';
import { sendSms } from '../../_lib/twilio-sms';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const ackTwiml = () =>
  new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    headers: { 'Content-Type': 'application/xml' },
  });

/** Twilio request validation: base64(HMAC-SHA1(authToken, url + sortedParams)). */
function verifyTwilioSignature(url: string, params: Record<string, string>, signature: string, authToken: string): boolean {
  let data = url;
  for (const key of Object.keys(params).sort()) data += key + params[key];
  const expected = crypto.createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const params: Record<string, string> = {};
    for (const [k, v] of form.entries()) params[k] = String(v);

    const from = (params.From ?? '').trim();
    const to = (params.To ?? '').trim();
    const body = (params.Body ?? '').trim();
    const messageSid = (params.MessageSid ?? '').trim();

    // ── Signature verification (anti-spoof; this triggers LLM + outbound SMS).
    // Enforced when TWILIO_AUTH_TOKEN is set; TWILIO_SKIP_SIGNATURE=1 escapes
    // it for local/dev bring-up while the public URL reconstruction is verified.
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (authToken && process.env.TWILIO_SKIP_SIGNATURE !== '1') {
      const proto = request.headers.get('x-forwarded-proto') ?? 'https';
      const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? '';
      const url = `${proto}://${host}/api/webhooks/twilio`;
      const sig = request.headers.get('x-twilio-signature') ?? '';
      if (!sig || !verifyTwilioSignature(url, params, sig, authToken)) {
        console.warn('[twilio] signature verification failed', { url, hasSig: !!sig });
        return new Response('Forbidden', { status: 403 });
      }
    }

    if (!from || !to || !body || !messageSid) return ackTwiml();

    // Idempotency — Twilio retries on slow/duplicate delivery.
    const claimed = await claimMessage(`sms-${messageSid}`, 'sms', from);
    if (!claimed) return ackTwiml();

    // Resolve the BUSINESS line (To) → tenant. From is the customer.
    const mapping = await resolveTenantForChannel('sms', to);
    if (!mapping) {
      console.warn(`[twilio] inbound to unregistered number ${to} — ignoring`);
      return ackTwiml();
    }

    const { reply } = await generateCustomerReply({
      tenantPhone: mapping.tenantPhone,
      customerPhone: from,
      channel: 'sms',
      message: body,
    });

    // Reply FROM the business number (the inbound To), via the API.
    if (reply && reply.trim()) {
      await sendSms({ to: from, from: to, body: reply });
    }
    return ackTwiml();
  } catch (err) {
    console.error('[twilio-webhook] error:', err);
    return ackTwiml();
  }
}

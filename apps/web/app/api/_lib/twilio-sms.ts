/**
 * Story 2b.3 — Twilio SMS outbound.
 *
 * Used for time-sensitive alerts where WhatsApp may not be checked
 * fast enough — payment failures, security alerts, urgent client
 * messages outside business hours. The agent tool exposes this to
 * Iris; the critical-severity notification path bypasses the digest
 * and sends direct SMS.
 *
 * Cost transparency (per the third-party cost rule): Twilio SMS is
 * ~$0.0079/segment in the US (160 chars = 1 segment). A 320-char alert
 * is two segments = ~$0.016. Surfaced in the agent tool description so
 * Iris quotes the cost when using it.
 *
 * Required env:
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_FROM_NUMBER  (the Twilio phone number that owns sending privileges)
 */

const TWILIO_API = 'https://api.twilio.com/2010-04-01';

export interface SendSmsResult {
  ok: boolean;
  messageSid?: string;
  error?: string;
}

export async function sendSms(input: {
  to: string;
  body: string;
  /** Sender number. Defaults to env. For multi-tenant CUSTOMER replies pass the
   *  business's own number (the inbound `To`) so the reply comes from the right
   *  line, not a shared global number. */
  from?: string;
}): Promise<SendSmsResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  // Accept an explicit per-call from (business number) first, then either env
  // name — TWILIO_FROM_NUMBER or TWILIO_PHONE_NUMBER (both appear in the wild).
  const fromNumber = input.from ?? process.env.TWILIO_FROM_NUMBER ?? process.env.TWILIO_PHONE_NUMBER;
  if (!accountSid || !authToken || !fromNumber) {
    return {
      ok: false,
      error: 'Twilio SMS not configured (need TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and a from number: TWILIO_FROM_NUMBER/TWILIO_PHONE_NUMBER env or an explicit from).',
    };
  }

  // Twilio expects E.164 (+countrycode). Clean common formatting.
  const cleanTo = input.to.trim().startsWith('+')
    ? input.to.trim().replace(/[\s\-()]/g, '')
    : `+${input.to.trim().replace(/[^\d]/g, '')}`;
  const body = input.body.slice(0, 1600); // 10 segments cap — anything longer is wrong-shape for SMS

  const basicAuth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const params = new URLSearchParams({ To: cleanTo, From: fromNumber, Body: body });

  try {
    const res = await fetch(`${TWILIO_API}/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    if (!res.ok) {
      const errBody = await res.text();
      console.warn('[twilio-sms] send failed:', res.status, errBody);
      return { ok: false, error: `Twilio ${res.status}: ${errBody.slice(0, 300)}` };
    }
    const data = await res.json();
    return { ok: true, messageSid: data.sid };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

/** Rough cost estimate for transparency. ~$0.0079/segment in US. */
export function estimateSmsCost(bodyLength: number): { segments: number; estimatedUsd: number } {
  const segments = Math.max(1, Math.ceil(bodyLength / 160));
  return { segments, estimatedUsd: Number((segments * 0.0079).toFixed(4)) };
}

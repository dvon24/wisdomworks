/**
 * Widget Book API — creates a real booking on the merchant's calendar.
 *
 * POST /api/widget/book
 *   Headers: X-API-Key: wk_...
 *   Body: { service_id, start_at, name, email?, phone?, notes? }
 *   Returns: { booking_id, when_iso }
 *
 * This is the PUBLIC booking endpoint — a website visitor (not the
 * owner) is the actor. No owner-approval gate; the act of having the
 * widget on the site IS the owner's permission for visitors to book.
 *
 * Customer dedup: find by email in Square first; create if missing.
 * Booking dedup: Square's idempotency_key (customer+start+service).
 */

import { NextResponse } from 'next/server';
import { verifyApiKey } from '../../_lib/widget-auth';
import { squareAdapter } from '../../_lib/booking-adapters/square';
import { loadActiveBookingConnections } from '../../_lib/booking-adapters/customer-sync';
import { decryptToken } from '@wisdomworks/shared';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function POST(request: Request) {
  const apiKey = request.headers.get('x-api-key') ?? '';
  const origin = request.headers.get('origin') ?? undefined;
  const verified = await verifyApiKey(apiKey, origin);
  if (!verified) return NextResponse.json({ error: 'invalid api key' }, { status: 401, headers: CORS });

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400, headers: CORS });
  }

  const serviceId = String(body.service_id ?? '').trim();
  const startAt = String(body.start_at ?? '').trim();
  const name = String(body.name ?? '').trim();
  const email = body.email ? String(body.email).trim() : undefined;
  const phone = body.phone ? String(body.phone).trim() : undefined;
  const notes = body.notes ? String(body.notes).trim().slice(0, 500) : undefined;

  if (!serviceId || !startAt || !name) {
    return NextResponse.json({ error: 'service_id, start_at, name required' }, { status: 400, headers: CORS });
  }
  if (!email && !phone) {
    return NextResponse.json({ error: 'email or phone required' }, { status: 400, headers: CORS });
  }

  // Validate start_at is in the future (basic sanity)
  if (new Date(startAt).getTime() < Date.now() - 60_000) {
    return NextResponse.json({ error: 'start_at must be in the future' }, { status: 400, headers: CORS });
  }

  const conns = await loadActiveBookingConnections(verified.tenant_phone);
  const conn = conns.find((c) => c.provider === 'square');
  if (!conn) {
    return NextResponse.json({ error: 'merchant has no booking system connected' }, { status: 503, headers: CORS });
  }

  try {
    const token = await decryptToken(conn.access_token);
    const customerId = await squareAdapter.findOrCreateCustomer!(token, { name, email, phone }, { merchantId: conn.metadata?.merchant_id });
    if (!customerId) {
      return NextResponse.json({ error: 'failed to create customer' }, { status: 502, headers: CORS });
    }

    const created = await squareAdapter.createBooking!(token, {
      customerExternalId: customerId,
      serviceExternalId: serviceId,
      startAt,
      sellerNote: notes ? `[widget] ${notes}` : '[widget booking]',
    }, { merchantId: conn.metadata?.merchant_id });
    if (!created) {
      return NextResponse.json({ error: 'booking creation failed (slot may have been taken)' }, { status: 409, headers: CORS });
    }

    // Fire a notification so the owner sees the booking in their digest
    if (SUPABASE_URL && SUPABASE_KEY) {
      try {
        const { enqueueNotification } = await import('../../_lib/notifications');
        const whenLocal = new Date(created.startAt).toLocaleString('en-US', {
          weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
        });
        await enqueueNotification({
          tenantPhone: verified.tenant_phone,
          kind: 'agent_observation',
          severity: 'medium',
          title: `📅 New booking via widget: ${name}`,
          body: `${name}${email ? ` <${email}>` : ''}${phone ? ` ${phone}` : ''} booked ${whenLocal}.${notes ? `\nNotes: ${notes}` : ''}`,
          sourceAgent: 'Widget',
          sourceId: created.externalId,
          metadata: { booking_id: created.externalId, customer: name, email, phone },
        });
      } catch {}
    }

    // Fire outbound event to subscribed webhooks (Zapier/Make/IFTTT/custom)
    try {
      const { fireEvent } = await import('../../_lib/event-webhooks');
      void fireEvent({
        tenantPhone: verified.tenant_phone,
        eventType: 'booking_created',
        payload: {
          booking_id: created.externalId,
          customer: { name, email, phone },
          service_id: serviceId,
          start_at: created.startAt,
          end_at: created.endAt,
          notes,
          source: 'widget',
        },
      });
    } catch {}

    return NextResponse.json(
      { booking_id: created.externalId, when_iso: created.startAt },
      { headers: CORS },
    );
  } catch (err: any) {
    console.warn('[widget/book] error:', err);
    return NextResponse.json({ error: err?.message ?? 'booking failed' }, { status: 500, headers: CORS });
  }
}

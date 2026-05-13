/**
 * Widget availability API — open slots for a service over the next N days.
 *
 * GET /api/widget/availability?service=<square_service_id>&days=14
 *   Headers: X-API-Key: wk_...
 *   Returns: { slots: [{ startAt, staffExternalId? }] }
 */

import { NextResponse } from 'next/server';
import { verifyApiKey } from '../../_lib/widget-auth';
import { squareAdapter } from '../../_lib/booking-adapters/square';
import { loadActiveBookingConnections } from '../../_lib/booking-adapters/customer-sync';
import { decryptToken } from '@wisdomworks/shared';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const apiKey = request.headers.get('x-api-key') ?? url.searchParams.get('key') ?? '';
  const origin = request.headers.get('origin') ?? undefined;
  const verified = await verifyApiKey(apiKey, origin);
  if (!verified) return NextResponse.json({ error: 'invalid api key' }, { status: 401, headers: CORS });

  const serviceId = url.searchParams.get('service') ?? '';
  if (!serviceId) return NextResponse.json({ error: 'service required' }, { status: 400, headers: CORS });

  const days = Math.min(Math.max(parseInt(url.searchParams.get('days') ?? '14', 10), 1), 30);

  const conns = await loadActiveBookingConnections(verified.tenant_phone);
  const conn = conns.find((c) => c.provider === 'square');
  if (!conn) return NextResponse.json({ slots: [] }, { headers: CORS });

  try {
    const token = await decryptToken(conn.access_token);
    const from = new Date();
    const to = new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
    const slots = await squareAdapter.searchAvailability!(token, from.toISOString(), to.toISOString(), {
      merchantId: conn.metadata?.merchant_id,
      serviceExternalId: serviceId,
    });
    return NextResponse.json(
      { slots: slots.map((s) => ({ startAt: s.startAt, staffExternalId: s.staffExternalId })) },
      { headers: CORS },
    );
  } catch (err) {
    console.warn('[widget/availability] failed:', err);
    return NextResponse.json({ slots: [] }, { headers: CORS });
  }
}

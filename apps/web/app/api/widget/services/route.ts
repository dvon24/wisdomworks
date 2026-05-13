/**
 * Widget services API — lists bookable services so the booking widget
 * can render a dropdown without the owner copying service ids manually.
 *
 * GET /api/widget/services
 *   Headers: X-API-Key: wk_...
 *   Returns: { services: [{ id, name, durationMinutes, priceUsd, description }] }
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
  const apiKey = request.headers.get('x-api-key') ?? new URL(request.url).searchParams.get('key') ?? '';
  const origin = request.headers.get('origin') ?? undefined;
  const verified = await verifyApiKey(apiKey, origin);
  if (!verified) return NextResponse.json({ error: 'invalid api key' }, { status: 401, headers: CORS });

  const conns = await loadActiveBookingConnections(verified.tenant_phone);
  const conn = conns.find((c) => c.provider === 'square');
  if (!conn) return NextResponse.json({ services: [] }, { headers: CORS });

  try {
    const token = await decryptToken(conn.access_token);
    const services = await squareAdapter.listServices!(token, { merchantId: conn.metadata?.merchant_id });
    return NextResponse.json(
      {
        services: services.map((s) => ({
          id: s.externalId,
          name: s.name,
          durationMinutes: s.durationMinutes,
          priceUsd: s.priceUsd,
          description: s.description,
        })),
      },
      { headers: CORS },
    );
  } catch (err) {
    console.warn('[widget/services] failed:', err);
    return NextResponse.json({ services: [] }, { headers: CORS });
  }
}

/**
 * Booking-system sync — pulls customers from every connected booking
 * provider once a day and upserts them into client_profiles.
 *
 * Also handles single-tenant manual triggers via ?phone=… (used by the
 * OAuth callback to seed data immediately after a fresh connection).
 *
 * Schedule: vercel.json '0 5 * * *' (05:00 UTC, before insights-scan).
 */

import { NextResponse } from 'next/server';
import { loadActiveBookingConnections, syncCustomersFromConnection } from '../../_lib/booking-adapters/customer-sync';
import { squareAdapter } from '../../_lib/booking-adapters/square';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const ADAPTERS = {
  square: squareAdapter,
} as const;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  const url = new URL(request.url);
  const phoneScope = url.searchParams.get('phone'); // optional single-tenant trigger

  const connections = await loadActiveBookingConnections(phoneScope ?? undefined);
  if (connections.length === 0) {
    return NextResponse.json({ ok: true, connections: 0, message: 'no booking connections to sync' });
  }

  let totalFetched = 0;
  let totalUpserted = 0;
  let totalAppointments = 0;
  let totalVisits = 0;
  let totalConnections = 0;
  let totalFailed = 0;

  for (const conn of connections) {
    const adapter = (ADAPTERS as any)[conn.provider];
    if (!adapter) {
      console.warn(`[booking-sync] no adapter for provider ${conn.provider}`);
      continue;
    }
    totalConnections++;
    const result = await syncCustomersFromConnection(conn, adapter);
    if (result.ok) {
      totalFetched += result.fetched;
      totalUpserted += result.upserted;
      totalAppointments += result.appointmentsFetched;
      totalVisits += result.visitsRecorded;
    } else {
      totalFailed++;
    }
  }

  return NextResponse.json({
    ok: true,
    connections: totalConnections,
    customers_fetched: totalFetched,
    customers_upserted: totalUpserted,
    appointments_fetched: totalAppointments,
    visits_recorded: totalVisits,
    failed: totalFailed,
  });
}

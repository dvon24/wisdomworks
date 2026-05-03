/**
 * Proactive Agent Loop — runs every 4 hours, checks for opportunities.
 *
 * This is the BMAD Observe step running on a schedule.
 * Checks each tenant for:
 * - Unread messages that need follow-up
 * - Patterns in data that suggest an action
 * - Pending proposals awaiting response
 * - Scheduled tasks that are overdue
 *
 * In production: this triggers the full BMAD loop per tenant.
 * MVP: checks for basic follow-up opportunities.
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    // Get all active users
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      return NextResponse.json({ checked: 0, message: 'No Supabase configured' });
    }

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/whatsapp_contexts?is_owner=eq.true&select=phone_number,name,business_name,last_seen,message_count`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        },
      },
    );

    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
    }

    const users = await res.json();
    let actionsTriggered = 0;

    for (const user of users) {
      // Check if user hasn't interacted in 24+ hours — send a nudge
      const lastSeen = new Date(user.last_seen);
      const hoursSinceLastSeen = (Date.now() - lastSeen.getTime()) / (1000 * 60 * 60);

      if (hoursSinceLastSeen > 24 && hoursSinceLastSeen < 48) {
        // Don't nudge if they haven't been active in 2+ days (they might be away)
        console.log(`[proactive-loop] ${user.name} hasn't checked in for ${Math.round(hoursSinceLastSeen)}h`);
        // In production: trigger a check-in or insight delivery
        actionsTriggered++;
      }
    }

    console.log(`[proactive-loop] Checked ${users.length} users, ${actionsTriggered} actions triggered`);
    return NextResponse.json({ checked: users.length, actionsTriggered });
  } catch (error) {
    console.error('[proactive-loop] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

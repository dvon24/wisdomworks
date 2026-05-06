/**
 * Command Deck data loader.
 *
 * GET /api/dashboard?phone=+491703604562
 *
 * Returns everything the Command Deck needs to render real data:
 * - User profile (business name, type)
 * - Active OAuth connections
 * - Today's calendar events (cached from calendar-sync cron)
 * - Pending email drafts (cached from email-sift cron)
 * - Conversation history (last messages with Iris)
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const phone = url.searchParams.get('phone');
  if (!phone) return NextResponse.json({ error: 'phone required' }, { status: 400 });

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  const cleanPhone = phone.replace(/[\s\-+()]/g, '');

  try {
    // Fetch in parallel
    const [contextRes, connectionsRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${cleanPhone}&select=*`, {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
      }),
      fetch(
        `${SUPABASE_URL}/rest/v1/oauth_connections?phone_number=eq.${cleanPhone}&status=eq.active&select=provider,service,account_email,account_name,scopes,created_at`,
        {
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
          },
        },
      ),
    ]);

    const contextRows = contextRes.ok ? await contextRes.json() : [];
    const connections = connectionsRes.ok ? await connectionsRes.json() : [];
    const ctx = contextRows[0] ?? null;

    if (!ctx) {
      return NextResponse.json({
        error: 'No tenant found for that phone number',
        hint: 'Complete onboarding first',
      }, { status: 404 });
    }

    const profile = ctx.profile ?? {};
    const todaysCalendar = profile.todaysCalendar ?? [];
    const pendingEmailDrafts = profile.pendingEmailDrafts ?? [];

    // Build activity feed from real data
    const activity: Array<{ agent: string; action: string; time: string; ts: number }> = [];

    // Recent emails processed
    if (pendingEmailDrafts.length > 0) {
      activity.push({
        agent: 'Email Agent',
        action: `Drafted ${pendingEmailDrafts.length} replies awaiting your approval`,
        time: 'just now',
        ts: Date.now(),
      });
    }

    // Today's calendar fetched
    if (profile.todaysCalendarFetchedAt) {
      const fetched = new Date(profile.todaysCalendarFetchedAt);
      activity.push({
        agent: 'Calendar Agent',
        action: `Synced ${todaysCalendar.length} events for today`,
        time: timeAgo(fetched),
        ts: fetched.getTime(),
      });
    }

    // Recent OAuth connections
    for (const conn of connections.slice(0, 3)) {
      activity.push({
        agent: 'Setup',
        action: `Connected ${conn.provider} ${conn.service}`,
        time: timeAgo(new Date(conn.created_at)),
        ts: new Date(conn.created_at).getTime(),
      });
    }

    // Sort by recency
    activity.sort((a, b) => b.ts - a.ts);

    // Build agent team summary from saved AI structured data (if available)
    const team = profile.team ?? null;

    return NextResponse.json({
      user: {
        phone: cleanPhone,
        name: ctx.name,
        businessName: ctx.business_name,
        businessType: ctx.business_type,
        isOwner: ctx.is_owner,
      },
      connections: connections.map((c: any) => ({
        provider: c.provider,
        service: c.service,
        accountEmail: c.account_email,
        accountName: c.account_name,
      })),
      todaysCalendar,
      pendingEmailDrafts: pendingEmailDrafts.map((d: any) => ({
        id: d.id,
        from: d.from,
        subject: d.subject,
        classification: d.classification,
      })),
      activity: activity.slice(0, 20),
      team,
      messageCount: ctx.message_count ?? 0,
      lastSeen: ctx.last_seen,
    });
  } catch (err) {
    console.error('[dashboard] Error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

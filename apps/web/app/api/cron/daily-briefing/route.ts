/**
 * Daily Briefing Cron — sends morning briefing to all active users via WhatsApp.
 *
 * Runs at 7 AM daily (configured in vercel.json).
 * For each user with a linked phone number:
 * 1. Gathers recent activity, pending items, and insights
 * 2. Generates a concise briefing via Claude
 * 3. Sends it via WhatsApp
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const GRAPH_API = 'https://graph.facebook.com/v25.0';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function GET(request: Request) {
  // Verify cron secret (Vercel sends this automatically)
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    // Get all users with linked phone numbers who are owners
    const users = await getActiveUsers();
    if (!users.length) {
      console.log('[daily-briefing] No active users to brief');
      return NextResponse.json({ briefed: 0 });
    }

    let briefed = 0;

    // Drain the notification queue and bundle into the morning briefing so
    // the user sees ONE structured message (overnight narrative + queued items)
    const { loadPending, markDelivered, synthesizeStructuredDigest } = await import('../../_lib/notifications');

    for (const user of users) {
      try {
        const briefing = await generateBriefing(user);

        // Bundle queued items into the morning briefing
        const queued = await loadPending(user.phone_number);
        let combined = briefing;
        let deliveredIds: string[] = [];
        if (queued.length > 0) {
          const synth = await synthesizeStructuredDigest({
            orchestratorName: 'Iris',
            notifications: queued,
            recentAgentRuns: [],
          });
          if (synth.hasSignal) {
            combined = `${briefing}\n\n— — —\n\n${synth.message}`;
            deliveredIds = synth.deliveredIds;
          }
        }

        await sendWhatsApp(user.phone_number, combined);
        if (deliveredIds.length > 0) {
          await markDelivered(deliveredIds);
        }
        briefed++;
        console.log(`[daily-briefing] Sent to ${user.name} (${user.phone_number}) with ${queued.length} queued items`);
      } catch (err) {
        console.error(`[daily-briefing] Failed for ${user.phone_number}:`, err);
      }
    }

    console.log(`[daily-briefing] Briefed ${briefed}/${users.length} users`);
    return NextResponse.json({ briefed, total: users.length });
  } catch (error) {
    console.error('[daily-briefing] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

async function getActiveUsers(): Promise<any[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/whatsapp_contexts?is_owner=eq.true&select=*`,
    {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      },
    },
  );

  if (!res.ok) return [];
  return res.json();
}

async function generateBriefing(user: any): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const now = new Date();
  const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long' });
  const dateStr = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  if (!apiKey) {
    return `Good morning ${user.name}! Your AI team is running smoothly. Have a great day!`;
  }

  // Story 2.6 — gather real briefing context from the runtime tables.
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const cleanPhone = user.phone_number;

  let recentRuns: any[] = [];
  let uncertainEmails: any[] = [];
  let pendingDrafts: any[] = [];
  let upcomingCalendar: any[] = [];
  let orchestratorName = 'Iris';

  try {
    const [runsRes, ctxRes, cfgRes] = await Promise.all([
      fetch(
        `${SUPABASE_URL}/rest/v1/agent_runs?tenant_phone=eq.${cleanPhone}&started_at=gte.${since}&outcome=neq.no_op&order=started_at.desc&limit=20&select=outcome,output_summary,delegated_to_lane,metadata,started_at`,
        { headers: { apikey: SUPABASE_KEY!, Authorization: `Bearer ${SUPABASE_KEY}` } },
      ),
      fetch(
        `${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${cleanPhone}&select=profile`,
        { headers: { apikey: SUPABASE_KEY!, Authorization: `Bearer ${SUPABASE_KEY}` } },
      ),
      fetch(
        `${SUPABASE_URL}/rest/v1/agent_configs?tenant_phone=eq.${cleanPhone}&select=agent_name,config&order=created_at.asc&limit=1`,
        { headers: { apikey: SUPABASE_KEY!, Authorization: `Bearer ${SUPABASE_KEY}` } },
      ),
    ]);
    recentRuns = runsRes.ok ? await runsRes.json() : [];
    const ctxRows = ctxRes.ok ? await ctxRes.json() : [];
    const profile = ctxRows[0]?.profile ?? {};
    pendingDrafts = profile.pendingEmailDrafts ?? [];
    uncertainEmails = profile.uncertainEmails ?? [];
    upcomingCalendar = profile.todaysCalendar ?? [];
    const cfgRows = cfgRes.ok ? await cfgRes.json() : [];
    if (cfgRows[0]?.agent_name) orchestratorName = cfgRows[0].agent_name;
  } catch (err) {
    console.warn('[daily-briefing] context fetch failed:', err);
  }

  // Build the UNIFIED schedule for today: native managed-calendar events +
  // connected calendar (from profile) + upcoming bookings. Then flag conflicts.
  let conflictsCount = 0;
  let unifiedScheduleLines = '  (nothing scheduled)';
  let calendarNudge = '';
  try {
    const { buildUnifiedSchedule, detectConflicts } = await import('../../_lib/managed-calendar');
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();

    let upcomingBookings: any[] = [];
    if (SUPABASE_URL && SUPABASE_KEY) {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/client_visits?tenant_phone=eq.${cleanPhone}&occurred_at=gte.${encodeURIComponent(startOfDay)}&occurred_at=lt.${encodeURIComponent(endOfDay)}&select=summary,occurred_at`,
        { headers: { apikey: SUPABASE_KEY!, Authorization: `Bearer ${SUPABASE_KEY}` } },
      );
      upcomingBookings = r.ok ? await r.json() : [];
    }

    const unified = await buildUnifiedSchedule({
      tenantPhone: cleanPhone,
      fromIso: startOfDay,
      toIso: endOfDay,
      connectedCalendarEvents: upcomingCalendar.map((e: any) => ({
        start: e.start, end: e.end, title: e.title, location: e.location,
      })),
      upcomingBookings,
    });

    if (unified.length > 0) {
      unifiedScheduleLines = unified.slice(0, 8).map((e) => {
        const sourceMark = e.source === 'native' ? '📝' : e.source === 'connected_calendar' ? '📅' : '👥';
        const t = new Date(e.startAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        return `  ${sourceMark} ${t} ${e.title}`;
      }).join('\n');
    }
    const conflicts = detectConflicts(unified);
    conflictsCount = conflicts.length;
  } catch (err) {
    console.warn('[daily-briefing] schedule unify failed:', err);
  }

  // If no calendar is connected AND no native events exist, nudge once
  const hasConnectedCalendar = upcomingCalendar.length > 0; // approximation
  if (!hasConnectedCalendar) {
    calendarNudge = '\n\nFYI: no external calendar connected. You can either tap Connections in the deck to link Google/Apple, OR just tell me what you have on (e.g. "I have soccer with Liam Tuesday at 4") and I\'ll track it natively.';
  }

  const runsSummary = recentRuns.slice(0, 10).map((r: any) =>
    `  - [${r.outcome}${r.delegated_to_lane ? ` → ${r.delegated_to_lane}` : ''}] ${(r.output_summary || '').slice(0, 120)}`,
  ).join('\n') || '  (quiet overnight)';

  const calendarSummary = unifiedScheduleLines;
  const conflictsLine = conflictsCount > 0
    ? `\n⚠ ${conflictsCount} schedule conflict${conflictsCount === 1 ? '' : 's'} detected — owner should review.`
    : '';

  const userMsg = `Today is ${dayOfWeek}, ${dateStr}.

Owner: ${user.name}
Business: ${user.business_name || 'their business'} (${user.business_type || 'business'})

Overnight team activity (last 24h):
${runsSummary}

Today's schedule (📝=native 📅=connected calendar 👥=customer booking):
${calendarSummary}${conflictsLine}${calendarNudge}

Pending email drafts awaiting review: ${pendingDrafts.length}
Uncertain email classifications to clarify: ${uncertainEmails.length}

Generate the morning briefing. If there are schedule conflicts, lead with them — owners need to see overlaps before they get caught.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 350,
        system: [{
          type: 'text',
          text: `You are ${orchestratorName}, the user's personal orchestrator. You're sending the morning briefing via WhatsApp.

Format:
- Short greeting with the day + date
- 2-4 line summary of overnight team activity (lead with what NEEDS attention, defer routine)
- Today's schedule headline (skip if nothing scheduled)
- Pending items the user must review (drafts, uncertain emails)
- One-line close inviting them to engage

Rules:
- Under 220 words
- Use line breaks, no markdown
- Mention agents by name when crediting work
- If the team had a quiet night and nothing needs attention, say so plainly — don't pad
- Be warm but not sycophantic. No 'have a wonderful day!'`,
          cache_control: { type: 'ephemeral' },
        }],
        messages: [{ role: 'user', content: userMsg }],
      }),
    });
    if (!response.ok) throw new Error(`Anthropic ${response.status}`);
    const data = await response.json();
    return data.content?.[0]?.text ?? `Good morning ${user.name}! Quiet overnight. Anything for today?`;
  } catch (err) {
    console.error('[daily-briefing] generate failed:', err);
    return `Good morning ${user.name}!\n\n${dayOfWeek}, ${dateStr}\n\nQuiet overnight. ${pendingDrafts.length > 0 ? `${pendingDrafts.length} draft${pendingDrafts.length > 1 ? 's' : ''} awaiting review.` : ''} ${upcomingCalendar.length > 0 ? `${upcomingCalendar.length} event${upcomingCalendar.length > 1 ? 's' : ''} on the calendar.` : ''}`.trim();
  }
}

async function sendWhatsApp(to: string, message: string): Promise<void> {
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneId || !accessToken) return;

  // Honor DND — briefings are proactive, so they wait until the user is back
  const { isMuted } = await import('../../_lib/mute-state');
  const mute = await isMuted(to);
  if (mute.muted) {
    console.log(`[daily-briefing] suppressed for ${to} (muted${mute.reason ? `: ${mute.reason}` : ''})`);
    return;
  }

  await fetch(`${GRAPH_API}/${phoneId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: message },
    }),
  });
}

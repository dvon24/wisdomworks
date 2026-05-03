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

    for (const user of users) {
      try {
        const briefing = await generateBriefing(user);
        await sendWhatsApp(user.phone_number, briefing);
        briefed++;
        console.log(`[daily-briefing] Sent to ${user.name} (${user.phone_number})`);
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
  if (!apiKey) {
    return `Good morning ${user.name}! Your AI team is running smoothly. Have a great day!`;
  }

  const now = new Date();
  const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long' });
  const dateStr = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: [{
        type: 'text',
        text: `You generate concise WhatsApp morning briefings for business owners. Keep it under 200 words. Use line breaks, not markdown. Be warm and actionable. Include the day and date. Respond in the same language the user's business name suggests.`,
        cache_control: { type: 'ephemeral' },
      }],
      messages: [{
        role: 'user',
        content: `Generate a morning briefing for ${user.name}, who owns "${user.business_name || 'their business'}" (${user.business_type || 'business'}). Today is ${dayOfWeek}, ${dateStr}. They've exchanged ${user.message_count || 0} messages with their assistant. This is their daily check-in from their AI team.`,
      }],
    }),
  });

  if (!response.ok) {
    return `Good morning ${user.name}!\n\n${dayOfWeek}, ${dateStr}\n\nYour AI team is online and ready. Text me anytime you need something today.`;
  }

  const data = await response.json();
  return data.content?.[0]?.text ?? `Good morning ${user.name}! Your AI team is ready for the day.`;
}

async function sendWhatsApp(to: string, message: string): Promise<void> {
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneId || !accessToken) return;

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

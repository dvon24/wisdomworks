/**
 * Analyze Website API — fetch and analyze a customer's website.
 *
 * POST /api/analyze-website
 * { url, phoneNumber }
 *
 * Stores the snapshot in whatsapp_contexts.profile.website so the agent
 * can reference it when answering questions or proposing improvements.
 */

import { analyzeWebsite } from '@wisdomworks/shared';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(request: Request) {
  try {
    const { url, phoneNumber } = await request.json();
    if (!url || typeof url !== 'string') {
      return Response.json({ error: 'URL required' }, { status: 400 });
    }

    const result = await analyzeWebsite(url);
    if (!result.success || !result.data) {
      return Response.json({ error: result.error ?? 'Analysis failed' }, { status: 400 });
    }

    // Store in whatsapp_contexts if phone is provided
    if (phoneNumber && SUPABASE_URL && SUPABASE_KEY) {
      const cleanPhone = phoneNumber.replace(/[\s\-\+\(\)]/g, '');
      const fetchRes = await fetch(
        `${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${cleanPhone}`,
        {
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
          },
        },
      );
      if (fetchRes.ok) {
        const rows = await fetchRes.json();
        if (rows.length > 0) {
          const profile = rows[0].profile ?? { preferences: {}, activeTopics: [] };
          profile.website = result.data;
          await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${cleanPhone}`, {
            method: 'PATCH',
            headers: {
              apikey: SUPABASE_KEY,
              Authorization: `Bearer ${SUPABASE_KEY}`,
              'Content-Type': 'application/json',
              Prefer: 'return=minimal',
            },
            body: JSON.stringify({ profile }),
          });
        }
      }
    }

    return Response.json({ success: true, snapshot: result.data });
  } catch (err) {
    console.error('[analyze-website] Error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

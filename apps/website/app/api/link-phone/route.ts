/**
 * Link Phone Number — connects a user's WhatsApp to their tenant.
 *
 * POST /api/link-phone
 * { phoneNumber, businessName, businessType }
 *
 * After payment, the user enters their phone number in ConnectTools.
 * This creates/updates the whatsapp_contexts row so incoming WhatsApp
 * messages are linked to their business context.
 */

export const dynamic = 'force-dynamic';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(request: Request) {
  try {
    const { phoneNumber, businessName, businessType } = await request.json();

    if (!phoneNumber || phoneNumber.length < 8) {
      return Response.json({ error: 'Invalid phone number' }, { status: 400 });
    }

    // Clean phone number — remove +, spaces, dashes
    const cleanPhone = phoneNumber.replace(/[\s\-\+\(\)]/g, '');

    if (!SUPABASE_URL || !SUPABASE_KEY) {
      // Dev mode — just acknowledge
      console.log(`[link-phone] Linked ${cleanPhone} to ${businessName} (no Supabase)`);
      return Response.json({ success: true, phoneNumber: cleanPhone });
    }

    // Upsert into whatsapp_contexts
    const res = await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_contexts`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify({
        phone_number: cleanPhone,
        name: businessName,
        business_name: businessName,
        business_type: businessType,
        is_owner: true,
        conversation_history: [],
        profile: { preferences: {}, activeTopics: [] },
        first_seen: new Date().toISOString(),
        last_seen: new Date().toISOString(),
        message_count: 0,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      console.error('[link-phone] Supabase error:', err);
      return Response.json({ error: 'Failed to link phone' }, { status: 500 });
    }

    console.log(`[link-phone] Linked ${cleanPhone} → ${businessName} (${businessType})`);
    return Response.json({ success: true, phoneNumber: cleanPhone });
  } catch (error) {
    console.error('[link-phone] Error:', error);
    return Response.json({ error: String(error) }, { status: 500 });
  }
}

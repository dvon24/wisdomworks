/**
 * Deploy Complete — fires when a customer finishes onboarding.
 *
 * 1. Sends welcome WhatsApp message from their personal assistant
 * 2. Returns dashboard URL
 *
 * POST /api/deploy-complete
 * { phoneNumber, businessName, businessType, agentCount, agents }
 */

export const dynamic = 'force-dynamic';

const GRAPH_API = 'https://graph.facebook.com/v25.0';

export async function POST(request: Request) {
  try {
    const { phoneNumber, businessName, businessType, agentCount, agents } = await request.json();

    if (!phoneNumber) {
      return Response.json({ error: 'No phone number' }, { status: 400 });
    }

    const cleanPhone = phoneNumber.replace(/[\s\-\+\(\)]/g, '');
    const phoneId = process.env.WHATSAPP_PHONE_ID;
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

    if (!phoneId || !accessToken) {
      console.warn('[deploy-complete] WhatsApp not configured');
      return Response.json({ success: true, welcomeSent: false });
    }

    // Build personalized welcome message
    const assistantName = agents?.[0]?.name ?? 'Your AI Assistant';
    const agentList = (agents ?? [])
      .slice(0, 5)
      .map((a: any) => `- ${a.name}: ${a.role}`)
      .join('\n');

    const welcome = [
      `Hi! I'm ${assistantName}, your personal AI assistant from WisdomWorks.`,
      ``,
      `Your AI team of ${agentCount ?? 'several'} agents is now live and working for ${businessName ?? 'your business'}.`,
      ``,
      `Here's your team:`,
      agentList || '- Your personal assistant (that\'s me!)',
      ``,
      `I'm available 24/7. Here's what I can do right now:`,
      `- Answer questions about your business`,
      `- Manage your schedule and appointments`,
      `- Draft emails and messages for your approval`,
      `- Send you a daily briefing every morning`,
      `- Find improvements and build solutions for you`,
      ``,
      `Try texting me something like:`,
      `"What's on my schedule today?"`,
      `"Draft a follow-up email for my last client"`,
      `"How can we get more bookings?"`,
      ``,
      `I'm here whenever you need me.`,
    ].join('\n');

    // Send welcome message via WhatsApp
    const sendResult = await fetch(`${GRAPH_API}/${phoneId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: cleanPhone,
        type: 'text',
        text: { body: welcome },
      }),
    });

    const sendData = await sendResult.json();
    const welcomeSent = sendResult.ok;

    if (!welcomeSent) {
      console.error('[deploy-complete] Welcome message failed:', sendData);
    } else {
      console.log(`[deploy-complete] Welcome sent to ${cleanPhone} for ${businessName}`);
    }

    return Response.json({
      success: true,
      welcomeSent,
      dashboardUrl: '/dashboard',
    });
  } catch (error) {
    console.error('[deploy-complete] Error:', error);
    return Response.json({ error: String(error) }, { status: 500 });
  }
}

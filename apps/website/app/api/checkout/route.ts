/**
 * Stripe Checkout — creates a payment session for the customer.
 *
 * POST /api/checkout
 * { monthlyPrice, businessName, agentCount, currency }
 *
 * Returns: { url } — redirect the customer to this Stripe Checkout URL.
 * After payment, Stripe redirects back to /?paid=true
 */

import Stripe from 'stripe';

export const dynamic = 'force-dynamic';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-04-22.dahlia',
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      monthlyPrice,
      businessName,
      agentCount,
      currency = 'usd',
    } = body as {
      monthlyPrice: number;
      businessName: string;
      agentCount: number;
      currency: string;
    };

    if (!monthlyPrice || monthlyPrice < 1) {
      return Response.json({ error: 'Invalid price' }, { status: 400 });
    }

    // Create a Stripe Checkout session with a dynamic price
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: currency.toLowerCase(),
            unit_amount: Math.round(monthlyPrice * 100), // Stripe uses cents
            recurring: { interval: 'month' },
            product_data: {
              name: `WisdomWorks AI Team — ${agentCount} Agents`,
              description: `${businessName} — ${agentCount} AI agents managing your business 24/7`,
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        businessName,
        agentCount: String(agentCount),
        monthlyPrice: String(monthlyPrice),
      },
      success_url: `${getBaseUrl(request)}?paid=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${getBaseUrl(request)}?cancelled=true`,
    });

    return Response.json({ url: session.url });
  } catch (error) {
    console.error('[checkout] Error:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Checkout failed' },
      { status: 500 },
    );
  }
}

function getBaseUrl(request: Request): string {
  const host = request.headers.get('host') ?? 'localhost:3001';
  const proto = host.includes('localhost') ? 'http' : 'https';
  return `${proto}://${host}`;
}

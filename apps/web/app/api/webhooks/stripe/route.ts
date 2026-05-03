/**
 * Stripe Webhook — handles payment events.
 *
 * Events:
 * - checkout.session.completed → payment successful, provision tenant
 * - invoice.paid → subscription renewed
 * - customer.subscription.deleted → subscription cancelled
 */

import Stripe from 'stripe';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-04-30.basil',
});

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const sig = request.headers.get('stripe-signature');

    let event: Stripe.Event;

    // Verify webhook signature if secret is configured
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (webhookSecret && sig) {
      try {
        event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
      } catch (err) {
        console.error('[stripe-webhook] Signature verification failed:', err);
        return new Response('Invalid signature', { status: 400 });
      }
    } else {
      // Dev mode — accept without verification
      event = JSON.parse(rawBody);
    }

    console.log(`[stripe-webhook] Event: ${event.type}`);

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const businessName = session.metadata?.businessName ?? 'Unknown';
        const agentCount = session.metadata?.agentCount ?? '0';
        const monthlyPrice = session.metadata?.monthlyPrice ?? '0';
        const customerId = session.customer as string;
        const subscriptionId = session.subscription as string;

        console.log(`[stripe-webhook] Payment completed: ${businessName}, $${monthlyPrice}/mo, ${agentCount} agents`);

        // Create billing record in Supabase
        if (SUPABASE_URL && SUPABASE_KEY) {
          await fetch(`${SUPABASE_URL}/rest/v1/billing_records`, {
            method: 'POST',
            headers: {
              'apikey': SUPABASE_KEY,
              'Authorization': `Bearer ${SUPABASE_KEY}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal',
            },
            body: JSON.stringify({
              type: 'subscription',
              amount: monthlyPrice,
              currency: (session.currency ?? 'usd').toLowerCase(),
              status: 'completed',
              stripe_payment_id: session.payment_intent ?? customerId,
              stripe_subscription_id: subscriptionId,
              metadata: {
                businessName,
                agentCount,
                customerEmail: session.customer_details?.email,
              },
            }),
          });
        }

        break;
      }

      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        console.log(`[stripe-webhook] Invoice paid: ${invoice.id}, $${(invoice.amount_paid / 100).toFixed(2)}`);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        console.log(`[stripe-webhook] Subscription cancelled: ${subscription.id}`);
        break;
      }

      default:
        console.log(`[stripe-webhook] Unhandled event: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('[stripe-webhook] Error:', error);
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 });
  }
}

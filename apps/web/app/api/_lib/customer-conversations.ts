/**
 * Customer-conversations data layer — the messaging-channel equivalent of
 * widget_conversations, for the SMB customer-facing framework. A customer of
 * tenant X texts the business's dedicated number (SMS or WhatsApp) and is
 * recognised as a CUSTOMER of that tenant, never the owner.
 *
 * Channel-agnostic: every function takes a `channel` so the same brain + flow
 * run on 'sms' (Twilio, instant) or 'whatsapp' (per-tenant WABA, Meta-reviewed)
 * — the choice is per-tenant config, decided at pilot time.
 *
 * Keyed by (tenant_phone, customer_phone, channel). Reuses client_profiles
 * (source:'inferred') so a customer's history threads into the owner's CRM.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const h = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

export type CustomerChannel = 'sms' | 'whatsapp';

export interface CustomerMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
}

export interface CustomerConversation {
  id: string;
  tenant_phone: string;
  customer_phone: string;
  channel: CustomerChannel;
  client_profile_id: string | null;
  messages: CustomerMessage[];
  status: 'open' | 'closed' | 'blocked';
  msg_count_today: number;
  msg_count_day: string | null; // YYYY-MM-DD
}

/** Per-(tenant,customer)/day inbound cap — bounds a runaway/abusive sender and
 *  the per-customer LLM spend. Tunable via env without a deploy. */
function dailyCustomerCap(): number {
  const env = Number(process.env.CUSTOMER_DAILY_MSG_CAP);
  return Number.isFinite(env) && env > 0 ? env : 30;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Load the open conversation for (tenant, customer, channel) or create one.
 * Also auto-links/creates a client_profiles row (source:'inferred') so the
 * customer is a first-class contact in the owner's CRM from message one.
 */
export async function loadOrCreateConversation(input: {
  tenantPhone: string;
  customerPhone: string;
  channel: CustomerChannel;
}): Promise<CustomerConversation | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const tenant = input.tenantPhone.replace(/[\s\-()]/g, '');
  const customer = input.customerPhone.replace(/[\s\-()]/g, '');
  try {
    const findRes = await fetch(
      `${SUPABASE_URL}/rest/v1/customer_conversations?tenant_phone=eq.${encodeURIComponent(tenant)}&customer_phone=eq.${encodeURIComponent(customer)}&channel=eq.${input.channel}&status=eq.open&order=last_message_at.desc&limit=1&select=*`,
      { headers: h() },
    );
    const existing = findRes.ok ? await findRes.json() : [];
    if (existing[0]) return existing[0] as CustomerConversation;

    // Link/create the client profile before opening the thread.
    const profileId = await findOrCreateClientProfile({ tenantPhone: tenant, customerPhone: customer });

    const createRes = await fetch(`${SUPABASE_URL}/rest/v1/customer_conversations`, {
      method: 'POST',
      headers: { ...h(), Prefer: 'return=representation' },
      body: JSON.stringify({
        tenant_phone: tenant,
        customer_phone: customer,
        channel: input.channel,
        client_profile_id: profileId,
        messages: [],
        status: 'open',
      }),
    });
    if (!createRes.ok) return null;
    const created = await createRes.json();
    return (created[0] ?? null) as CustomerConversation | null;
  } catch (err) {
    console.warn('[customer-conv] loadOrCreate failed:', err);
    return null;
  }
}

/** True if this customer has already hit today's inbound cap (accounting for
 *  date rollover — a new day resets the count). */
export function isOverDailyCustomerCap(conv: CustomerConversation): boolean {
  const sameDay = conv.msg_count_day === today();
  const count = sameDay ? conv.msg_count_today : 0;
  return count >= dailyCustomerCap();
}

/**
 * Append the latest user+assistant turn and bump the per-day counter (resetting
 * it when the date rolls over). last_message_at drives the "active thread"
 * lookup.
 */
export async function persistTurn(
  conv: CustomerConversation,
  messages: CustomerMessage[],
  opts: { customerName?: string; customerEmail?: string } = {},
): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  const sameDay = conv.msg_count_day === today();
  const nextCount = (sameDay ? conv.msg_count_today : 0) + 1;
  const patch: Record<string, unknown> = {
    messages,
    message_count: messages.length,
    msg_count_today: nextCount,
    msg_count_day: today(),
    last_message_at: new Date().toISOString(),
  };
  if (opts.customerName) patch.customer_name = opts.customerName;
  if (opts.customerEmail) patch.customer_email = opts.customerEmail;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/customer_conversations?id=eq.${conv.id}`, {
      method: 'PATCH',
      headers: { ...h(), Prefer: 'return=minimal' },
      body: JSON.stringify(patch),
    });
  } catch {
    // non-fatal
  }
}

/**
 * Find a client_profiles row by phone for this tenant, or create an inferred
 * one. Returns the profile id (or null on failure — the conversation still
 * works, it just isn't CRM-linked).
 */
export async function findOrCreateClientProfile(input: {
  tenantPhone: string;
  customerPhone: string;
  displayName?: string;
}): Promise<string | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const tenant = input.tenantPhone.replace(/[\s\-()]/g, '');
  const customer = input.customerPhone.replace(/[\s\-()]/g, '');
  try {
    const findRes = await fetch(
      `${SUPABASE_URL}/rest/v1/client_profiles?tenant_phone=eq.${encodeURIComponent(tenant)}&phone=eq.${encodeURIComponent(customer)}&limit=1&select=id`,
      { headers: h() },
    );
    const existing = findRes.ok ? await findRes.json() : [];
    if (existing[0]?.id) return existing[0].id;

    const createRes = await fetch(`${SUPABASE_URL}/rest/v1/client_profiles`, {
      method: 'POST',
      headers: { ...h(), Prefer: 'return=representation' },
      body: JSON.stringify({
        tenant_phone: tenant,
        display_name: input.displayName ?? customer,
        phone: customer,
        source: 'inferred',
      }),
    });
    if (!createRes.ok) return null;
    const created = await createRes.json();
    return created[0]?.id ?? null;
  } catch (err) {
    console.warn('[customer-conv] findOrCreateClientProfile failed:', err);
    return null;
  }
}

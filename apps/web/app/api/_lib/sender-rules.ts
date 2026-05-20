/**
 * Sender rules — owner-defined deterministic classification.
 *
 * Lets the owner tell Iris "block Change.org" or "trust AT&T as personal"
 * once, then every future email from that sender skips the LLM and gets
 * classified by the rule. Two wins:
 *   1. Drops the 238 low-confidence/7-day count to near zero for recurring
 *      ambiguous senders.
 *   2. Drops LLM cost — no token spend for rule-matched mail.
 *
 * Match strategy: exact full-email match wins, then domain fallback.
 *   • Pattern "noreply@change.org" matches only that exact address.
 *   • Pattern "change.org" matches anything @change.org.
 *
 * Action mapping (kept deliberately small for the first ship):
 *   • block    → privacyClass=business, classification=spam, no draft
 *   • personal → privacyClass=personal, classification=informational, no draft (privacy boundary holds)
 *   • allow    → privacyClass=business, classification=informational, no auto-draft (surface normally)
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

export type SenderRuleAction = 'block' | 'personal' | 'allow';

export interface SenderRule {
  id: string;
  tenant_phone: string;
  sender_pattern: string;
  action: SenderRuleAction;
  notes?: string | null;
  created_at: string;
}

/** Pull every rule for a tenant. Returns [] if Supabase isn't configured or on error. */
export async function getSenderRules(tenantPhone: string): Promise<SenderRule[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/sender_rules?tenant_phone=eq.${cleanPhone}&select=*`,
      { headers: headers() },
    );
    if (!res.ok) return [];
    return (await res.json()) as SenderRule[];
  } catch {
    return [];
  }
}

/**
 * Extract the bare email address ("alice@example.com") from a From header
 * like "Alice <alice@example.com>" or just "alice@example.com". Lowercased.
 */
function extractEmail(from: string | undefined | null): string {
  if (!from) return '';
  const angleMatch = from.match(/<([^>]+)>/);
  const candidate = angleMatch?.[1] ?? from;
  return candidate.trim().toLowerCase();
}

/** Find the highest-specificity matching rule for an email's From header, or null. */
export function matchSenderRule(from: string, rules: SenderRule[]): SenderRule | null {
  if (rules.length === 0) return null;
  const email = extractEmail(from);
  if (!email) return null;
  const domain = email.includes('@') ? email.split('@')[1]! : email;

  let exact: SenderRule | null = null;
  let byDomain: SenderRule | null = null;
  for (const r of rules) {
    const p = r.sender_pattern.toLowerCase().trim();
    if (!p) continue;
    if (p === email) {
      exact = r;
      break; // can't beat exact-email
    }
    if (p === domain) byDomain = r;
  }
  return exact ?? byDomain;
}

export interface RuleClassification {
  privacyClass: 'business' | 'personal' | 'uncertain';
  privacyConfidence: number;
  classification: 'urgent' | 'needs_response' | 'informational' | 'spam';
  draftReply: null;
  matchedRule: SenderRule;
}

/** Translate a matched rule into a classification verdict. */
export function classifyByRule(rule: SenderRule): RuleClassification {
  const map: Record<SenderRuleAction, Omit<RuleClassification, 'matchedRule'>> = {
    block: {
      privacyClass: 'business',
      privacyConfidence: 1.0,
      classification: 'spam',
      draftReply: null,
    },
    personal: {
      privacyClass: 'personal',
      privacyConfidence: 1.0,
      classification: 'informational',
      draftReply: null,
    },
    allow: {
      privacyClass: 'business',
      privacyConfidence: 1.0,
      classification: 'informational',
      draftReply: null,
    },
  };
  return { ...map[rule.action], matchedRule: rule };
}

/**
 * Upsert a sender rule. Idempotent — calling with the same (tenant, pattern)
 * updates the existing row's action instead of erroring.
 */
export async function setSenderRule(args: {
  tenantPhone: string;
  senderPattern: string;
  action: SenderRuleAction;
  notes?: string;
}): Promise<{ ok: boolean; rule?: SenderRule; reason?: string }> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { ok: false, reason: 'supabase_not_configured' };
  const cleanPhone = args.tenantPhone.replace(/[\s\-+()]/g, '');
  const pattern = args.senderPattern.trim().toLowerCase();
  if (!pattern) return { ok: false, reason: 'empty_pattern' };
  if (!['block', 'personal', 'allow'].includes(args.action)) {
    return { ok: false, reason: 'invalid_action' };
  }

  try {
    // Upsert via on_conflict on the (tenant_phone, sender_pattern) unique key.
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/sender_rules?on_conflict=tenant_phone,sender_pattern`,
      {
        method: 'POST',
        headers: {
          ...headers(),
          Prefer: 'resolution=merge-duplicates,return=representation',
        },
        body: JSON.stringify({
          tenant_phone: cleanPhone,
          sender_pattern: pattern,
          action: args.action,
          notes: args.notes ?? null,
          updated_at: new Date().toISOString(),
        }),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, reason: `${res.status}: ${text.slice(0, 200)}` };
    }
    const rows = await res.json();
    return { ok: true, rule: rows[0] };
  } catch (err: any) {
    return { ok: false, reason: err?.message ?? String(err) };
  }
}

/** Remove a sender rule by pattern. Returns whether anything was removed. */
export async function removeSenderRule(args: {
  tenantPhone: string;
  senderPattern: string;
}): Promise<{ ok: boolean; removed: boolean; reason?: string }> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { ok: false, removed: false, reason: 'supabase_not_configured' };
  const cleanPhone = args.tenantPhone.replace(/[\s\-+()]/g, '');
  const pattern = args.senderPattern.trim().toLowerCase();
  if (!pattern) return { ok: false, removed: false, reason: 'empty_pattern' };
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/sender_rules?tenant_phone=eq.${cleanPhone}&sender_pattern=eq.${encodeURIComponent(pattern)}`,
      {
        method: 'DELETE',
        headers: { ...headers(), Prefer: 'return=representation' },
      },
    );
    if (!res.ok) return { ok: false, removed: false, reason: `${res.status}` };
    const rows = await res.json();
    return { ok: true, removed: Array.isArray(rows) && rows.length > 0 };
  } catch (err: any) {
    return { ok: false, removed: false, reason: err?.message ?? String(err) };
  }
}

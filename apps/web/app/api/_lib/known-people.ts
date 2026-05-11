/**
 * Known people registry.
 *
 * Owner-defined + auto-mined people the assistant should know about
 * (attorney, accountant, partner, key clients). Injected into every
 * agent's tick prompt so "Ron" reliably refers to the attorney and
 * not the Au7o Director agent.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

export interface KnownPerson {
  id: string;
  display_name: string;
  role: string | null;
  notes: string | null;
  email: string | null;
  source: string;
  confidence: number;
}

export async function definePerson(args: {
  tenantPhone: string;
  displayName: string;
  role?: string;
  notes?: string;
  email?: string;
  source?: 'owner_defined' | 'auto:email_signature' | 'auto:agent_extraction';
  confidence?: number;
}): Promise<string | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/upsert_known_person`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        p_tenant_phone: args.tenantPhone,
        p_display_name: args.displayName,
        p_role: args.role ?? null,
        p_notes: args.notes?.slice(0, 400) ?? null,
        p_email: args.email ?? null,
        p_source: args.source ?? 'owner_defined',
        p_confidence: args.confidence ?? (args.source === 'owner_defined' ? 1.0 : 0.6),
      }),
    });
    if (!res.ok) return null;
    return (await res.text()).replace(/"/g, '').trim() || null;
  } catch (err) {
    console.warn('[known-people] definePerson failed:', err);
    return null;
  }
}

export async function listKnownPeople(tenantPhone: string): Promise<KnownPerson[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/known_people?tenant_phone=eq.${tenantPhone}&order=confidence.desc,display_name.asc&select=id,display_name,role,notes,email,source,confidence`,
      { headers: headers() },
    );
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export async function forgetPerson(personId: string): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/known_people?id=eq.${personId}`, {
      method: 'DELETE',
      headers: { ...headers(), Prefer: 'return=minimal' },
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Render the registry as a compact prompt block. Empty string when there
 * are no entries (don't waste tokens on "you know nobody yet").
 */
export function renderKnownPeopleForPrompt(people: KnownPerson[]): string {
  if (people.length === 0) return '';
  const lines = people.slice(0, 30).map((p) => {
    const role = p.role ? ` (${p.role})` : '';
    const email = p.email ? ` <${p.email}>` : '';
    const notes = p.notes ? ` — ${p.notes.slice(0, 80)}` : '';
    return `  - ${p.display_name}${role}${email}${notes}`;
  });
  return [
    '',
    'PEOPLE YOU KNOW IN THE OWNER\'S NETWORK',
    '(Real humans the owner has told you about or you mined from email signatures. When a name comes up, check this list FIRST before assuming it refers to a teammate.)',
    ...lines,
  ].join('\n');
}

/**
 * Mine a batch of received emails for person info via signatures.
 * Cheap one-shot Anthropic pass that extracts {name, role, company,
 * email} tuples. Returns 0+ entries. Failures are silent (returns []).
 */
export async function extractPeopleFromEmails(
  emails: { from: string; fromName?: string; subject: string; body?: string }[],
): Promise<{ display_name: string; role?: string; email: string; notes?: string }[]> {
  if (!ANTHROPIC_API_KEY || emails.length === 0) return [];

  const sample = emails.slice(0, 15).map((e, i) =>
    `${i + 1}. From: ${e.fromName ? `${e.fromName} <${e.from}>` : e.from}\n   Subject: ${e.subject}\n   Body (last 400 chars to catch signatures): ${(e.body || '').slice(-400)}`,
  ).join('\n\n');

  const system = `Extract structured person info from email signatures and headers. Look at the From line (name + email) and the END of the body (where signature blocks usually appear).

Return ONLY a JSON array. Each item:
{
  "display_name": "First Last",
  "email": "lowercase@email",
  "role": "Role at Company — or just role if no company — or null",
  "notes": "1 short factual note from signature (phone, title, certification) or null"
}

Rules:
- Skip automated senders (no-reply, notifications, mailer-daemon, etc.)
- Skip mailing list addresses (info@, support@) unless the body signature has a real name
- display_name must be a person, not "ACME Marketing Team"
- role should describe what they DO ("Attorney at Smith & Co", "VP Sales at Acme", "Real estate agent")
- If the same person appears twice, return them once
- If no real people, return []`;

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1200,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: `Extract from these emails:\n\n${sample}` }],
      }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const text = (data.content?.[0]?.text ?? '').trim();
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p: any) => p?.display_name && p?.email)
      .map((p: any) => ({
        display_name: String(p.display_name).slice(0, 100),
        email: String(p.email).toLowerCase().slice(0, 200),
        role: p.role ? String(p.role).slice(0, 100) : undefined,
        notes: p.notes ? String(p.notes).slice(0, 200) : undefined,
      }));
  } catch (err) {
    console.warn('[known-people] extractPeopleFromEmails failed:', err);
    return [];
  }
}

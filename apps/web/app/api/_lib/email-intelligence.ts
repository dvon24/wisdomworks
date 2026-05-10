/**
 * Email intelligence — voice profile, contact frequency, trusted senders.
 *
 * Three signals the personal assistant pulls from the owner's email history:
 *   1. Voice profile: extracted from sent emails, used by draft_email so
 *      replies sound like the user (greeting style, sign-off, tone, length).
 *   2. Contact frequency: who the owner sends to and how often. Drives
 *      "draft a reply to so-and-so" recognition + spam suspicion lift.
 *   3. Engagement: who the owner READS. A sender whose mail is consistently
 *      opened is trusted regardless of subject line.
 *
 * Refreshed by the daily email-learn cron. Read at runtime by the
 * draft_email tool and the email-sift classifier.
 */

import type { SentEmail, SeenInboxEmail } from './imap-runtime';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

export interface VoiceProfile {
  greeting_style: string;
  signoff_style: string;
  formality: 'casual' | 'professional' | 'formal' | 'mixed';
  sentence_length: 'short' | 'medium' | 'long' | 'mixed';
  tone_descriptors: string[];
  common_phrases: string[];
  signature?: string;
  examples?: string[];
  sample_size?: number;
}

export interface TopContact {
  address: string;
  display_name: string | null;
  sent_count: number;
  received_count: number;
  read_count: number;
  trust_label: string | null;
  engagement_score: number;
  last_interaction_at: string;
}

// ─── Contact frequency ────────────────────────────────────────────────────

async function upsertContact(args: {
  tenantPhone: string;
  address: string;
  displayName?: string;
  sentDelta?: number;
  receivedDelta?: number;
  readDelta?: number;
  lastSentAt?: string;
  lastReceivedAt?: string;
}): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  if (!args.address || !args.address.includes('@')) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/upsert_email_contact`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        p_tenant_phone: args.tenantPhone,
        p_address: args.address,
        p_display_name: args.displayName ?? null,
        p_sent_delta: args.sentDelta ?? 0,
        p_received_delta: args.receivedDelta ?? 0,
        p_read_delta: args.readDelta ?? 0,
        p_last_sent_at: args.lastSentAt ?? null,
        p_last_received_at: args.lastReceivedAt ?? null,
        p_trust_label: null,
      }),
    });
  } catch (err) {
    console.warn('[email-intelligence] upsertContact failed:', err);
  }
}

export async function ingestSentEmails(tenantPhone: string, emails: SentEmail[]): Promise<{ recipients: number }> {
  let count = 0;
  for (const email of emails) {
    for (const recipient of [...email.to, ...email.cc]) {
      if (!recipient.address) continue;
      await upsertContact({
        tenantPhone,
        address: recipient.address,
        displayName: recipient.name,
        sentDelta: 1,
        lastSentAt: email.date,
      });
      count++;
    }
  }
  return { recipients: count };
}

export async function ingestSeenInbox(tenantPhone: string, emails: SeenInboxEmail[]): Promise<{ contacts: number }> {
  let count = 0;
  for (const email of emails) {
    if (!email.from) continue;
    await upsertContact({
      tenantPhone,
      address: email.from,
      displayName: email.fromName,
      receivedDelta: 1,
      readDelta: 1, // came from seen=true search
      lastReceivedAt: email.date,
    });
    count++;
  }
  return { contacts: count };
}

export async function getTopContacts(tenantPhone: string, limit = 25): Promise<TopContact[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/top_email_contacts`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ p_tenant_phone: tenantPhone, p_limit: limit }),
    });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

/** Search contacts by display name OR address (case-insensitive partial match).
 * Ranks results by engagement_score so the most relevant matches surface first.
 * Returns up to `limit` results — caller decides how to disambiguate. */
export async function searchContacts(tenantPhone: string, query: string, limit = 10): Promise<TopContact[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const q = query.trim().toLowerCase();
  if (!q) return [];
  try {
    // Use PostgREST or filter — match name OR address with ilike
    const params = `tenant_phone=eq.${tenantPhone}&or=(display_name.ilike.*${encodeURIComponent(q)}*,address.ilike.*${encodeURIComponent(q)}*)&select=address,display_name,sent_count,received_count,read_count,trust_label,last_sent_at,last_received_at&limit=${limit * 3}`;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/email_contacts?${params}`, { headers: headers() });
    if (!res.ok) return [];
    const rows = await res.json();
    return rows
      .map((r: any) => ({
        address: r.address,
        display_name: r.display_name,
        sent_count: r.sent_count ?? 0,
        received_count: r.received_count ?? 0,
        read_count: r.read_count ?? 0,
        trust_label: r.trust_label,
        engagement_score: (r.sent_count ?? 0) * 2 + (r.read_count ?? 0) + (r.received_count ?? 0) * 0.5,
        last_interaction_at: r.last_sent_at ?? r.last_received_at ?? '',
      }))
      .filter((r: TopContact) => r.trust_label !== 'blocked')
      .sort((a: TopContact, b: TopContact) => b.engagement_score - a.engagement_score)
      .slice(0, limit);
  } catch {
    return [];
  }
}

export async function getContactByAddress(tenantPhone: string, address: string): Promise<TopContact | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/email_contacts?tenant_phone=eq.${tenantPhone}&address=eq.${encodeURIComponent(address.toLowerCase())}&select=address,display_name,sent_count,received_count,read_count,trust_label`,
      { headers: headers() },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      ...r,
      engagement_score: r.sent_count * 2 + r.read_count + r.received_count * 0.5,
      last_interaction_at: '',
    };
  } catch {
    return null;
  }
}

// ─── Voice profile ────────────────────────────────────────────────────────

export async function getVoiceProfile(tenantPhone: string): Promise<VoiceProfile | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/email_voice_profiles?tenant_phone=eq.${tenantPhone}&select=*`,
      { headers: headers() },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      ...row.traits,
      examples: row.examples,
      signature: row.signature,
      sample_size: row.sample_size,
    };
  } catch {
    return null;
  }
}

async function saveVoiceProfile(tenantPhone: string, profile: VoiceProfile, sampleSize: number): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  const { examples, signature, sample_size, ...traits } = profile;
  const payload = {
    tenant_phone: tenantPhone,
    traits,
    examples: examples ?? [],
    signature: signature ?? null,
    sample_size: sampleSize,
    last_built_at: new Date().toISOString(),
  };
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/email_voice_profiles`, {
      method: 'POST',
      headers: { ...headers(), Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.warn('[email-intelligence] saveVoiceProfile failed:', err);
  }
}

/** Strip quoted reply blocks ("On Mon, ... wrote:" / "> ..." lines) so the
 * voice extractor only sees the user's own writing. */
function stripQuoted(body: string): string {
  if (!body) return '';
  const lines = body.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    if (/^>\s/.test(line)) break;
    if (/^On .+ wrote:?$/i.test(line)) break;
    if (/^-+\s*Forwarded message\s*-+/i.test(line)) break;
    if (/^From: .+$/i.test(line) && out.length > 5) break;
    out.push(line);
  }
  return out.join('\n').trim();
}

/** Detect a likely sign-off block (last 4 lines, when they include things
 * like "Thanks", "Best", a name, or a phone number). */
function extractSignature(body: string): string | undefined {
  const lines = body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const tail = lines.slice(-4);
  if (tail.length === 0) return undefined;
  const looksLikeSignoff = /^(thanks|thank you|best|cheers|regards|sincerely|talk soon|all the best)[,!.]?\s*$/i.test(tail[0] ?? '');
  if (looksLikeSignoff) return tail.join('\n');
  return undefined;
}

/**
 * Mine the user's sent emails for their voice profile. Calls Anthropic
 * once per refresh — cost bounded. Returns null if too few samples or
 * extraction fails.
 */
export async function buildVoiceProfile(sentEmails: SentEmail[]): Promise<VoiceProfile | null> {
  if (!ANTHROPIC_API_KEY) return null;
  // Need at least a handful of real emails to form a profile
  const usable = sentEmails
    .map((e) => ({ ...e, body: stripQuoted(e.body) }))
    .filter((e) => e.body && e.body.length > 40);
  if (usable.length < 5) return null;

  const sample = usable.slice(0, 12);
  const examples = sample.slice(0, 3).map((e) => e.body.slice(0, 400));
  const signature = extractSignature(sample[0]?.body ?? '');

  const userMsg = sample
    .map((e, i) => `EMAIL ${i + 1} (subject: ${e.subject}, to: ${e.to[0]?.address ?? '?'})\n${e.body.slice(0, 800)}`)
    .join('\n\n---\n\n');

  const system = `You analyze a person's writing voice from their own sent emails. Return ONLY a JSON object, no other text:

{
  "greeting_style": "1 line — how they typically open (e.g. 'first name only, no Hi', 'no greeting, dives in', 'Hi {name}, ...')",
  "signoff_style": "1 line — how they close (e.g. 'Thanks, Devon', 'Best,', 'no signoff')",
  "formality": "casual" | "professional" | "formal" | "mixed",
  "sentence_length": "short" | "medium" | "long" | "mixed",
  "tone_descriptors": ["3-5 adjectives — e.g. direct, warm, terse, dry, friendly"],
  "common_phrases": ["3-5 phrases this person actually uses — verbatim from the samples"]
}

Rules:
- Be specific. "Direct and concise" beats "professional".
- common_phrases must be EXACT quotes from the emails.
- Don't make stuff up — if you can't tell, say so in the field rather than inventing a trait.`;

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 600,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userMsg }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = (data.content?.[0]?.text ?? '').trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    return {
      greeting_style: String(parsed.greeting_style ?? '').slice(0, 200),
      signoff_style: String(parsed.signoff_style ?? '').slice(0, 200),
      formality: (parsed.formality ?? 'mixed') as VoiceProfile['formality'],
      sentence_length: (parsed.sentence_length ?? 'mixed') as VoiceProfile['sentence_length'],
      tone_descriptors: Array.isArray(parsed.tone_descriptors) ? parsed.tone_descriptors.slice(0, 6).map(String) : [],
      common_phrases: Array.isArray(parsed.common_phrases) ? parsed.common_phrases.slice(0, 6).map(String) : [],
      signature,
      examples,
      sample_size: sample.length,
    };
  } catch (err) {
    console.warn('[email-intelligence] buildVoiceProfile failed:', err);
    return null;
  }
}

export async function refreshVoiceProfile(tenantPhone: string, sentEmails: SentEmail[]): Promise<{ built: boolean; sampleSize: number }> {
  const profile = await buildVoiceProfile(sentEmails);
  if (!profile) return { built: false, sampleSize: 0 };
  await saveVoiceProfile(tenantPhone, profile, profile.sample_size ?? sentEmails.length);
  return { built: true, sampleSize: profile.sample_size ?? sentEmails.length };
}

// ─── Prompt rendering ─────────────────────────────────────────────────────

export function renderVoiceForDraft(profile: VoiceProfile | null): string {
  if (!profile) return '';
  const lines = [
    '',
    'OWNER VOICE PROFILE (write in this voice — these traits were mined from their actual sent emails):',
    `- Greeting: ${profile.greeting_style}`,
    `- Sign-off: ${profile.signoff_style}`,
    `- Formality: ${profile.formality}`,
    `- Sentence length: ${profile.sentence_length}`,
    profile.tone_descriptors?.length ? `- Tone: ${profile.tone_descriptors.join(', ')}` : '',
    profile.common_phrases?.length ? `- Phrases they use: ${profile.common_phrases.map((p) => `"${p}"`).join('; ')}` : '',
    profile.signature ? `- Signature block (use verbatim if signing off):\n${profile.signature}` : '',
  ].filter(Boolean);
  if (profile.examples?.length) {
    lines.push('', 'SAMPLES (3 actual emails by the owner — match this register):');
    profile.examples.forEach((ex, i) => {
      lines.push(`--- Sample ${i + 1} ---`);
      lines.push(ex);
    });
  }
  return lines.join('\n');
}

export function renderTrustedContactsForClassifier(contacts: TopContact[]): string {
  if (contacts.length === 0) return '';

  // TRUSTED: owner has either marked them, or they've sent a real reply OR
  // the owner has actually opened multiple of their messages. Threshold lifted
  // from 3 to 5 because the previous bar was floating promotional senders up.
  const trusted = contacts
    .filter((c) => c.trust_label === 'trusted' || (c.sent_count >= 1 && c.engagement_score >= 5) || c.read_count >= 3)
    .slice(0, 30)
    .map((c) => c.display_name ? `${c.display_name} <${c.address}>` : c.address);

  // UNTRUSTED: the inverse signal — addresses that send mail but get ignored.
  // received_count >= 5 with read_count = 0 is a strong "this is spam/promo"
  // pattern. The owner has had a chance to engage and chose not to.
  const untrusted = contacts
    .filter((c) => c.trust_label !== 'trusted' && c.received_count >= 5 && c.read_count === 0 && c.sent_count === 0)
    .slice(0, 20)
    .map((c) => c.display_name ? `${c.display_name} <${c.address}>` : c.address);

  const blocks: string[] = [];
  if (trusted.length > 0) {
    blocks.push(
      '',
      'TRUSTED SENDERS (real ongoing relationships — bias toward business + needs_response, NEVER classify as spam):',
      trusted.map((t) => `  - ${t}`).join('\n'),
    );
  }
  if (untrusted.length > 0) {
    blocks.push(
      '',
      'UNREAD-ONLY SENDERS (owner consistently ignores these — strong spam/promo signal, prefer "spam" or "informational" classification):',
      untrusted.map((t) => `  - ${t}`).join('\n'),
    );
  }
  return blocks.join('\n');
}

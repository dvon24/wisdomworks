/**
 * Phase 1A — Conversation-to-knowledge atoms.
 *
 * When the owner texts Iris, an async extraction pass mines factual
 * atoms (competitors, goals, preferences, constraints, people, events,
 * facts) and stores them. Every agent's tick prompt then includes a
 * compact OWNER-PROVIDED CONTEXT block so insights compound across the
 * whole team — Iris's chat is no longer a silo.
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

export type AtomKind = 'competitor' | 'goal' | 'preference' | 'constraint' | 'person' | 'event' | 'fact';
export type AtomStatus = 'active' | 'archived' | 'rejected';

export interface KnowledgeAtom {
  id: string;
  kind: AtomKind;
  content: string;
  confidence: number;
  owner_confirmed: boolean;
  tags: string[];
  created_at: string;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────

export async function upsertAtom(args: {
  tenantPhone: string;
  kind: AtomKind;
  content: string;
  source: string;
  sourceMessageId?: string;
  confidence?: number;
  ownerConfirmed?: boolean;
  tags?: string[];
  metadata?: any;
}): Promise<string | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;

  // Embed the content so upsert_knowledge_atom can SEMANTICALLY dedup — collapse
  // varied phrasings of the same fact/goal that the lexical prefix match misses
  // (the SOP/behavioral-RAG pile-up). Best-effort: if embedding fails or there's
  // no OpenAI key, pass null and the RPC falls back to lexical dedup.
  let embedding: number[] | null = null;
  try {
    const { embedText } = await import('./embeddings');
    const r = await embedText(args.content.slice(0, 600));
    embedding = r.embedding ?? null;
  } catch (err) {
    console.warn('[atoms] embed for dedup failed (lexical fallback):', err);
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/upsert_knowledge_atom`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        p_tenant_phone: args.tenantPhone,
        p_kind: args.kind,
        p_content: args.content.slice(0, 600),
        p_source: args.source.slice(0, 200),
        p_source_message_id: args.sourceMessageId ?? null,
        p_confidence: args.confidence ?? 0.6,
        p_owner_confirmed: !!args.ownerConfirmed,
        p_tags: args.tags ?? [],
        p_metadata: args.metadata ?? {},
        // pgvector input format '[f1,f2,...]' — reliably cast to vector(1536)
        // through PostgREST (a raw JSON array is finicky to bind).
        p_embedding: embedding ? `[${embedding.join(',')}]` : null,
      }),
    });
    if (!res.ok) {
      console.warn(`[atoms] upsert failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    return (await res.text()).replace(/"/g, '').trim() || null;
  } catch (err) {
    console.warn('[atoms] upsert exception:', err);
    return null;
  }
}

export async function recentAtomsForPrompt(tenantPhone: string, lane?: string, limit = 15): Promise<KnowledgeAtom[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/recent_atoms_for_prompt`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        p_tenant_phone: tenantPhone,
        p_lane: lane ?? null,
        p_limit: limit,
      }),
    });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export async function listAllAtoms(tenantPhone: string, kind?: AtomKind): Promise<KnowledgeAtom[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const kindFilter = kind ? `&kind=eq.${kind}` : '';
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_knowledge_atoms?tenant_phone=eq.${tenantPhone}&status=eq.active${kindFilter}&order=owner_confirmed.desc,confidence.desc,created_at.desc&limit=100&select=id,kind,content,confidence,owner_confirmed,tags,created_at`,
      { headers: headers() },
    );
    return res.ok ? await res.json() : [];
  } catch {
    return [];
  }
}

export async function archiveAtom(atomId: string): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/tenant_knowledge_atoms?id=eq.${atomId}`, {
      method: 'PATCH',
      headers: { ...headers(), Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'archived', updated_at: new Date().toISOString() }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function confirmAtom(atomId: string): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/tenant_knowledge_atoms?id=eq.${atomId}`, {
      method: 'PATCH',
      headers: { ...headers(), Prefer: 'return=minimal' },
      body: JSON.stringify({ owner_confirmed: true, confidence: 1.0, updated_at: new Date().toISOString() }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Extraction ───────────────────────────────────────────────────────────

/**
 * Mine knowledge atoms from a recent owner message. Cheap Haiku call —
 * fires fire-and-forget after each inbound WhatsApp from the owner.
 * Returns the atoms that were extracted (and stored).
 */
export async function extractAtomsFromMessage(args: {
  tenantPhone: string;
  messageText: string;
  messageId?: string;
  conversationContext?: string;
}): Promise<KnowledgeAtom[]> {
  if (!ANTHROPIC_API_KEY) return [];
  if (!args.messageText || args.messageText.trim().length < 20) return [];

  // Idempotency guard — Meta sometimes delivers the same WhatsApp webhook
  // more than once. If we've already extracted atoms for this exact
  // message_id, skip the (expensive) Anthropic call entirely.
  if (args.messageId && SUPABASE_URL && SUPABASE_KEY) {
    try {
      const dupRes = await fetch(
        `${SUPABASE_URL}/rest/v1/tenant_knowledge_atoms?tenant_phone=eq.${args.tenantPhone}&source_message_id=eq.${encodeURIComponent(args.messageId)}&select=id&limit=1`,
        { headers: headers() },
      );
      if (dupRes.ok) {
        const rows = await dupRes.json();
        if (rows.length > 0) {
          console.log(`[atoms] skipping extraction for message ${args.messageId} — already processed`);
          return [];
        }
      }
    } catch {
      // fall through — better to over-extract than skip a real new message
    }
  }

  const system = `You extract structured factual atoms from a business owner's messages to their AI assistant. The owner runs a business (or several) and tells the assistant things in passing. Your job: capture the durable facts that the AI team should remember.

Return ONLY a JSON array. Each item:
{
  "kind": "competitor" | "goal" | "preference" | "constraint" | "person" | "event" | "fact",
  "content": "1-sentence factual statement, third-person",
  "confidence": 0.0-1.0,
  "tags": ["1-3 lowercase keywords/lane names"]
}

Rules:
- Only extract DURABLE facts. Skip pleasantries, greetings, ephemeral statuses ("I'm tired today").
- Each atom is ONE fact. Don't combine.
- 'kind' must be the most specific applicable bucket. If it doesn't fit any, use 'fact'.
- 'content' rewrites the owner's words as a third-person factual statement so any agent can read it. Example: owner says "I keep seeing Viktor in my ads" → content: "Owner has noticed Viktor ads recurring in their Instagram feed; treats Viktor as a competitor to monitor."
- 'confidence' starts at 0.7 by default. Reduce to 0.4 if the message is ambiguous; bump to 0.9 if the owner is making a clear declarative statement.
- 'tags' help agents filter relevant atoms: include lane (operations / marketing / finance / sales / technical / etc.), topic keywords (competitor names, project names), and 'general' for cross-lane facts.
- Return [] if no extractable atoms.

Examples:
Owner: "Ron Beaman is my attorney"
→ [{"kind": "person", "content": "Ron Beaman is the owner's attorney.", "confidence": 1.0, "tags": ["legal", "general"]}]

Owner: "I keep seeing getviktor.com in my LinkedIn ads - they look like a competitor"
→ [{"kind": "competitor", "content": "Owner has flagged getviktor.com as a competitor; first noticed via LinkedIn ads.", "confidence": 0.9, "tags": ["competitor", "viktor", "marketing"]}]

Owner: "don't email anyone after 7pm my time"
→ [{"kind": "constraint", "content": "Owner: do not send emails after 7pm local time.", "confidence": 1.0, "tags": ["email", "preference", "general"]}]

Owner: "good morning"
→ []`;

  const userMsg = args.conversationContext
    ? `Recent conversation context:\n${args.conversationContext.slice(0, 1500)}\n\nLATEST OWNER MESSAGE TO EXTRACT FROM:\n${args.messageText.slice(0, 1500)}`
    : `OWNER MESSAGE TO EXTRACT FROM:\n${args.messageText.slice(0, 2000)}`;

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userMsg }],
      }),
    });
    if (!res.ok) {
      console.warn(`[atoms] extract failed: ${res.status}`);
      return [];
    }
    const data = await res.json();
    const text = (data.content?.[0]?.text ?? '').trim();
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];

    const stored: KnowledgeAtom[] = [];
    for (const item of parsed) {
      if (!item?.kind || !item?.content) continue;
      const id = await upsertAtom({
        tenantPhone: args.tenantPhone,
        kind: item.kind,
        content: String(item.content).slice(0, 600),
        source: args.messageId ? `whatsapp:${args.messageId}` : 'whatsapp:inbound',
        sourceMessageId: args.messageId,
        confidence: typeof item.confidence === 'number' ? Math.max(0, Math.min(1, item.confidence)) : 0.6,
        tags: Array.isArray(item.tags) ? item.tags.slice(0, 5).map((t: any) => String(t).toLowerCase()) : [],
      });
      if (id) {
        stored.push({
          id,
          kind: item.kind,
          content: String(item.content),
          confidence: item.confidence ?? 0.6,
          owner_confirmed: false,
          tags: item.tags ?? [],
          created_at: new Date().toISOString(),
        });
      }
    }
    if (stored.length > 0) {
      console.log(`[atoms] extracted ${stored.length} atoms from ${args.tenantPhone}: ${stored.map((a) => `${a.kind}:${a.content.slice(0, 40)}`).join(', ')}`);
    }
    return stored;
  } catch (err) {
    console.warn('[atoms] extract exception:', err);
    return [];
  }
}

// ─── Prompt rendering ─────────────────────────────────────────────────────

export function renderAtomsForPrompt(atoms: KnowledgeAtom[]): string {
  if (atoms.length === 0) return '';
  const byKind: Record<AtomKind, KnowledgeAtom[]> = {
    competitor: [], goal: [], preference: [], constraint: [], person: [], event: [], fact: [],
  };
  for (const a of atoms) byKind[a.kind].push(a);

  const sections: string[] = [];
  const order: AtomKind[] = ['goal', 'constraint', 'preference', 'competitor', 'person', 'event', 'fact'];
  const labels: Record<AtomKind, string> = {
    goal: 'GOALS',
    constraint: 'CONSTRAINTS / RULES',
    preference: 'PREFERENCES',
    competitor: 'COMPETITORS THE OWNER WATCHES',
    person: 'PEOPLE (lightweight refs)',
    event: 'RECENT EVENTS',
    fact: 'OTHER FACTS',
  };
  for (const k of order) {
    if (byKind[k].length === 0) continue;
    sections.push(`${labels[k]}:`);
    for (const a of byKind[k].slice(0, 8)) {
      const mark = a.owner_confirmed ? '✓' : (a.confidence >= 0.7 ? '•' : '·');
      sections.push(`  ${mark} ${a.content.slice(0, 200)}`);
    }
  }
  if (sections.length === 0) return '';
  return [
    '',
    "OWNER-PROVIDED CONTEXT (mined from the owner's recent messages — incorporate when relevant, don't restate back to them):",
    ...sections,
    '',
    'CRITICAL: Before you escalate ANY observation or proposal, check this list. If your concern matches a CONSTRAINT, FACT (especially anything tagged roadmap/platform/known_gap), or already-known PREFERENCE here, DO NOT escalate it — those are explicit owner guidance that what you\'re about to flag is either known, expected, or off-limits. Acknowledge briefly in your observation that this is a known-handled item, set escalation_priority="none", and move on.',
  ].join('\n');
}

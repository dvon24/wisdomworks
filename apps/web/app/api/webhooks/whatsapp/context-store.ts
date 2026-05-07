/**
 * Persistent Context Store — gives agents long-term memory.
 *
 * Layered context system:
 * - Always: system prompt + operating protocol
 * - Hot: current conversation (last 50 messages), active PRDs, pending proposals
 * - Warm: user profile, business data, recent metrics
 * - Cold: full history via vector search (future)
 *
 * MVP: Uses Supabase REST API directly (no ORM overhead in serverless).
 * Stores conversations and user context as JSONB in a simple table.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const MAX_CONVERSATION_MESSAGES = 50;
const CONTEXT_SUMMARY_THRESHOLD = 30; // Summarize when history exceeds this

// ─── Types ───

export interface UserContext {
  phoneNumber: string;
  name: string;
  tenantId?: string;
  businessType?: string;
  businessName?: string;
  isOwner: boolean;
  conversationHistory: ConversationMessage[];
  profile: UserProfile;
  firstSeen: string;
  lastSeen: string;
  messageCount: number;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface UserProfile {
  /** What the agent has learned about this user */
  preferences: Record<string, string>;
  /** Active topics being discussed */
  activeTopics: string[];
  /** Summary of older conversation (compressed context) */
  conversationSummary?: string;
  /** AI agent team selected during onboarding (saved by /api/deploy-complete) */
  team?: TeamAgent[];
  /** Display business name (also stored on whatsapp_contexts.business_name) */
  businessName?: string;
  businessType?: string;
  agentCount?: number;
  deployedAt?: string;
  /** Today's calendar events (cached by calendar-sync cron) */
  todaysCalendar?: any[];
  todaysCalendarFetchedAt?: string;
  /** Email drafts awaiting approval (cached by email-sift cron) */
  pendingEmailDrafts?: any[];
}

export interface TeamAgent {
  id?: string;
  name: string;
  role: string;
  tier?: string;
  required?: boolean;
  emoji?: string;
  description?: string;
  channels?: string[];
  tools?: string[];
  strengths?: string[];
  limitations?: string[];
  aiModel?: string;
  subTeam?: {
    count: number;
    label: string;
    agents: { id?: string; name: string; role: string; tier?: string }[];
  };
}

// ─── In-Memory Cache (per Lambda invocation) ───
// Supabase is the source of truth, but we cache for the duration of the request

const cache = new Map<string, UserContext>();

// ─── Supabase REST Helpers ───

async function supabaseQuery(
  table: string,
  method: 'GET' | 'POST' | 'PATCH',
  params?: Record<string, string>,
  body?: unknown,
): Promise<any> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;

  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  const headers: Record<string, string> = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': method === 'POST' ? 'return=representation' : 'return=minimal',
  };

  // For upsert
  if (method === 'POST') {
    headers['Prefer'] = 'resolution=merge-duplicates,return=representation';
  }

  try {
    const response = await fetch(url.toString(), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      console.error(`[context-store] Supabase ${method} ${table} failed:`, response.status);
      return null;
    }

    if (method === 'GET') {
      return response.json();
    }
    return true;
  } catch (error) {
    console.error(`[context-store] Supabase error:`, error);
    return null;
  }
}

// ─── Public API ───

/**
 * Load user context — checks cache, then Supabase, then creates new.
 */
export async function loadUserContext(phoneNumber: string, name: string): Promise<UserContext> {
  // Check cache first
  const cached = cache.get(phoneNumber);
  if (cached) {
    cached.name = name;
    cached.lastSeen = new Date().toISOString();
    cached.messageCount++;
    return cached;
  }

  // Try Supabase
  if (SUPABASE_URL && SUPABASE_KEY) {
    const rows = await supabaseQuery('whatsapp_contexts', 'GET', {
      'phone_number': `eq.${phoneNumber}`,
      'select': '*',
    });

    if (rows?.length > 0) {
      const row = rows[0];
      const ctx: UserContext = {
        phoneNumber,
        name,
        tenantId: row.tenant_id,
        businessType: row.business_type,
        businessName: row.business_name,
        isOwner: row.is_owner ?? false,
        conversationHistory: row.conversation_history ?? [],
        profile: row.profile ?? { preferences: {}, activeTopics: [] },
        firstSeen: row.first_seen,
        lastSeen: new Date().toISOString(),
        messageCount: (row.message_count ?? 0) + 1,
      };
      cache.set(phoneNumber, ctx);
      return ctx;
    }
  }

  // New user
  const ctx: UserContext = {
    phoneNumber,
    name,
    isOwner: phoneNumber === '491703604562', // Devon
    conversationHistory: [],
    profile: { preferences: {}, activeTopics: [] },
    firstSeen: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
    messageCount: 1,
  };
  cache.set(phoneNumber, ctx);
  return ctx;
}

/**
 * Save user context back to Supabase.
 * Called after every message exchange.
 */
export async function saveUserContext(ctx: UserContext): Promise<void> {
  // Update cache
  cache.set(ctx.phoneNumber, ctx);

  // Trim conversation history if too long
  if (ctx.conversationHistory.length > MAX_CONVERSATION_MESSAGES) {
    // Keep last N messages, summarize the rest
    const oldMessages = ctx.conversationHistory.slice(0, -MAX_CONVERSATION_MESSAGES);
    ctx.conversationHistory = ctx.conversationHistory.slice(-MAX_CONVERSATION_MESSAGES);

    // Build a summary of old messages to preserve context
    if (oldMessages.length > 0) {
      const oldSummary = ctx.profile.conversationSummary ?? '';
      const newPart = oldMessages
        .map((m) => `${m.role}: ${m.content.slice(0, 100)}`)
        .join(' | ');
      ctx.profile.conversationSummary = oldSummary
        ? `${oldSummary} | ${newPart}`.slice(-2000) // Keep summary under 2K chars
        : newPart.slice(-2000);
    }
  }

  // Persist to Supabase
  if (SUPABASE_URL && SUPABASE_KEY) {
    await supabaseQuery('whatsapp_contexts', 'POST', undefined, {
      phone_number: ctx.phoneNumber,
      name: ctx.name,
      tenant_id: ctx.tenantId,
      business_type: ctx.businessType,
      business_name: ctx.businessName,
      is_owner: ctx.isOwner,
      conversation_history: ctx.conversationHistory,
      profile: ctx.profile,
      first_seen: ctx.firstSeen,
      last_seen: ctx.lastSeen,
      message_count: ctx.messageCount,
    });
  }
}

/**
 * Build the context window for an AI call.
 * Assembles the right amount of context based on the message.
 */
export function buildContextMessages(
  ctx: UserContext,
): { role: 'user' | 'assistant'; content: string }[] {
  const messages: { role: 'user' | 'assistant'; content: string }[] = [];

  // If there's a conversation summary, inject it as context
  if (ctx.profile.conversationSummary) {
    messages.push({
      role: 'user',
      content: `[Previous conversation summary: ${ctx.profile.conversationSummary}]`,
    });
    messages.push({
      role: 'assistant',
      content: 'I remember our previous conversations. How can I help?',
    });
  }

  // Add recent conversation history — strip timestamp (Anthropic rejects unknown fields)
  for (const m of ctx.conversationHistory) {
    messages.push({ role: m.role, content: m.content });
  }

  return messages;
}

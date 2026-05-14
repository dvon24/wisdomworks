/**
 * Vapi voice agent platform integration.
 *
 * https://docs.vapi.ai/api-reference/
 *
 * Vapi handles the call infrastructure (TTS / ASR / LLM routing /
 * interruption detection / Twilio number provisioning). We give it:
 *   - A "model" (Anthropic), system prompt, and tool definitions
 *   - A voice (ElevenLabs id by default)
 *   - A webhook URL that Vapi calls during the call to execute tools
 *
 * Cost shape:
 *   - Vapi platform: ~$0.05/min
 *   - Twilio carrier (provisioned via Vapi): ~$0.013/min + $1.15/mo per number
 *   - LLM: pass-through (Anthropic charges, surfaced in usage)
 *   - TTS (ElevenLabs starter voices): ~$0.02-0.05/min;
 *     premium voices: ~$0.10-0.18/min
 *
 * Required env:
 *   VAPI_API_KEY
 *   VAPI_WEBHOOK_BASE  (the public URL Vapi calls back to, e.g.
 *                      https://wisdomworks.vercel.app)
 */

const VAPI_API_BASE = 'https://api.vapi.ai';

function vapiHeaders(): Record<string, string> | null {
  const key = process.env.VAPI_API_KEY;
  if (!key) return null;
  return {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
}

export interface VapiAssistant {
  id: string;
  name: string;
  firstMessage?: string;
  // Trimmed — Vapi returns more, we only persist what we need
}

export interface VapiPhoneNumber {
  id: string;
  number: string;
  provider: string;
}

// ─── Assistants ──────────────────────────────────────────────────────────

export interface CreateAssistantInput {
  name: string;
  firstMessage: string;
  systemPrompt: string;
  voiceId: string;
  voiceProvider?: string;
  /** Webhook Vapi POSTs to during the call for tool execution */
  serverUrl: string;
  /** Tool definitions Vapi can call during conversation. Same schema
   *  as our agent tools, just with vapi-specific server fields. */
  tools?: Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: Record<string, any>;
    };
  }>;
  /** Anthropic model id to use during the call */
  model?: string;
}

export async function createVapiAssistant(input: CreateAssistantInput): Promise<{ ok: boolean; assistant?: VapiAssistant; error?: string }> {
  const headers = vapiHeaders();
  if (!headers) return { ok: false, error: 'VAPI_API_KEY not set' };

  const body = {
    name: input.name.slice(0, 100),
    firstMessage: input.firstMessage.slice(0, 500),
    serverUrl: input.serverUrl,
    model: {
      provider: 'anthropic',
      model: input.model ?? 'claude-sonnet-4-20250514',
      systemPrompt: input.systemPrompt.slice(0, 8000),
      tools: input.tools ?? [],
      maxTokens: 1000,
      temperature: 0.7,
    },
    voice: {
      provider: input.voiceProvider ?? '11labs',
      voiceId: input.voiceId,
    },
    transcriber: {
      provider: 'deepgram',
      model: 'nova-2',
      language: 'en',
    },
  };

  try {
    const res = await fetch(`${VAPI_API_BASE}/assistant`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.text();
      return { ok: false, error: `Vapi assistant create failed: ${res.status} ${errBody.slice(0, 300)}` };
    }
    const assistant = await res.json();
    return { ok: true, assistant };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

export async function updateVapiAssistant(
  assistantId: string,
  patch: Partial<CreateAssistantInput>,
): Promise<{ ok: boolean; error?: string }> {
  const headers = vapiHeaders();
  if (!headers) return { ok: false, error: 'VAPI_API_KEY not set' };

  // Build the patch body — only include fields that changed
  const body: Record<string, unknown> = {};
  if (patch.name) body.name = patch.name.slice(0, 100);
  if (patch.firstMessage) body.firstMessage = patch.firstMessage.slice(0, 500);
  if (patch.systemPrompt || patch.tools !== undefined || patch.model) {
    body.model = {
      provider: 'anthropic',
      model: patch.model ?? 'claude-sonnet-4-20250514',
      ...(patch.systemPrompt ? { systemPrompt: patch.systemPrompt.slice(0, 8000) } : {}),
      ...(patch.tools !== undefined ? { tools: patch.tools } : {}),
    };
  }
  if (patch.voiceId) {
    body.voice = {
      provider: patch.voiceProvider ?? '11labs',
      voiceId: patch.voiceId,
    };
  }

  try {
    const res = await fetch(`${VAPI_API_BASE}/assistant/${assistantId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) return { ok: false, error: `Vapi update failed: ${res.status} ${await res.text()}` };
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

// ─── Phone numbers ───────────────────────────────────────────────────────

export interface ProvisionNumberInput {
  /** Vapi assistant to bind this number to */
  assistantId: string;
  /** Optional: 'twilio' (default) — Vapi handles the carrier order */
  provider?: 'twilio';
  /** Country / area code preferences */
  areaCode?: string;
}

/** Buy a phone number through Vapi (which orders it from Twilio). */
export async function provisionVapiPhoneNumber(input: ProvisionNumberInput): Promise<{ ok: boolean; number?: VapiPhoneNumber; error?: string }> {
  const headers = vapiHeaders();
  if (!headers) return { ok: false, error: 'VAPI_API_KEY not set' };
  try {
    const body: Record<string, unknown> = {
      provider: input.provider ?? 'twilio',
      assistantId: input.assistantId,
    };
    if (input.areaCode) body.numberDesiredAreaCode = input.areaCode;

    const res = await fetch(`${VAPI_API_BASE}/phone-number`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) return { ok: false, error: `Vapi number provision failed: ${res.status} ${await res.text()}` };
    const data = await res.json();
    return { ok: true, number: { id: data.id, number: data.number, provider: data.provider } };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

/** Release a number — stops the recurring rental fee. */
export async function releaseVapiPhoneNumber(numberId: string): Promise<{ ok: boolean; error?: string }> {
  const headers = vapiHeaders();
  if (!headers) return { ok: false, error: 'VAPI_API_KEY not set' };
  try {
    const res = await fetch(`${VAPI_API_BASE}/phone-number/${numberId}`, {
      method: 'DELETE',
      headers,
    });
    if (!res.ok) return { ok: false, error: `Vapi release failed: ${res.status}` };
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

// ─── Calls ───────────────────────────────────────────────────────────────

export interface VapiCallSummary {
  id: string;
  startedAt?: string;
  endedAt?: string;
  durationSeconds?: number;
  costUsd?: number;
  transcript?: string;
  summary?: string;
  endedReason?: string;
}

export async function getVapiCall(callId: string): Promise<{ ok: boolean; call?: VapiCallSummary; error?: string }> {
  const headers = vapiHeaders();
  if (!headers) return { ok: false, error: 'VAPI_API_KEY not set' };
  try {
    const res = await fetch(`${VAPI_API_BASE}/call/${callId}`, { headers });
    if (!res.ok) return { ok: false, error: `Vapi call fetch failed: ${res.status}` };
    const data = await res.json();
    const startedAt = data.startedAt ?? data.createdAt;
    const endedAt = data.endedAt;
    const durationSeconds = startedAt && endedAt
      ? Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000)
      : undefined;
    return {
      ok: true,
      call: {
        id: data.id,
        startedAt,
        endedAt,
        durationSeconds,
        costUsd: typeof data.cost === 'number' ? data.cost : undefined,
        transcript: data.transcript,
        summary: data.summary,
        endedReason: data.endedReason,
      },
    };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

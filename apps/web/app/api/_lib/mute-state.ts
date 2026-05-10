/**
 * Do-not-disturb / mute state for proactive WhatsApp pushes.
 *
 * Stored on whatsapp_contexts.profile.mute as JSONB so no migration needed.
 * Only blocks PROACTIVE outbound pushes (digests, escalations, follow-ups,
 * briefings). Inbound user messages always reach Sophia and Sophia always
 * replies — mute is a "stop interrupting me" signal, not a "shut down."
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

export interface MuteState {
  muted: boolean;
  until?: string;
  reason?: string;
  set_at?: string;
}

async function loadProfile(tenantPhone: string): Promise<any | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${tenantPhone}&select=profile`,
      { headers: headers() },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return rows[0]?.profile ?? {};
  } catch {
    return null;
  }
}

async function saveProfile(tenantPhone: string, profile: any): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${tenantPhone}`, {
      method: 'PATCH',
      headers: { ...headers(), Prefer: 'return=minimal' },
      body: JSON.stringify({ profile }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Check whether a tenant is currently muted. Cheap — single JSONB read. */
export async function isMuted(tenantPhone: string): Promise<{ muted: boolean; until?: string; reason?: string }> {
  const profile = await loadProfile(tenantPhone);
  const mute = profile?.mute as MuteState | undefined;
  if (!mute || !mute.muted) return { muted: false };
  if (mute.until && new Date(mute.until) <= new Date()) {
    // Auto-clear expired mute (best effort, don't block on save)
    void clearMute(tenantPhone);
    return { muted: false };
  }
  return { muted: true, until: mute.until, reason: mute.reason };
}

export async function setMute(args: {
  tenantPhone: string;
  durationMinutes?: number;
  until?: string;
  reason?: string;
}): Promise<{ ok: boolean; until?: string }> {
  const profile = (await loadProfile(args.tenantPhone)) ?? {};
  let untilIso: string | undefined;
  if (args.until) {
    untilIso = args.until;
  } else if (args.durationMinutes && args.durationMinutes > 0) {
    untilIso = new Date(Date.now() + args.durationMinutes * 60 * 1000).toISOString();
  }
  // No until = indefinite mute (until user explicitly unmutes)
  profile.mute = {
    muted: true,
    until: untilIso,
    reason: args.reason ?? undefined,
    set_at: new Date().toISOString(),
  } satisfies MuteState;
  const ok = await saveProfile(args.tenantPhone, profile);
  return { ok, until: untilIso };
}

export async function clearMute(tenantPhone: string): Promise<boolean> {
  const profile = (await loadProfile(tenantPhone)) ?? {};
  profile.mute = { muted: false } satisfies MuteState;
  return await saveProfile(tenantPhone, profile);
}

export function formatMuteUntil(until?: string): string {
  if (!until) return 'until you say so';
  const d = new Date(until);
  const now = new Date();
  const diffMin = Math.round((d.getTime() - now.getTime()) / 60000);
  if (diffMin <= 0) return 'now';
  if (diffMin < 60) return `for ${diffMin} more minute${diffMin === 1 ? '' : 's'}`;
  const hours = Math.round(diffMin / 60);
  return `for ~${hours} more hour${hours === 1 ? '' : 's'}`;
}

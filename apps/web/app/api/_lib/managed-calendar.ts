/**
 * Managed (native) calendar — tenant_events.
 *
 * For owners who don't want to connect Google/Apple OAuth (or haven't
 * yet), the team can still schedule events via Iris and have them
 * show up in the daily brief. When the owner DOES connect an external
 * calendar later, we'll mirror these via external_id (Phase 2).
 *
 * Also powers cross-source schedule reads for the daily brief and
 * conflict detection (managed-calendar + connected calendar +
 * upcoming Square bookings).
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

export interface ManagedEvent {
  id: string;
  tenant_phone: string;
  title: string;
  notes: string | null;
  location: string | null;
  start_at: string;
  end_at: string;
  all_day: boolean;
  source: 'owner_defined' | 'agent_created' | 'external_sync';
  external_provider: string | null;
  external_id: string | null;
  tags: string[];
  metadata: Record<string, any>;
  cancelled_at: string | null;
}

export interface CreateEventInput {
  tenantPhone: string;
  title: string;
  startAt: string;
  endAt: string;
  notes?: string;
  location?: string;
  allDay?: boolean;
  tags?: string[];
  source?: 'owner_defined' | 'agent_created' | 'external_sync';
  externalProvider?: string;
  externalId?: string;
}

export async function createEvent(input: CreateEventInput): Promise<string | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const cleanPhone = input.tenantPhone.replace(/[\s\-+()]/g, '');
    // Insert the native row first so it lands even if external push fails
    const res = await fetch(`${SUPABASE_URL}/rest/v1/tenant_events`, {
      method: 'POST',
      headers: { ...headers(), Prefer: 'return=representation' },
      body: JSON.stringify({
        tenant_phone: cleanPhone,
        title: input.title.slice(0, 200),
        notes: input.notes ?? null,
        location: input.location ?? null,
        start_at: input.startAt,
        end_at: input.endAt,
        all_day: !!input.allDay,
        source: input.source ?? 'owner_defined',
        external_provider: input.externalProvider ?? null,
        external_id: input.externalId ?? null,
        tags: input.tags ?? [],
      }),
    });
    if (!res.ok) {
      console.warn('[managed-calendar] create failed:', await res.text());
      return null;
    }
    const rows = await res.json();
    const nativeId = rows[0]?.id ?? null;
    if (!nativeId) return null;

    // Two-way sync — if this event came from an EXTERNAL pull (source =
    // 'external_sync'), don't push it back. Otherwise push to whatever
    // external calendar is connected. Fire-and-forget so the chat reply
    // doesn't block on it.
    if ((input.source ?? 'owner_defined') !== 'external_sync') {
      void pushToExternalCalendars(cleanPhone, nativeId, input);
    }

    return nativeId;
  } catch (err) {
    console.warn('[managed-calendar] create exception:', err);
    return null;
  }
}

/** Push a freshly-created native event to whatever external calendar the
 *  tenant has connected (Google / Microsoft / Apple). On success, stamps
 *  external_provider + external_id on the native row so we can dedup later
 *  and so update/cancel can target the right external event.
 */
async function pushToExternalCalendars(
  tenantPhone: string,
  nativeId: string,
  input: CreateEventInput,
): Promise<void> {
  try {
    const { loadConnectionsForPhone, createCalendarEvent } = await import('@wisdomworks/shared');
    const connections = await loadConnectionsForPhone(tenantPhone);
    const calendarConn = connections.find((c) => c.service === 'calendar');
    if (!calendarConn) return;

    const result = await createCalendarEvent(calendarConn, {
      title: input.title,
      description: input.notes,
      location: input.location,
      start: input.startAt,
      end: input.endAt,
      isAllDay: !!input.allDay,
    });
    if (!result.success || !result.data) {
      console.warn('[managed-calendar] external push failed:', result.error);
      return;
    }

    // Stamp the external id so update/cancel can target it
    if (SUPABASE_URL && SUPABASE_KEY) {
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/tenant_events?id=eq.${nativeId}`, {
          method: 'PATCH',
          headers: { ...headers(), Prefer: 'return=minimal' },
          body: JSON.stringify({
            external_provider: calendarConn.provider,
            external_id: result.data.id,
          }),
        });
      } catch {}
    }
  } catch (err) {
    console.warn('[managed-calendar] external push exception:', err);
  }
}

export async function cancelEvent(eventId: string, tenantPhone: string): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false;
  try {
    const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
    // Load the row first so we have the external_id (if any) for the
    // mirrored delete on the external calendar
    const readRes = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_events?id=eq.${eventId}&tenant_phone=eq.${cleanPhone}&select=external_provider,external_id`,
      { headers: headers() },
    );
    const existing = readRes.ok ? (await readRes.json())[0] : null;

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_events?id=eq.${eventId}&tenant_phone=eq.${cleanPhone}`,
      {
        method: 'PATCH',
        headers: { ...headers(), Prefer: 'return=minimal' },
        body: JSON.stringify({ cancelled_at: new Date().toISOString() }),
      },
    );
    if (!res.ok) return false;

    // Mirror the cancellation on the external calendar if we pushed it there
    if (existing?.external_provider && existing?.external_id) {
      void deleteFromExternalCalendar(cleanPhone, existing.external_provider, existing.external_id);
    }
    return true;
  } catch {
    return false;
  }
}

async function deleteFromExternalCalendar(
  tenantPhone: string,
  externalProvider: string,
  externalId: string,
): Promise<void> {
  try {
    const { loadConnectionsForPhone, deleteCalendarEvent } = await import('@wisdomworks/shared');
    const connections = await loadConnectionsForPhone(tenantPhone);
    const conn = connections.find((c) => c.service === 'calendar' && c.provider === externalProvider);
    if (!conn) return;
    await deleteCalendarEvent(conn, externalId);
  } catch (err) {
    console.warn('[managed-calendar] external delete failed:', err);
  }
}

export async function listEventsInRange(input: {
  tenantPhone: string;
  fromIso: string;
  toIso: string;
}): Promise<ManagedEvent[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const cleanPhone = input.tenantPhone.replace(/[\s\-+()]/g, '');
  try {
    // Events that overlap the window: start < to AND end > from
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_events?tenant_phone=eq.${cleanPhone}&cancelled_at=is.null&start_at=lt.${encodeURIComponent(input.toIso)}&end_at=gt.${encodeURIComponent(input.fromIso)}&order=start_at.asc&select=*`,
      { headers: headers() },
    );
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export async function listTodaysEvents(tenantPhone: string): Promise<ManagedEvent[]> {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();
  return listEventsInRange({ tenantPhone, fromIso: startOfDay, toIso: endOfDay });
}

/** Render a unified schedule view for the daily brief. Combines:
 *   - native tenant_events
 *   - connected calendar's todaysCalendar (already in profile)
 *   - upcoming Square client_visits (via the booking sync)
 *
 *  Returns a chronologically-sorted, deduplicated event list.
 */
export interface UnifiedScheduleItem {
  startAt: string;
  endAt?: string;
  title: string;
  source: 'native' | 'connected_calendar' | 'booking';
  location?: string;
}

export async function buildUnifiedSchedule(input: {
  tenantPhone: string;
  fromIso: string;
  toIso: string;
  connectedCalendarEvents?: Array<{ start: string; end?: string; title: string; location?: string }>;
  upcomingBookings?: Array<{ occurred_at: string; summary: string }>;
}): Promise<UnifiedScheduleItem[]> {
  const native = await listEventsInRange({
    tenantPhone: input.tenantPhone,
    fromIso: input.fromIso,
    toIso: input.toIso,
  });

  const items: UnifiedScheduleItem[] = [];
  for (const e of native) {
    items.push({
      startAt: e.start_at,
      endAt: e.end_at,
      title: e.title,
      source: 'native',
      location: e.location ?? undefined,
    });
  }
  for (const e of input.connectedCalendarEvents ?? []) {
    items.push({
      startAt: e.start,
      endAt: e.end,
      title: e.title,
      source: 'connected_calendar',
      location: e.location,
    });
  }
  for (const b of input.upcomingBookings ?? []) {
    items.push({
      startAt: b.occurred_at,
      title: b.summary,
      source: 'booking',
    });
  }

  // Dedup roughly by title + startAt within 5 minutes
  const seen = new Set<string>();
  const deduped: UnifiedScheduleItem[] = [];
  for (const item of items.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())) {
    const key = `${item.title.toLowerCase().trim().slice(0, 40)}|${Math.floor(new Date(item.startAt).getTime() / (5 * 60 * 1000))}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}

export interface ScheduleConflict {
  a: UnifiedScheduleItem;
  b: UnifiedScheduleItem;
}

/** Detect overlapping events in a unified schedule. */
export function detectConflicts(items: UnifiedScheduleItem[]): ScheduleConflict[] {
  const conflicts: ScheduleConflict[] = [];
  // Naive O(n²) — fine at the scale of one day's events
  for (let i = 0; i < items.length; i++) {
    const a = items[i]!;
    const aStart = new Date(a.startAt).getTime();
    const aEnd = a.endAt ? new Date(a.endAt).getTime() : aStart + 60 * 60 * 1000;
    for (let j = i + 1; j < items.length; j++) {
      const b = items[j]!;
      const bStart = new Date(b.startAt).getTime();
      const bEnd = b.endAt ? new Date(b.endAt).getTime() : bStart + 60 * 60 * 1000;
      // Skip if same source AND same title (already deduped above, but defensive)
      if (a.source === b.source && a.title.toLowerCase() === b.title.toLowerCase()) continue;
      // Overlap: aStart < bEnd && bStart < aEnd
      if (aStart < bEnd && bStart < aEnd) {
        conflicts.push({ a, b });
      }
    }
  }
  return conflicts;
}

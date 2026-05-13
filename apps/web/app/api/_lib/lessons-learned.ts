/**
 * Story 2.14 — Lessons Learned registry.
 *
 * Companion to process-capture. Where process_records track "what we keep
 * doing successfully" (candidates for automation), lessons_learned tracks
 * "what went wrong + how we fixed it" so agents can avoid repeating
 * known pitfalls.
 *
 * Public API:
 *   - logLesson(): owner-driven or detector-driven write
 *   - queryLessonsForTask(): keyword pre-flight before a risky action
 *   - markLessonApplied(): bump apply_count when a lesson alters behavior
 *   - markLessonResolved(): owner says "this no longer applies"
 *   - renderLessonsForPrompt(): inject into agent system prompts
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

export type LessonSeverity = 'low' | 'medium' | 'high' | 'critical';
export type LessonStatus = 'open' | 'applied' | 'resolved';

export interface Lesson {
  id: string;
  tenant_phone: string;
  signature: string;
  title: string;
  what_went_wrong: string;
  corrective_action: string;
  topic_keywords: string[];
  source_process_id: string | null;
  source_run_id: string | null;
  severity: LessonSeverity;
  status: LessonStatus;
  consult_count: number;
  apply_count: number;
  last_consulted_at: string | null;
  last_applied_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface LogLessonInput {
  tenantPhone: string;
  signature: string;
  title: string;
  whatWentWrong: string;
  correctiveAction: string;
  topicKeywords: string[];
  severity?: LessonSeverity;
  sourceProcessId?: string;
  sourceRunId?: string;
}

export async function logLesson(input: LogLessonInput): Promise<string | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const cleanPhone = input.tenantPhone.replace(/[\s\-+()]/g, '');
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/lessons_learned?on_conflict=tenant_phone,signature`,
      {
        method: 'POST',
        headers: { ...headers(), Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({
          tenant_phone: cleanPhone,
          signature: input.signature.slice(0, 200),
          title: input.title.slice(0, 250),
          what_went_wrong: input.whatWentWrong.slice(0, 1000),
          corrective_action: input.correctiveAction.slice(0, 1000),
          topic_keywords: input.topicKeywords.slice(0, 30),
          severity: input.severity ?? 'medium',
          source_process_id: input.sourceProcessId ?? null,
          source_run_id: input.sourceRunId ?? null,
          status: 'open',
        }),
      },
    );
    if (!res.ok) {
      console.warn('[lessons] insert failed:', await res.text());
      return null;
    }
    const rows = await res.json();
    return rows[0]?.id ?? null;
  } catch (err) {
    console.warn('[lessons] insert exception:', err);
    return null;
  }
}

/**
 * Pre-flight matcher — return any OPEN lessons whose keywords overlap
 * with the incoming task description.
 *
 * Used by destructive tools BEFORE firing. If a high/critical lesson
 * matches, the caller should surface it to the owner and gate the
 * action. Lower-severity lessons get injected into the agent prompt
 * so the model can self-correct.
 *
 * Keyword match is simple `&&` (any-overlap) against `topic_keywords` —
 * fast via the GIN index. Could swap to pgvector semantic match later
 * via knowledge_chunks if precision becomes the bottleneck.
 */
export async function queryLessonsForTask(input: {
  tenantPhone: string;
  taskKeywords: string[];
  minSeverity?: LessonSeverity;
  limit?: number;
}): Promise<Lesson[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  if (input.taskKeywords.length === 0) return [];
  const cleanPhone = input.tenantPhone.replace(/[\s\-+()]/g, '');
  // PostgREST array contains-any uses ?topic_keywords=ov.{a,b,c}
  const keywords = input.taskKeywords
    .map((k) => k.replace(/[{}]/g, '').trim())
    .filter((k) => k.length >= 3)
    .slice(0, 10)
    .map((k) => `"${k}"`)
    .join(',');
  if (!keywords) return [];

  const sevOrder: Record<LessonSeverity, number> = { low: 0, medium: 1, high: 2, critical: 3 };
  const minSev = sevOrder[input.minSeverity ?? 'low'];
  const limit = input.limit ?? 5;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/lessons_learned?tenant_phone=eq.${cleanPhone}&status=eq.open&topic_keywords=ov.{${keywords}}&order=severity.desc&limit=${limit}&select=*`,
      { headers: headers() },
    );
    if (!res.ok) return [];
    const rows = (await res.json()) as Lesson[];
    const filtered = rows.filter((l) => sevOrder[l.severity] >= minSev);

    // Bump consult_count so we can see which lessons are actively
    // shaping behavior. Fire-and-forget; never block the pre-flight.
    if (filtered.length > 0) {
      void bumpConsultCount(filtered.map((l) => l.id));
    }
    return filtered;
  } catch (err) {
    console.warn('[lessons] queryForTask exception:', err);
    return [];
  }
}

async function bumpConsultCount(ids: string[]): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY || ids.length === 0) return;
  try {
    // PostgREST doesn't do atomic increments via PATCH, so we read +
    // write. Race conditions just under-count — acceptable for stats.
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/lessons_learned?id=in.(${ids.join(',')})&select=id,consult_count`,
      { headers: headers() },
    );
    if (!res.ok) return;
    const rows = await res.json();
    const now = new Date().toISOString();
    await Promise.all(
      rows.map((r: any) =>
        fetch(`${SUPABASE_URL}/rest/v1/lessons_learned?id=eq.${r.id}`, {
          method: 'PATCH',
          headers: { ...headers(), Prefer: 'return=minimal' },
          body: JSON.stringify({ consult_count: (r.consult_count ?? 0) + 1, last_consulted_at: now }),
        }),
      ),
    );
  } catch {}
}

export async function markLessonApplied(lessonId: string): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    const cur = await fetch(
      `${SUPABASE_URL}/rest/v1/lessons_learned?id=eq.${lessonId}&select=apply_count`,
      { headers: headers() },
    );
    if (!cur.ok) return;
    const rows = await cur.json();
    const count = (rows[0]?.apply_count ?? 0) + 1;
    await fetch(`${SUPABASE_URL}/rest/v1/lessons_learned?id=eq.${lessonId}`, {
      method: 'PATCH',
      headers: { ...headers(), Prefer: 'return=minimal' },
      body: JSON.stringify({
        apply_count: count,
        last_applied_at: new Date().toISOString(),
        status: 'applied',
      }),
    });
  } catch {}
}

export async function markLessonResolved(lessonId: string): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/lessons_learned?id=eq.${lessonId}`, {
      method: 'PATCH',
      headers: { ...headers(), Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'resolved' }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function listOpenLessons(tenantPhone: string, limit = 20): Promise<Lesson[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/lessons_learned?tenant_phone=eq.${cleanPhone}&status=eq.open&order=severity.desc,created_at.desc&limit=${limit}&select=*`,
      { headers: headers() },
    );
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

/**
 * Render open lessons as a system-prompt block. Top N by severity so
 * agents see the most important rules first. Used by agent-runtime
 * when building per-tick prompts and (potentially) by iris-brain.
 */
export function renderLessonsForPrompt(lessons: Lesson[]): string {
  if (lessons.length === 0) return '';
  const lines = lessons.map((l) => {
    const sevTag = l.severity === 'critical' ? '🚨' : l.severity === 'high' ? '⚠' : '·';
    return `${sevTag} ${l.title}\n  Avoid: ${l.what_went_wrong}\n  Do instead: ${l.corrective_action}`;
  });
  return `\n\nLESSONS LEARNED (avoid repeating these mistakes — they came from real corrections):\n${lines.join('\n\n')}`;
}

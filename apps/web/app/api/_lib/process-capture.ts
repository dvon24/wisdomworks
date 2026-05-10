/**
 * Story 2.14 — Process Capture & Experience Logging.
 *
 * Detects recurring patterns in agent_runs (via the detect_recurring_processes
 * RPC) and upserts them into process_records. The owner can then mark a
 * process 'approve_for_automation' which generates a workflow definition
 * and runs it on subsequent triggers (Story 2.12 runner).
 *
 * Lifecycle: observed → proposed → approved → automated → declined.
 *
 * Triggered by:
 *   - Hourly cron (cheap; the SQL function is fast)
 *   - Manual lifecycle action='detect_processes'
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

export interface DetectedPattern {
  signature: string;
  occurrences: number;
  first_seen: string;
  last_seen: string;
  sample_summary: string;
  example_run_ids: string[];
}

export async function detectProcesses(tenantPhone: string, lookbackDays = 14): Promise<DetectedPattern[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/detect_recurring_processes`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        p_tenant_phone: tenantPhone,
        p_lookback_days: lookbackDays,
        p_min_occurrences: 2,
      }),
    });
    if (!res.ok) return [];
    return await res.json();
  } catch (err) {
    console.warn('[process-capture] detect failed:', err);
    return [];
  }
}

/**
 * Upsert detected patterns as process_records. Existing records get
 * occurrence_count bumped + last_observed_at touched; new ones get
 * status 'observed'. Returns counts.
 */
export async function captureProcesses(tenantPhone: string): Promise<{ new: number; updated: number; total: number }> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { new: 0, updated: 0, total: 0 };
  const patterns = await detectProcesses(tenantPhone);
  if (patterns.length === 0) return { new: 0, updated: 0, total: 0 };

  let createdCount = 0;
  let updatedCount = 0;

  for (const pattern of patterns) {
    // Use the signature as the stable name (fits in TEXT, dedup-friendly)
    const name = pattern.signature.slice(0, 200);
    // Check if it exists
    const existsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/process_records?tenant_phone=eq.${tenantPhone}&name=eq.${encodeURIComponent(name)}&select=id,occurrence_count`,
      { headers: headers() },
    );
    const existing = existsRes.ok ? await existsRes.json() : [];

    if (existing.length > 0) {
      // Update occurrence count + last_observed_at
      await fetch(`${SUPABASE_URL}/rest/v1/process_records?id=eq.${existing[0].id}`, {
        method: 'PATCH',
        headers: { ...headers(), Prefer: 'return=minimal' },
        body: JSON.stringify({
          occurrence_count: pattern.occurrences,
          last_observed_at: pattern.last_seen,
        }),
      });
      updatedCount++;
    } else {
      // Insert new
      await fetch(`${SUPABASE_URL}/rest/v1/process_records`, {
        method: 'POST',
        headers: { ...headers(), Prefer: 'return=minimal' },
        body: JSON.stringify({
          tenant_phone: tenantPhone,
          name,
          description: pattern.sample_summary.slice(0, 400),
          steps: [{
            // First-pass step shape — single-step process. When we have
            // more sophisticated detection we'll capture multi-step chains.
            tool: 'observed',
            summary: pattern.sample_summary,
            example_run_ids: pattern.example_run_ids,
          }],
          occurrence_count: pattern.occurrences,
          first_observed_at: pattern.first_seen,
          last_observed_at: pattern.last_seen,
          metadata: { detection_signature: pattern.signature },
        }),
      });
      createdCount++;
    }
  }

  return { new: createdCount, updated: updatedCount, total: patterns.length };
}

/**
 * Move a process record through its lifecycle. Owner-driven actions:
 *   - propose:   observed → proposed (orchestrator surfaces it)
 *   - approve:   proposed → approved (owner says 'yes, automate it')
 *   - automate:  approved → automated (workflow definition generated + scheduled)
 *   - decline:   any → declined
 */
export async function transitionProcess(
  processId: string,
  toStatus: 'proposed' | 'approved' | 'automated' | 'declined',
  workflowDefinition?: any,
): Promise<{ ok: boolean; error?: string }> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { ok: false, error: 'Supabase not configured' };
  const body: any = { automation_status: toStatus };
  if (toStatus === 'approved') body.approved_at = new Date().toISOString();
  if (toStatus === 'automated' && workflowDefinition) body.workflow_definition = workflowDefinition;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/process_records?id=eq.${processId}`, {
    method: 'PATCH',
    headers: { ...headers(), Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });
  if (!res.ok) return { ok: false, error: `${res.status}: ${await res.text()}` };
  return { ok: true };
}

/**
 * Generate a workflow definition from a process record's observed steps.
 * Heuristic — wraps each observed step as a 'tool' step in a sequence.
 * The owner can edit before approving.
 */
export async function proposeWorkflowFor(processId: string): Promise<any | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/process_records?id=eq.${processId}&select=name,description,steps`,
    { headers: headers() },
  );
  if (!res.ok) return null;
  const rows = await res.json();
  const record = rows[0];
  if (!record) return null;
  // First-pass: just stub a workflow that re-invokes the observed agent's
  // primary tool. Real composition arrives once steps are multi-step.
  return {
    name: record.name,
    description: record.description || `Auto-generated from ${record.name}`,
    steps: (record.steps as any[]).map((step: any, i: number) => ({
      id: `step_${i}`,
      type: 'tool',
      tool: step.tool === 'observed' ? 'query_knowledge_base' : step.tool,
      input: { question: step.summary?.slice(0, 200) ?? record.description },
      retries: 1,
    })),
  };
}

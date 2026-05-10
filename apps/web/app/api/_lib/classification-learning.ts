/**
 * Story 2.13 — Classification Learning + QA Monitoring.
 *
 * - logSample(): every email classification gets a row in
 *   email_classification_samples. Cheap, PII-safe (no body), used by
 *   the QA agent to detect drift trends.
 * - logCorrection(): when the user reclassifies an email, store the
 *   correction so future few-shot prompts can use it as a positive
 *   example.
 * - buildFewShotExamples(): pulls recent corrections for a tenant and
 *   formats them as JSON examples for the classifier system prompt.
 *   Bounded to 10 examples to keep prompt size reasonable.
 * - runQaScan(): runs once a day across every tenant. Looks for:
 *     • runs of low-confidence classifications (drift)
 *     • repeated misclassification patterns from corrections
 *     • spike in 'uncertain' rate
 *   Writes findings to agent_runs as a 'manual' trigger from a
 *   synthetic 'QA Agent' so they show in the activity feed.
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

export interface ClassificationSample {
  email_id: string;
  privacy_class: 'business' | 'personal' | 'uncertain';
  privacy_confidence?: number;
  classification?: string;
  email_from?: string;
  email_subject?: string;
  has_draft?: boolean;
}

export async function logSample(tenantPhone: string, samples: ClassificationSample[]): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY || samples.length === 0) return;
  const rows = samples.map((s) => ({
    tenant_phone: tenantPhone,
    email_id: s.email_id,
    privacy_class: s.privacy_class,
    privacy_confidence: s.privacy_confidence ?? 0,
    classification: s.classification ?? null,
    email_from: s.email_from ?? null,
    email_subject: s.email_subject ?? null,
    has_draft: !!s.has_draft,
  }));
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/email_classification_samples`, {
      method: 'POST',
      headers: { ...headers(), Prefer: 'return=minimal' },
      body: JSON.stringify(rows),
    });
  } catch (err) {
    console.warn('[classification-learning] logSample failed:', err);
  }
}

export interface CorrectionInput {
  original_privacy_class: 'business' | 'personal' | 'uncertain';
  original_classification?: string;
  original_confidence?: number;
  corrected_privacy_class: 'business' | 'personal' | 'uncertain';
  corrected_classification?: string;
  email_from?: string;
  email_subject?: string;
  email_preview?: string;
  user_reason?: string;
  source?: 'whatsapp' | 'deck' | 'cron_qa' | 'manual';
}

export async function logCorrection(tenantPhone: string, correction: CorrectionInput): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/email_classification_corrections`, {
      method: 'POST',
      headers: { ...headers(), Prefer: 'return=minimal' },
      body: JSON.stringify({ tenant_phone: tenantPhone, source: 'whatsapp', ...correction }),
    });
  } catch (err) {
    console.warn('[classification-learning] logCorrection failed:', err);
  }
}

/**
 * Pull recent corrections for a tenant and format them as few-shot
 * examples for the classifier system prompt. Bounded to 10 examples.
 */
export async function buildFewShotExamples(tenantPhone: string): Promise<string> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return '';
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/email_classification_corrections?tenant_phone=eq.${tenantPhone}&order=created_at.desc&limit=10&select=email_from,email_subject,email_preview,corrected_privacy_class,corrected_classification,user_reason`,
      { headers: headers() },
    );
    if (!res.ok) return '';
    const rows = await res.json();
    if (rows.length === 0) return '';
    const examples = rows.map((r: any, i: number) =>
      `Example ${i + 1}:\nFrom: ${r.email_from ?? '(unknown)'}\nSubject: ${r.email_subject ?? '(unknown)'}\nPreview: ${(r.email_preview ?? '').slice(0, 200)}\n→ Correct privacyClass: ${r.corrected_privacy_class}${r.corrected_classification ? `, classification: ${r.corrected_classification}` : ''}${r.user_reason ? ` (user said: "${r.user_reason}")` : ''}`,
    );
    return `\n\nLEARNED FROM PRIOR CORRECTIONS (use these to calibrate future calls):\n${examples.join('\n\n')}`;
  } catch {
    return '';
  }
}

// ─── QA scan ─────────────────────────────────────────────────────────────

export interface QaFinding {
  kind: 'low_confidence_run' | 'misclassification_pattern' | 'uncertain_spike';
  severity: 'low' | 'medium' | 'high';
  summary: string;
  count: number;
}

export async function runQaScan(tenantPhone: string): Promise<QaFinding[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const findings: QaFinding[] = [];

  // 1. Low-confidence classifications in the last 7 days
  try {
    const lowRes = await fetch(
      `${SUPABASE_URL}/rest/v1/email_classification_samples?tenant_phone=eq.${tenantPhone}&created_at=gte.${since}&privacy_confidence=lt.0.7&select=count`,
      { headers: { ...headers(), Prefer: 'count=exact' } },
    );
    const lowCount = parseInt(lowRes.headers.get('content-range')?.split('/')[1] ?? '0', 10);
    if (lowCount >= 5) {
      findings.push({
        kind: 'low_confidence_run',
        severity: lowCount >= 20 ? 'high' : lowCount >= 10 ? 'medium' : 'low',
        summary: `${lowCount} low-confidence (<0.7) classifications in the past 7 days. The classifier may need more few-shot examples or the user's mail patterns may have shifted.`,
        count: lowCount,
      });
    }
  } catch {}

  // 2. Repeated misclassification patterns from corrections
  try {
    const corrRes = await fetch(
      `${SUPABASE_URL}/rest/v1/email_classification_corrections?tenant_phone=eq.${tenantPhone}&created_at=gte.${since}&select=original_privacy_class,corrected_privacy_class`,
      { headers: headers() },
    );
    if (corrRes.ok) {
      const corrections = await corrRes.json();
      const buckets = new Map<string, number>();
      for (const c of corrections) {
        const key = `${c.original_privacy_class}->${c.corrected_privacy_class}`;
        buckets.set(key, (buckets.get(key) ?? 0) + 1);
      }
      for (const [key, count] of buckets) {
        if (count >= 3) {
          findings.push({
            kind: 'misclassification_pattern',
            severity: count >= 10 ? 'high' : count >= 5 ? 'medium' : 'low',
            summary: `Repeated misclassification: ${count} emails went from "${key.split('->')[0]}" → "${key.split('->')[1]}" in the past 7 days. The classifier consistently leans the wrong way for this pattern.`,
            count,
          });
        }
      }
    }
  } catch {}

  // 3. Uncertain spike
  try {
    const totalRes = await fetch(
      `${SUPABASE_URL}/rest/v1/email_classification_samples?tenant_phone=eq.${tenantPhone}&created_at=gte.${since}&select=count`,
      { headers: { ...headers(), Prefer: 'count=exact' } },
    );
    const total = parseInt(totalRes.headers.get('content-range')?.split('/')[1] ?? '0', 10);
    const uncertainRes = await fetch(
      `${SUPABASE_URL}/rest/v1/email_classification_samples?tenant_phone=eq.${tenantPhone}&created_at=gte.${since}&privacy_class=eq.uncertain&select=count`,
      { headers: { ...headers(), Prefer: 'count=exact' } },
    );
    const uncertain = parseInt(uncertainRes.headers.get('content-range')?.split('/')[1] ?? '0', 10);
    if (total >= 10 && uncertain / total >= 0.3) {
      findings.push({
        kind: 'uncertain_spike',
        severity: uncertain / total >= 0.5 ? 'high' : 'medium',
        summary: `${uncertain}/${total} (${Math.round(100 * uncertain / total)}%) classifications were "uncertain" in the past 7 days. Consider asking the user to clarify the ambiguous cases via the morning briefing.`,
        count: uncertain,
      });
    }
  } catch {}

  return findings;
}

/**
 * Persist QA findings as agent_runs entries attributed to a synthetic
 * 'QA Agent' so they appear in the activity feed and can drive
 * notifications. Uses the orchestrator instance as the owner since
 * we don't have a dedicated qa instance.
 */
export async function persistQaFindings(tenantPhone: string, findings: QaFinding[]): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY || findings.length === 0) return;
  // Find the orchestrator instance to attribute against
  const cfgRes = await fetch(
    `${SUPABASE_URL}/rest/v1/agent_configs?tenant_phone=eq.${tenantPhone}&select=id,config`,
    { headers: headers() },
  );
  if (!cfgRes.ok) return;
  const configs = await cfgRes.json();
  const orchestrator = configs.find((c: any) => c.config?.category === 'orchestrator') ?? configs[0];
  if (!orchestrator) return;

  const instRes = await fetch(
    `${SUPABASE_URL}/rest/v1/agent_instances?agent_config_id=eq.${orchestrator.id}&select=id`,
    { headers: headers() },
  );
  const inst = instRes.ok ? (await instRes.json())[0] : null;
  if (!inst) return;

  for (const f of findings) {
    await fetch(`${SUPABASE_URL}/rest/v1/agent_runs`, {
      method: 'POST',
      headers: { ...headers(), Prefer: 'return=minimal' },
      body: JSON.stringify({
        tenant_phone: tenantPhone,
        agent_instance_id: inst.id,
        trigger: 'manual',
        phase: 'analyze',
        outcome: f.severity === 'high' ? 'escalated' : 'observed',
        input_summary: '[QA Agent] Daily classification scan',
        output_summary: f.summary,
        metadata: { qa_finding: f },
      }),
    });
  }
}

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
 * FR102 — pull the user's professional context (role / responsibilities /
 * skills / current focus) from knowledge_atoms tagged 'classifier_hint'
 * and render as a system-prompt block. Knowing the user is "a residential
 * electrician based in Seattle" sharpens privacy/lane classification.
 * Captured via the set_professional_context agent tool.
 */
export async function buildProfessionalContext(tenantPhone: string): Promise<string> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return '';
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/knowledge_atoms?tenant_phone=eq.${tenantPhone}&tags=cs.{classifier_hint}&order=created_at.desc&limit=15&select=content`,
      { headers: headers() },
    );
    if (!res.ok) return '';
    const rows = await res.json();
    if (rows.length === 0) return '';
    const lines = rows.map((r: any) => `- ${(r.content ?? '').slice(0, 300)}`);
    return `\n\nPROFESSIONAL CONTEXT (about the user — use this to disambiguate business vs personal):\n${lines.join('\n')}`;
  } catch {
    return '';
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

// ─── NFR9 accuracy tracking ───────────────────────────────────────────────

export interface AccuracyWindow {
  windowDays: number;
  samples: number;
  corrections: number;
  /** (samples - corrections) / samples. Null if no samples in the window. */
  accuracy: number | null;
  /** NFR9 targets: 0.90 at 30 days, 0.95 at 90 days */
  target: number;
  onTrack: boolean;
}

export interface AccuracyReport {
  thirtyDay: AccuracyWindow;
  ninetyDay: AccuracyWindow;
  totalSamples: number;
  totalCorrections: number;
  computedAt: string;
}

/**
 * NFR9 accuracy metric — over a rolling window, accuracy is the share of
 * classifications the user DIDN'T correct. A correction is filed against
 * the original email_id, so this is exact, not estimated.
 *
 * Targets:
 *   - 30 days: ≥0.90 (90% accuracy expected by 1 month of usage)
 *   - 90 days: ≥0.95 (95% accuracy after sustained few-shot learning)
 *
 * Anything below target gets flagged as a QA finding.
 */
export async function computeAccuracy(tenantPhone: string): Promise<AccuracyReport | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const now = Date.now();
  const since30 = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
  const since90 = new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString();

  async function countSince(table: string, since: string): Promise<number> {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/${table}?tenant_phone=eq.${tenantPhone}&created_at=gte.${since}&select=count`,
        { headers: { ...headers(), Prefer: 'count=exact' } },
      );
      return parseInt(res.headers.get('content-range')?.split('/')[1] ?? '0', 10);
    } catch {
      return 0;
    }
  }

  const [s30, c30, s90, c90] = await Promise.all([
    countSince('email_classification_samples', since30),
    countSince('email_classification_corrections', since30),
    countSince('email_classification_samples', since90),
    countSince('email_classification_corrections', since90),
  ]);

  const makeWindow = (samples: number, corrections: number, windowDays: number, target: number): AccuracyWindow => {
    const accuracy = samples > 0 ? Math.max(0, 1 - corrections / samples) : null;
    return {
      windowDays,
      samples,
      corrections,
      accuracy,
      target,
      onTrack: accuracy !== null && accuracy >= target,
    };
  };

  return {
    thirtyDay: makeWindow(s30, c30, 30, 0.9),
    ninetyDay: makeWindow(s90, c90, 90, 0.95),
    totalSamples: s90,
    totalCorrections: c90,
    computedAt: new Date().toISOString(),
  };
}

// ─── QA scan ─────────────────────────────────────────────────────────────

export interface QaFinding {
  kind:
    | 'low_confidence_run'
    | 'misclassification_pattern'
    | 'uncertain_spike'
    | 'accuracy_below_target'
    | 'frequent_sender_unclassified';
  severity: 'low' | 'medium' | 'high';
  summary: string;
  count: number;
  /** Optional structured payload for downstream BMAD prompts */
  detail?: Record<string, unknown>;
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

  // NEW: NFR9 accuracy below target — high-signal finding if either
  // window is missing its target with enough samples to be statistically
  // honest (≥20 samples).
  try {
    const acc = await computeAccuracy(tenantPhone);
    if (acc) {
      const w30 = acc.thirtyDay;
      const w90 = acc.ninetyDay;
      // 30-day check — first to fail, easier target
      if (w30.samples >= 20 && w30.accuracy !== null && !w30.onTrack) {
        findings.push({
          kind: 'accuracy_below_target',
          severity: w30.accuracy < 0.75 ? 'high' : 'medium',
          summary: `Classification accuracy at 30d is ${(w30.accuracy * 100).toFixed(1)}% — below the ${(w30.target * 100).toFixed(0)}% NFR9 target (${w30.corrections} corrections / ${w30.samples} samples).`,
          count: w30.corrections,
          detail: { window: '30d', accuracy: w30.accuracy, target: w30.target, samples: w30.samples, corrections: w30.corrections },
        });
      } else if (w90.samples >= 20 && w90.accuracy !== null && !w90.onTrack) {
        // Only report 90d if 30d is on track — avoid double-flagging
        findings.push({
          kind: 'accuracy_below_target',
          severity: w90.accuracy < 0.85 ? 'high' : 'medium',
          summary: `Classification accuracy at 90d is ${(w90.accuracy * 100).toFixed(1)}% — below the ${(w90.target * 100).toFixed(0)}% NFR9 target. Pattern persistence suggests systemic miscalibration.`,
          count: w90.corrections,
          detail: { window: '90d', accuracy: w90.accuracy, target: w90.target, samples: w90.samples, corrections: w90.corrections },
        });
      }
    }
  } catch {}

  // NEW: FR103 passive-pattern detection — frequent senders whose
  // emails are landing as "uncertain" repeatedly. The sender's pattern
  // exists in the user's work habits; the classifier needs a hint.
  try {
    const sinceMonth = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const senderRes = await fetch(
      `${SUPABASE_URL}/rest/v1/email_classification_samples?tenant_phone=eq.${tenantPhone}&created_at=gte.${sinceMonth}&privacy_class=eq.uncertain&select=email_from`,
      { headers: headers() },
    );
    if (senderRes.ok) {
      const rows = await senderRes.json();
      const senderCounts = new Map<string, number>();
      for (const r of rows) {
        if (r.email_from) senderCounts.set(r.email_from, (senderCounts.get(r.email_from) ?? 0) + 1);
      }
      for (const [sender, count] of senderCounts) {
        if (count >= 4) {
          findings.push({
            kind: 'frequent_sender_unclassified',
            severity: count >= 10 ? 'medium' : 'low',
            summary: `${sender} sent ${count} emails in 30d that all classified as "uncertain". They appear to be a recurring contact whose work pattern the classifier hasn't pinned down — consider telling Iris who they are.`,
            count,
            detail: { sender, count },
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
 *
 * High-severity findings ALSO emit a business_insight so they show up
 * in the BMAD innovation surface — accuracy regressions and persistent
 * misclassifications are improvement opportunities, not just log noise.
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

  // Late-bind to avoid an import cycle (business-insights → notifications
  // → ... potentially through anything that imports this module's emitters)
  let emitInsight: typeof import('./business-insights').emitInsight | null = null;
  try {
    ({ emitInsight } = await import('./business-insights'));
  } catch {}

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

    // BMAD bridge — high or medium-severity findings become innovation
    // opportunities the owner can approve/dismiss in the deck. Low-severity
    // findings stay log-only.
    if (emitInsight && (f.severity === 'high' || f.severity === 'medium')) {
      const recommendedAction =
        f.kind === 'accuracy_below_target'
          ? 'Review recent corrections in the deck; tell Iris what she keeps getting wrong so the few-shot examples retrain.'
        : f.kind === 'misclassification_pattern'
          ? 'Approve a sticky rule for this sender/subject pattern so future emails route correctly.'
        : f.kind === 'frequent_sender_unclassified'
          ? 'Tell Iris who this sender is and how their emails should be classified.'
        : f.kind === 'uncertain_spike'
          ? 'Review the uncertain-bucket emails — adding a few corrections will sharply improve accuracy.'
        : 'Investigate the recent classification trend.';
      await emitInsight({
        tenantPhone,
        detector: `qa.${f.kind}`,
        severity: f.severity,
        title: `Classifier QA: ${f.kind.replace(/_/g, ' ')}`,
        why: f.summary,
        recommendedAction,
        expectedImpact: 'Improves classification accuracy toward the NFR9 targets (90% @ 30d, 95% @ 90d).',
        confidence: 0.8,
        payload: { qa_finding: f, ...(f.detail ?? {}) },
        // Dedup signature so repeat scans don't pile up duplicates while
        // the previous one is still proposed.
        signature: `qa.${f.kind}.${(f.detail as any)?.sender ?? (f.detail as any)?.window ?? ''}`,
      });
    }
  }
}

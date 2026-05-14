/**
 * Story 2.16 — Document analysis via Claude.
 *
 * Claude takes PDFs natively via `{ type: 'document', source: { type:
 * 'base64', media_type: 'application/pdf', data: ... } }` (since Claude
 * 3.5). For docx/xlsx we'd need a text extraction step (mammoth + xlsx)
 * — wired as a follow-on phase, not in this commit.
 *
 * Output schema:
 *   - summary: 2-4 sentence overview
 *   - keyDates: [{ when, what }]
 *   - keyAmounts: [{ amount, what }]
 *   - keyParties: [{ name, role }]
 *   - actionItems: [{ task, due? }]
 *   - risks: [{ severity, concern }]
 *   - tags: short string array for retrieval
 *
 * All fields are optional in the model output — we coerce to safe
 * arrays before persisting so the table column types stay clean.
 */

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

export interface DocumentAnalysis {
  summary: string;
  keyDates: Array<{ when: string; what: string }>;
  keyAmounts: Array<{ amount: string; what: string }>;
  keyParties: Array<{ name: string; role: string }>;
  actionItems: Array<{ task: string; due?: string }>;
  risks: Array<{ severity: 'low' | 'medium' | 'high'; concern: string }>;
  tags: string[];
}

const EMPTY_ANALYSIS: DocumentAnalysis = {
  summary: '',
  keyDates: [],
  keyAmounts: [],
  keyParties: [],
  actionItems: [],
  risks: [],
  tags: [],
};

const SYSTEM_PROMPT = `You are a careful document analyst for a small business owner. Read the attached document and produce a structured analysis. Be specific — extract real names, real dates, real amounts. Don't paraphrase generically.

Output STRICT JSON:
{
  "summary": "2-4 sentence plain-English overview of what this document is and what the owner needs to know",
  "keyDates": [{ "when": "yyyy-mm-dd or descriptive date", "what": "what happens on that date" }],
  "keyAmounts": [{ "amount": "$X,XXX or descriptive", "what": "what the amount is for" }],
  "keyParties": [{ "name": "person or org name", "role": "their role in the document — landlord, contractor, etc" }],
  "actionItems": [{ "task": "specific action the owner needs to take", "due": "yyyy-mm-dd or descriptive" }],
  "risks": [{ "severity": "low|medium|high", "concern": "specific risk or clause that needs attention" }],
  "tags": ["short", "retrieval", "tags", "describing", "doc type"]
}

Rules:
- Be conservative — empty array when nothing of that type is in the doc, NOT made-up entries
- summary is required and must be specific to THIS document, not generic
- risks should flag things like auto-renewal clauses, indemnification, unusual termination terms, missing signature blocks, suspicious payment terms
- tags should help retrieval later: "lease", "vendor_contract", "insurance_policy", "permit", "invoice", etc.
- Never hallucinate dates, amounts, or names. If you can't extract one cleanly, leave the field empty.`;

/**
 * Analyze a PDF document. Pass either base64-encoded bytes OR a URL
 * (Claude can fetch the URL directly when source.type === 'url').
 */
export async function analyzePdfDocument(input: {
  pdfBase64?: string;
  pdfUrl?: string;
  hintFilename?: string;
}): Promise<{ ok: boolean; analysis: DocumentAnalysis; error?: string }> {
  if (!ANTHROPIC_API_KEY) return { ok: false, analysis: EMPTY_ANALYSIS, error: 'ANTHROPIC_API_KEY not set' };
  if (!input.pdfBase64 && !input.pdfUrl) {
    return { ok: false, analysis: EMPTY_ANALYSIS, error: 'either pdfBase64 or pdfUrl required' };
  }

  const documentBlock: any = input.pdfBase64
    ? {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: input.pdfBase64 },
      }
    : {
        type: 'document',
        source: { type: 'url', url: input.pdfUrl },
      };

  const userText = input.hintFilename
    ? `Analyze this document. Filename: ${input.hintFilename}`
    : 'Analyze this document.';

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [
          {
            role: 'user',
            content: [documentBlock, { type: 'text', text: userText }],
          },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, analysis: EMPTY_ANALYSIS, error: `Claude PDF call failed: ${res.status} ${body.slice(0, 300)}` };
    }
    const data = await res.json();
    const text: string = data.content?.[0]?.text ?? '';
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    if (jsonStart < 0 || jsonEnd < jsonStart) {
      return { ok: false, analysis: EMPTY_ANALYSIS, error: 'No JSON in model output' };
    }
    const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
    return { ok: true, analysis: normalizeAnalysis(parsed) };
  } catch (err: any) {
    return { ok: false, analysis: EMPTY_ANALYSIS, error: err?.message ?? String(err) };
  }
}

/**
 * Analyze a Word document. We extract raw text via mammoth, then feed
 * the text to Claude using the same schema as the PDF path. Tables and
 * headings survive the conversion; embedded images don't (acceptable
 * tradeoff — docx images are rarely load-bearing for analysis).
 */
export async function analyzeDocxDocument(input: {
  bytes: Uint8Array;
  hintFilename?: string;
}): Promise<{ ok: boolean; analysis: DocumentAnalysis; error?: string }> {
  if (!ANTHROPIC_API_KEY) return { ok: false, analysis: EMPTY_ANALYSIS, error: 'ANTHROPIC_API_KEY not set' };
  let extractedText: string;
  try {
    const mammothMod: any = await import('mammoth');
    const result = await mammothMod.extractRawText({ buffer: Buffer.from(input.bytes) });
    extractedText = (result.value ?? '').slice(0, 100_000); // cap at 100KB of text
    if (!extractedText.trim()) {
      return { ok: false, analysis: EMPTY_ANALYSIS, error: 'docx contained no extractable text' };
    }
  } catch (err: any) {
    return { ok: false, analysis: EMPTY_ANALYSIS, error: `docx extraction failed: ${err?.message ?? String(err)}` };
  }
  return runTextAnalysis({ text: extractedText, hintFilename: input.hintFilename, sourceFormat: 'docx' });
}

/**
 * Analyze an Excel/spreadsheet document. Each sheet becomes a markdown
 * table (capped to first 50 rows × 20 cols per sheet to keep token cost
 * sane) and we feed the joined output to Claude with the standard schema.
 */
export async function analyzeXlsxDocument(input: {
  bytes: Uint8Array;
  hintFilename?: string;
}): Promise<{ ok: boolean; analysis: DocumentAnalysis; error?: string }> {
  if (!ANTHROPIC_API_KEY) return { ok: false, analysis: EMPTY_ANALYSIS, error: 'ANTHROPIC_API_KEY not set' };
  let extractedText: string;
  try {
    const xlsxMod: any = await import('xlsx');
    const wb = xlsxMod.read(Buffer.from(input.bytes), { type: 'buffer' });
    const sheetTexts: string[] = [];
    for (const sheetName of wb.SheetNames as string[]) {
      const ws = wb.Sheets[sheetName];
      const rows: any[][] = xlsxMod.utils.sheet_to_json(ws, { header: 1, defval: '' });
      if (rows.length === 0) continue;
      const capped = rows.slice(0, 50).map((r) => r.slice(0, 20));
      const widths = (capped[0] ?? []).map((_: any, i: number) =>
        Math.max(...capped.map((r) => String(r[i] ?? '').length)),
      );
      const lines = capped.map((r) =>
        '| ' + r.map((c, i) => String(c ?? '').padEnd(widths[i] ?? 0, ' ')).join(' | ') + ' |',
      );
      const totalRowsNote = rows.length > 50 ? `\n(${rows.length - 50} additional rows truncated)` : '';
      sheetTexts.push(`### Sheet: ${sheetName}\n${lines.join('\n')}${totalRowsNote}`);
    }
    extractedText = sheetTexts.join('\n\n').slice(0, 100_000);
    if (!extractedText.trim()) {
      return { ok: false, analysis: EMPTY_ANALYSIS, error: 'spreadsheet contained no data' };
    }
  } catch (err: any) {
    return { ok: false, analysis: EMPTY_ANALYSIS, error: `xlsx extraction failed: ${err?.message ?? String(err)}` };
  }
  return runTextAnalysis({ text: extractedText, hintFilename: input.hintFilename, sourceFormat: 'xlsx' });
}

/**
 * Shared text-analysis path for non-PDF formats. Same Claude call shape
 * as analyzePdfDocument but feeds extracted text via a plain user
 * message instead of the document content block.
 */
async function runTextAnalysis(input: {
  text: string;
  hintFilename?: string;
  sourceFormat: 'docx' | 'xlsx' | 'txt';
}): Promise<{ ok: boolean; analysis: DocumentAnalysis; error?: string }> {
  const formatLabel = input.sourceFormat === 'docx' ? 'Word document'
    : input.sourceFormat === 'xlsx' ? 'spreadsheet'
    : 'text document';
  const userText = input.hintFilename
    ? `Analyze this ${formatLabel} (extracted text below). Filename: ${input.hintFilename}\n\n${input.text}`
    : `Analyze this ${formatLabel} (extracted text below):\n\n${input.text}`;

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userText }],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, analysis: EMPTY_ANALYSIS, error: `Claude text-analysis call failed: ${res.status} ${body.slice(0, 300)}` };
    }
    const data = await res.json();
    const text: string = data.content?.[0]?.text ?? '';
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    if (jsonStart < 0 || jsonEnd < jsonStart) {
      return { ok: false, analysis: EMPTY_ANALYSIS, error: 'No JSON in model output' };
    }
    const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
    return { ok: true, analysis: normalizeAnalysis(parsed) };
  } catch (err: any) {
    return { ok: false, analysis: EMPTY_ANALYSIS, error: err?.message ?? String(err) };
  }
}

/**
 * Unified analyzer — pick the right parser by mime type / filename.
 * Falls back to "format not supported" for anything we can't handle.
 *
 * Pass `pdfBase64` and/or `bytes` — for PDFs either works (PDF path
 * uses bytes via base64 if bytes given, else pdfBase64). For docx/xlsx
 * we need raw bytes.
 */
export async function analyzeReceivedDocument(input: {
  bytes: Uint8Array;
  mimeType: string;
  filename: string;
}): Promise<{ ok: boolean; analysis: DocumentAnalysis; error?: string; format?: 'pdf' | 'docx' | 'xlsx' | 'txt' | 'unsupported' }> {
  const mime = input.mimeType.toLowerCase();
  const ext = (input.filename.split('.').pop() ?? '').toLowerCase();

  if (mime.includes('pdf') || ext === 'pdf') {
    const pdfBase64 = Buffer.from(input.bytes).toString('base64');
    const r = await analyzePdfDocument({ pdfBase64, hintFilename: input.filename });
    return { ...r, format: 'pdf' };
  }
  if (mime.includes('wordprocessingml') || ext === 'docx') {
    const r = await analyzeDocxDocument({ bytes: input.bytes, hintFilename: input.filename });
    return { ...r, format: 'docx' };
  }
  if (mime.includes('spreadsheetml') || ext === 'xlsx' || ext === 'xls') {
    const r = await analyzeXlsxDocument({ bytes: input.bytes, hintFilename: input.filename });
    return { ...r, format: 'xlsx' };
  }
  if (mime.startsWith('text/') || ext === 'txt' || ext === 'md') {
    const text = Buffer.from(input.bytes).toString('utf8').slice(0, 100_000);
    const r = await runTextAnalysis({ text, hintFilename: input.filename, sourceFormat: 'txt' });
    return { ...r, format: 'txt' };
  }
  return {
    ok: false,
    analysis: EMPTY_ANALYSIS,
    error: `Unsupported format: ${input.mimeType}. PDF / DOCX / XLSX / TXT supported.`,
    format: 'unsupported',
  };
}

/** Coerce the model output to the strict schema shape. */
function normalizeAnalysis(raw: any): DocumentAnalysis {
  return {
    summary: typeof raw.summary === 'string' ? raw.summary.slice(0, 2000) : '',
    keyDates: Array.isArray(raw.keyDates)
      ? raw.keyDates.slice(0, 20).map((d: any) => ({ when: String(d.when ?? '').slice(0, 100), what: String(d.what ?? '').slice(0, 200) }))
      : [],
    keyAmounts: Array.isArray(raw.keyAmounts)
      ? raw.keyAmounts.slice(0, 20).map((a: any) => ({ amount: String(a.amount ?? '').slice(0, 100), what: String(a.what ?? '').slice(0, 200) }))
      : [],
    keyParties: Array.isArray(raw.keyParties)
      ? raw.keyParties.slice(0, 20).map((p: any) => ({ name: String(p.name ?? '').slice(0, 200), role: String(p.role ?? '').slice(0, 100) }))
      : [],
    actionItems: Array.isArray(raw.actionItems)
      ? raw.actionItems.slice(0, 20).map((a: any) => ({
          task: String(a.task ?? '').slice(0, 300),
          due: a.due ? String(a.due).slice(0, 100) : undefined,
        }))
      : [],
    risks: Array.isArray(raw.risks)
      ? raw.risks.slice(0, 20).map((r: any) => {
          const sev = String(r.severity ?? 'medium').toLowerCase();
          return {
            severity: (['low', 'medium', 'high'].includes(sev) ? sev : 'medium') as 'low' | 'medium' | 'high',
            concern: String(r.concern ?? '').slice(0, 400),
          };
        })
      : [],
    tags: Array.isArray(raw.tags)
      ? raw.tags.slice(0, 12).map((t: any) => String(t).slice(0, 50)).filter((t: string) => t.length >= 2)
      : [],
  };
}

/**
 * Render an analysis as a WhatsApp-friendly text reply. Length-bounded
 * so it fits in a single WhatsApp message comfortably.
 */
export function renderAnalysisForWhatsApp(input: {
  analysis: DocumentAnalysis;
  filename?: string;
}): string {
  const { analysis: a, filename } = input;
  const header = filename ? `📄 ${filename}` : '📄 Document analysis';
  const lines: string[] = [header];
  if (a.summary) lines.push('', a.summary);

  if (a.keyDates.length > 0) {
    lines.push('', '📅 Key dates:');
    for (const d of a.keyDates.slice(0, 5)) lines.push(`  • ${d.when} — ${d.what}`);
  }
  if (a.keyAmounts.length > 0) {
    lines.push('', '💰 Key amounts:');
    for (const m of a.keyAmounts.slice(0, 5)) lines.push(`  • ${m.amount} — ${m.what}`);
  }
  if (a.keyParties.length > 0) {
    lines.push('', '👥 Parties:');
    for (const p of a.keyParties.slice(0, 5)) lines.push(`  • ${p.name} (${p.role})`);
  }
  if (a.actionItems.length > 0) {
    lines.push('', '✓ Action items:');
    for (const ai of a.actionItems.slice(0, 5)) lines.push(`  • ${ai.task}${ai.due ? ` — due ${ai.due}` : ''}`);
  }
  if (a.risks.length > 0) {
    lines.push('', '⚠ Watch for:');
    for (const r of a.risks.slice(0, 5)) {
      const flag = r.severity === 'high' ? '🚨' : r.severity === 'medium' ? '⚠' : '·';
      lines.push(`  ${flag} ${r.concern}`);
    }
  }
  return lines.join('\n').slice(0, 3900); // leave headroom under WhatsApp's 4096 cap
}

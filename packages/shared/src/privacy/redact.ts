/**
 * PII redaction for capture paths (chat_runs previews, disposition evidence,
 * agent_runs summaries, lessons_learned). Replaces emails / phones / SSNs /
 * credit-cards / addresses with type markers so the stored row still has
 * semantic shape (you can tell something was redacted, and what type) but
 * the raw PII never lands in a long-lived row.
 *
 * Story 6.5 (privacy boundary generalized). Designed to be the SINGLE
 * sanitization point for any write that captures owner / visitor / customer
 * free-text content into long-lived storage.
 *
 * Scope intentionally narrow:
 *   - Operational text (previews, summaries, evidence) — YES redact
 *   - Working data the agents need verbatim (knowledge_atoms.content with
 *     a name in it, received_documents.summary that legitimately stores
 *     contract parties) — NO, do not redact at this layer. Those tables
 *     have their own privacy policies handled elsewhere.
 *
 * Hash-based stable masking (so "jane@acme.com" maps to the same marker
 * each time, enabling "is this the same person?" without revealing the
 * address) is a v2 feature — not included here.
 */

export type PiiCategory = 'email' | 'phone' | 'ssn' | 'credit_card' | 'address' | 'ip';

export interface RedactionResult {
  /** Text with PII replaced by [TYPE] markers. */
  redacted: string;
  /** Per-category hit counts, useful for telemetry / "this row contained PII" flags. */
  hits: Record<PiiCategory, number>;
  /** True if ANY redaction was applied. */
  redactedAny: boolean;
}

// Email: well-known pattern, intentionally permissive on TLD (catches .museum etc.)
const EMAIL_RE = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g;

// US-shaped phone numbers. Doesn't try to validate area codes — just shapes
// that look like phones. Tolerates parens, dashes, dots, spaces, optional +1.
const PHONE_RE = /(?:\+?1[\s\-.]?)?\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}\b/g;

// SSN — XXX-XX-XXXX. Doesn't match bare 9-digit numbers (too many false positives).
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;

// Credit card — 13-19 digits, optionally space/dash separated. Validates via
// Luhn (below) to avoid false positives on order numbers / IDs.
const CC_RE = /\b(?:\d[ \-]?){13,19}\b/g;

// IPv4. Useful for log lines that paste a client IP.
const IPV4_RE = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;

// Street address — heuristic: number + word + (St|Ave|Blvd|Rd|Dr|Ln|Way|Ct|Pl) + optional suite. Crude
// but catches the common case. Misses international formats.
const STREET_RE = /\b\d{1,6}\s+[A-Za-z0-9.\-\s]{1,40}?\b(?:Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Drive|Dr|Lane|Ln|Way|Court|Ct|Place|Pl|Parkway|Pkwy|Highway|Hwy)\b\.?(?:\s+(?:Suite|Ste|Apt|Unit|#)\s*\w+)?/gi;

/** Luhn check — used to filter credit-card false-positives. */
function isLuhnValid(digits: string): boolean {
  const d = digits.replace(/[^0-9]/g, '');
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = Number(d[i]);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export function redactPII(input: string | null | undefined): RedactionResult {
  const hits: Record<PiiCategory, number> = {
    email: 0, phone: 0, ssn: 0, credit_card: 0, address: 0, ip: 0,
  };
  if (!input) return { redacted: input ?? '', hits, redactedAny: false };

  let text = input;

  text = text.replace(EMAIL_RE, () => {
    hits.email++;
    return '[EMAIL]';
  });

  text = text.replace(SSN_RE, () => {
    hits.ssn++;
    return '[SSN]';
  });

  // CC before phone — credit-card pattern is more specific (with Luhn).
  text = text.replace(CC_RE, (match) => {
    if (isLuhnValid(match)) {
      hits.credit_card++;
      return '[CARD]';
    }
    return match;
  });

  text = text.replace(PHONE_RE, () => {
    hits.phone++;
    return '[PHONE]';
  });

  text = text.replace(STREET_RE, () => {
    hits.address++;
    return '[ADDRESS]';
  });

  text = text.replace(IPV4_RE, () => {
    hits.ip++;
    return '[IP]';
  });

  const redactedAny =
    hits.email + hits.phone + hits.ssn + hits.credit_card + hits.address + hits.ip > 0;

  return { redacted: text, hits, redactedAny };
}

/** Convenience: redact and return the string only — for callers that don't care about hit counts. */
export function redactPIIText(input: string | null | undefined): string {
  return redactPII(input).redacted;
}

/**
 * Fuzzy dedup for task ontology entities.
 *
 * ontology_entities has UNIQUE (tenant_phone, entity_type, name) + ON CONFLICT
 * DO UPDATE, so EXACT-name task dups can't occur. But the email classifier
 * phrases the same underlying task differently across emails ("Review MGT 6305
 * Unit VI lecture" vs "Watch Unit VI lecture"), so near-duplicates pile up in
 * the task queue (Devon saw the same lecture 4×, a PR and an invoice 2× each).
 *
 * This is a deliberately CONSERVATIVE token-overlap matcher — not embeddings
 * (overkill for short task strings) and tuned to avoid the dangerous failure:
 * merging two genuinely different short tasks that happen to share one word
 * ("call Ron" vs "email Ron" must NOT merge). Hence: require ≥2 shared
 * significant tokens AND Jaccard ≥ 0.6. Action verbs are KEPT so "call" vs
 * "email" differentiate.
 */

const STOPWORDS = new Set([
  'the', 'a', 'an', 'to', 'for', 'of', 'on', 'in', 'and', 'or', 'with', 'my',
  'your', 'this', 'that', 'is', 'are', 'be', 'please', 're', 'fwd', 'about',
  'from', 'by', 'at', 'as', 'it', 'we', 'you', 'our',
]);

/** Significant tokens of a task name: lowercased, punctuation stripped (# kept
 *  for PR/issue refs), short words + stopwords dropped. */
export function taskTokens(name: string): string[] {
  return (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9#\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/** True when two task names refer to the same underlying task. Conservative:
 *  needs ≥2 shared significant tokens AND Jaccard ≥ 0.6 — so word-order/verb/
 *  punctuation variants of one task collapse, but two distinct short tasks that
 *  merely share a single word do not. */
export function tasksAreDuplicate(a: string, b: string): boolean {
  const sa = new Set(taskTokens(a));
  const sb = new Set(taskTokens(b));
  if (sa.size === 0 || sb.size === 0) return false;
  let shared = 0;
  for (const t of sa) if (sb.has(t)) shared++;
  if (shared < 2) return false;
  const union = new Set([...sa, ...sb]).size;
  return shared / union >= 0.6;
}

/** Is `name` a duplicate of any name already in `existing`? */
export function isDuplicateOfAny(name: string, existing: Iterable<string>): boolean {
  for (const e of existing) {
    if (tasksAreDuplicate(name, e)) return true;
  }
  return false;
}

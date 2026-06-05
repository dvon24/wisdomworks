/**
 * One-time backfill: embed existing knowledge atoms + collapse the historical
 * pile-up. The semantic-dedup migration (2026-06-05) makes NEW saves dedup, but
 * old atoms have NULL embedding so they can't be matched until embedded — and
 * the existing duplicates (the 2026-06-05 transcript's IL5/IL6 x4, vision x4,
 * Headspace x3-with-conflicting-scopes) are already in the DB.
 *
 * This pass, per tenant:
 *   1. embeds every active atom that lacks an embedding,
 *   2. as it goes, collapses any atom that is semantically identical (cosine
 *      >= 0.88) to one already kept — the EARLIER/owner-confirmed/higher-
 *      confidence atom is the canonical; the later duplicate is archived and
 *      its tags merged in.
 *
 * dryRun=true (the default) writes NOTHING — it returns exactly what WOULD be
 * embedded + collapsed so the owner reviews before committing. Run dryRun
 * first, eyeball the collapses, then run with dryRun=false.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const sb = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

const SIM_THRESHOLD = 0.78; // matches the upsert RPC (retuned 0.88→0.78, validated 2026-06-05 on real phrasings)

interface AtomRow {
  id: string;
  content: string;
  kind: string;
  tags: string[] | null;
  owner_confirmed: boolean;
  confidence: number;
  created_at: string;
  embedding: unknown; // present-or-null; we only care whether it's set
}

export interface BackfillCollapse {
  canonical_id: string;
  dup_id: string;
  similarity: number;
  canonical: string;
  dup: string;
}

export interface BackfillReport {
  tenant_phone: string;
  dry_run: boolean;
  total_active: number;
  embedded: number;
  collapsed: number;
  collapses: BackfillCollapse[];
  errors: string[];
  summary: string;
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!; // OpenAI vectors are normalized → dot == cosine
  return s;
}

function mergedTags(a: string[] | null, b: string[] | null): string[] {
  const set = new Set([...(a ?? []), ...(b ?? [])].map((t) => String(t).toLowerCase()));
  // A deliberate scope beats a stale 'general': if any specific tag survives,
  // drop 'general' so the merge can't re-broadcast a now-scoped fact.
  if (set.size > 1) set.delete('general');
  return Array.from(set);
}

/** Backfill embeddings + collapse historical duplicates for one tenant. */
export async function backfillAtomEmbeddings(args: {
  tenantPhone: string;
  dryRun?: boolean;
}): Promise<BackfillReport> {
  const tenant = args.tenantPhone.replace(/[\s\-+()]/g, '');
  const dryRun = args.dryRun !== false; // default TRUE
  const base: BackfillReport = { tenant_phone: tenant, dry_run: dryRun, total_active: 0, embedded: 0, collapsed: 0, collapses: [], errors: [], summary: '' };
  if (!SUPABASE_URL || !SUPABASE_KEY) return { ...base, summary: 'supabase not configured' };

  // Canonical ordering: owner-confirmed + higher confidence + OLDER win, so the
  // duplicate that arrives later is the one archived.
  let atoms: AtomRow[] = [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_knowledge_atoms?tenant_phone=eq.${encodeURIComponent(tenant)}&status=eq.active&order=owner_confirmed.desc,confidence.desc,created_at.asc&select=id,content,kind,tags,owner_confirmed,confidence,created_at,embedding&limit=2000`,
      { headers: sb() },
    );
    if (!res.ok) return { ...base, summary: `load failed: ${res.status}` };
    atoms = await res.json();
  } catch (err) {
    return { ...base, summary: `load failed: ${String(err)}` };
  }
  base.total_active = atoms.length;
  if (atoms.length === 0) return { ...base, summary: 'no active atoms' };

  // Embed all contents up front (one batched call path).
  let vectors: number[][];
  try {
    const { embedBatch } = await import('./embeddings');
    const results = await embedBatch(atoms.map((a) => a.content.slice(0, 600)));
    vectors = results.map((r) => r.embedding);
    if (vectors.length !== atoms.length) {
      return { ...base, summary: `embed count mismatch: ${vectors.length} vs ${atoms.length}` };
    }
  } catch (err) {
    return { ...base, summary: `embedding failed: ${String(err)}` };
  }

  const kept: Array<{ id: string; content: string; tags: string[] | null; ownerConfirmed: boolean; vec: number[] }> = [];

  for (let i = 0; i < atoms.length; i++) {
    const a = atoms[i]!;
    const vec = vectors[i]!;
    // Find a semantically-identical kept atom.
    let match: typeof kept[number] | null = null;
    let bestSim = 0;
    for (const k of kept) {
      const sim = dot(vec, k.vec);
      if (sim >= SIM_THRESHOLD && sim > bestSim) { bestSim = sim; match = k; }
    }

    if (match) {
      // Duplicate → collapse into the canonical.
      base.collapsed++;
      base.collapses.push({ canonical_id: match.id, dup_id: a.id, similarity: Number(bestSim.toFixed(4)), canonical: match.content.slice(0, 80), dup: a.content.slice(0, 80) });
      if (!dryRun) {
        try {
          // Merge tags + owner_confirmed into the canonical, then archive the dup.
          const merged = mergedTags(match.tags, a.tags);
          match.tags = merged;
          match.ownerConfirmed = match.ownerConfirmed || a.owner_confirmed;
          await fetch(`${SUPABASE_URL}/rest/v1/tenant_knowledge_atoms?id=eq.${match.id}`, {
            method: 'PATCH', headers: { ...sb(), Prefer: 'return=minimal' },
            body: JSON.stringify({ tags: merged, owner_confirmed: match.ownerConfirmed, updated_at: new Date().toISOString() }),
          });
          await fetch(`${SUPABASE_URL}/rest/v1/tenant_knowledge_atoms?id=eq.${a.id}`, {
            method: 'PATCH', headers: { ...sb(), Prefer: 'return=minimal' },
            body: JSON.stringify({ status: 'archived', updated_at: new Date().toISOString() }),
          });
        } catch (err) {
          base.errors.push(`collapse ${a.id}: ${String(err)}`);
        }
      }
    } else {
      // Unique → keep + set its embedding (if not already set).
      base.embedded++;
      kept.push({ id: a.id, content: a.content, tags: a.tags, ownerConfirmed: a.owner_confirmed, vec });
      if (!dryRun) {
        try {
          await fetch(`${SUPABASE_URL}/rest/v1/tenant_knowledge_atoms?id=eq.${a.id}`, {
            method: 'PATCH', headers: { ...sb(), Prefer: 'return=minimal' },
            body: JSON.stringify({ embedding: `[${vec.join(',')}]`, updated_at: new Date().toISOString() }),
          });
        } catch (err) {
          base.errors.push(`embed ${a.id}: ${String(err)}`);
        }
      }
    }
  }

  base.summary = `${dryRun ? 'DRY RUN — ' : ''}${atoms.length} active atoms → ${base.embedded} kept/embedded, ${base.collapsed} collapsed as duplicates${base.errors.length ? `, ${base.errors.length} errors` : ''}`;
  return base;
}

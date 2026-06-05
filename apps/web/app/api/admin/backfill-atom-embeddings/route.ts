/**
 * POST /api/admin/backfill-atom-embeddings  { phone, dryRun? }
 *   Authorization: Bearer OWNER_API_TOKEN
 *
 * One-time: embed a tenant's existing knowledge atoms + collapse the historical
 * duplicate pile-up (the semantic-dedup migration only fixes NEW saves; old
 * atoms have no embedding and the existing dups are already in the DB).
 *
 * dryRun defaults TRUE — writes NOTHING, returns exactly what WOULD be embedded
 * + collapsed. Run it dry first, review `collapses`, then re-run with
 * { "dryRun": false } to commit.
 *
 * Needs the OpenAI key (embeddings), so run it against the DEPLOYED app — the
 * local env's OPENAI_API_KEY is empty.
 */

import { backfillAtomEmbeddings } from '../../_lib/atom-embedding-backfill';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(request: Request) {
  const auth = request.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!process.env.OWNER_API_TOKEN || token !== process.env.OWNER_API_TOKEN) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }
  const phone = String(body?.phone ?? '').trim();
  if (!phone) return Response.json({ error: 'phone required' }, { status: 400 });
  const dryRun = body?.dryRun !== false; // default true — never write unless explicitly told

  const report = await backfillAtomEmbeddings({ tenantPhone: phone, dryRun });
  return Response.json(report, { status: 200 });
}

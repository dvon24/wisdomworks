/**
 * Story 2.10 — Agent State Persistence & Recovery.
 *
 * Backup architecture for the Vercel + Supabase stack:
 *
 *   PRIMARY (Supabase-native)
 *     - Free tier: daily backups, 7-day retention
 *     - Pro tier:  daily backups, 28-day retention + PITR (point-in-time)
 *     - This IS the primary recovery mechanism. Supabase handles it
 *       for us; we don't need to reimplement it.
 *
 *   INSURANCE (this module)
 *     - Daily JSON snapshots of critical tenant tables written to a
 *       separate Supabase Storage bucket. Survives account-level
 *       events, accidental cascade deletes, and cross-region failures
 *       in a way that DB-native backups don't.
 *     - Tables snapshotted: tenant_configs, agent_configs,
 *       agent_instances (with state_data), whatsapp_contexts,
 *       tenant_knowledge_atoms, tenant_email_indexing_prefs.
 *     - NOT snapshotted: agent_runs / chat_runs / knowledge_chunks /
 *       email_engagement_signals — too large + regenerable from
 *       source data via existing crons.
 *
 *   RECOVERY POSTURE
 *     - First-line: Supabase Dashboard → restore from backup
 *     - Second-line: download the JSON snapshot from
 *       `tenant-snapshots/{phone}/YYYY-MM-DD.json`, hand-restore via
 *       the admin restore endpoint (Phase 2.10b, not yet built)
 *
 * Bucket name: `tenant-snapshots` — owner must create it ONCE in
 * Supabase Storage with public read DISABLED (snapshots contain
 * tenant config + atoms; service role only). Mirror the
 * `generated-docs` setup pattern but inverted on the public flag.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'tenant-snapshots';

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

export interface TenantSnapshot {
  tenant_phone: string;
  snapshot_at: string;
  /** Versioned so a future restore endpoint knows what shape it's reading. */
  snapshot_version: 1;
  tables: {
    tenant_configs: any[];
    agent_configs: any[];
    agent_instances: any[];
    whatsapp_contexts: any[];
    tenant_knowledge_atoms: any[];
    tenant_email_indexing_prefs: any[];
  };
  row_counts: Record<string, number>;
  /** Bytes of the serialized JSON — useful for storage accounting. */
  size_bytes: number;
}

const SNAPSHOTTED_TABLES = [
  'tenant_configs',
  'agent_configs',
  'agent_instances',
  'whatsapp_contexts',
  'tenant_knowledge_atoms',
  'tenant_email_indexing_prefs',
] as const;

type SnapshotTableName = (typeof SNAPSHOTTED_TABLES)[number];

/**
 * Fetch every row for the given table belonging to this tenant. Uses
 * the standard PostgREST `?tenant_phone=eq.X` filter on most tables;
 * `whatsapp_contexts` uses `phone_number` instead.
 */
async function fetchTenantRows(table: SnapshotTableName, cleanPhone: string): Promise<any[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const filterCol = table === 'whatsapp_contexts' ? 'phone_number' : 'tenant_phone';
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/${table}?${filterCol}=eq.${cleanPhone}&select=*`,
      { headers: headers() },
    );
    if (!res.ok) {
      console.warn(`[tenant-snapshots] ${table} fetch failed for ${cleanPhone}: ${res.status}`);
      return [];
    }
    return await res.json();
  } catch (err) {
    console.warn(`[tenant-snapshots] ${table} fetch exception for ${cleanPhone}:`, err);
    return [];
  }
}

/**
 * Build + upload today's snapshot for a tenant. Idempotent — if a
 * snapshot for today already exists, returns its size without
 * re-uploading (unless `force=true` is passed).
 */
export async function snapshotTenant(
  tenantPhone: string,
  options: { force?: boolean } = {},
): Promise<{ ok: boolean; reason?: string; path?: string; size_bytes?: number; row_counts?: Record<string, number> }> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { ok: false, reason: 'Supabase not configured' };
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const path = `${cleanPhone}/${yyyy}-${mm}-${dd}.json`;

  // Check if today's snapshot already exists (HEAD on the storage path)
  if (!options.force) {
    try {
      const headRes = await fetch(`${SUPABASE_URL}/storage/v1/object/info/${BUCKET}/${path}`, {
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      });
      if (headRes.ok) {
        const info = await headRes.json().catch(() => null);
        return {
          ok: true,
          reason: 'already_exists_today',
          path,
          size_bytes: info?.size ?? undefined,
        };
      }
    } catch {
      // Existence check failed — proceed with snapshot regardless
    }
  }

  // Build the snapshot
  const tables: TenantSnapshot['tables'] = {
    tenant_configs: [],
    agent_configs: [],
    agent_instances: [],
    whatsapp_contexts: [],
    tenant_knowledge_atoms: [],
    tenant_email_indexing_prefs: [],
  };
  const row_counts: Record<string, number> = {};
  for (const table of SNAPSHOTTED_TABLES) {
    const rows = await fetchTenantRows(table, cleanPhone);
    tables[table] = rows;
    row_counts[table] = rows.length;
  }

  const snapshot: TenantSnapshot = {
    tenant_phone: cleanPhone,
    snapshot_at: now.toISOString(),
    snapshot_version: 1,
    tables,
    row_counts,
    size_bytes: 0,
  };
  const json = JSON.stringify(snapshot);
  snapshot.size_bytes = Buffer.byteLength(json, 'utf8');

  // Upload to the private snapshots bucket. Reuses the
  // Buffer-pool-safe upload pattern shipped 2026-05-15.
  try {
    const buf = Buffer.from(json, 'utf8');
    const view = new Uint8Array(buf.byteLength);
    view.set(buf);
    const uploadRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`,
      {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'x-upsert': options.force ? 'true' : 'false',
        },
        body: new Blob([view], { type: 'application/json' }),
      },
    );
    if (!uploadRes.ok) {
      const body = await uploadRes.text().catch(() => '<no body>');
      if (uploadRes.status === 404 || body.includes('Bucket not found')) {
        return {
          ok: false,
          reason: `Bucket "${BUCKET}" does not exist. Owner must create it in Supabase Dashboard → Storage → New bucket (PUBLIC READ DISABLED — snapshots contain tenant config).`,
        };
      }
      return { ok: false, reason: `Upload failed: ${uploadRes.status} ${body.slice(0, 200)}` };
    }
    return {
      ok: true,
      path,
      size_bytes: snapshot.size_bytes,
      row_counts,
    };
  } catch (err: any) {
    return { ok: false, reason: `Exception: ${err?.message ?? String(err)}` };
  }
}

/**
 * List recent snapshots for a tenant by querying the storage bucket
 * directly. Returns metadata + paths so the admin endpoint can render
 * "you have N snapshots, last one DATE, total size MB".
 */
export interface SnapshotListItem {
  name: string;
  created_at: string;
  size: number;
  path: string;
}

export async function listTenantSnapshots(tenantPhone: string): Promise<SnapshotListItem[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const cleanPhone = tenantPhone.replace(/[\s\-+()]/g, '');
  try {
    const res = await fetch(
      `${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`,
      {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prefix: `${cleanPhone}/`,
          limit: 100,
          sortBy: { column: 'created_at', order: 'desc' },
        }),
      },
    );
    if (!res.ok) return [];
    const items: any[] = await res.json();
    return items.map((i) => ({
      name: i.name,
      created_at: i.created_at ?? i.updated_at ?? '',
      size: i.metadata?.size ?? 0,
      path: `${cleanPhone}/${i.name}`,
    }));
  } catch {
    return [];
  }
}

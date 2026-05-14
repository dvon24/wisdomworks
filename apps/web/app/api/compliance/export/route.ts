/**
 * Story 6.7 — GDPR/CCPA Data Export.
 *
 * GET /api/compliance/export?phone=<tenant_phone>
 *
 * Bundles every row we've stored about a tenant into a single JSON document
 * the tenant can download. Iterates the canonical tenant-table list from
 * list_tenant_tables() (migration 14g), queries each, combines into the
 * export bundle.
 *
 * Audit-logged via the hash-chained ledger so there's a tamper-evident
 * record of who requested the export and when.
 *
 * Admin-gated (OWNER_API_TOKEN) for now. When the deck grows a
 * "Download my data" button, the auth check shifts to the session cookie
 * + a tenant-self-export check.
 *
 * NOT streamed — pulls all rows into memory then returns. Fine for typical
 * tenant sizes; a future iteration could chunk into a zip file uploaded
 * to Supabase Storage with a signed download URL for very large tenants.
 */

import { logAuditEvent } from '../../_lib/audit-log';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

interface TenantTable {
  table_name: string;
  tenant_column: string;
}

export async function GET(request: Request) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return Response.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  // Admin auth — temporary. Will shift to session-cookie + self-export when
  // the deck gets a "Download my data" button.
  const auth = request.headers.get('authorization');
  const ownerToken = process.env.OWNER_API_TOKEN;
  if (!ownerToken || !auth?.startsWith('Bearer ') || auth.slice(7) !== ownerToken) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const phone = url.searchParams.get('phone');
  if (!phone) return Response.json({ error: 'phone required' }, { status: 400 });
  const cleanPhone = phone.replace(/[\s\-+()]/g, '');

  try {
    // Load the canonical tenant-table list from the DB so we only have one
    // source of truth (the list_tenant_tables RPC from migration 14g).
    const listRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/list_tenant_tables`, {
      method: 'POST',
      headers: headers(),
      body: '{}',
    });
    if (!listRes.ok) {
      return Response.json({ error: 'failed to load table list' }, { status: 500 });
    }
    const tables: TenantTable[] = await listRes.json();

    const bundle: Record<string, unknown> = {
      export_meta: {
        tenant_phone: cleanPhone,
        exported_at: new Date().toISOString(),
        format_version: 1,
        table_count: tables.length,
      },
      data: {} as Record<string, unknown[]>,
    };
    let totalRows = 0;
    const failedTables: string[] = [];

    for (const t of tables) {
      try {
        const tRes = await fetch(
          `${SUPABASE_URL}/rest/v1/${t.table_name}?${t.tenant_column}=eq.${cleanPhone}`,
          { headers: headers() },
        );
        if (!tRes.ok) {
          failedTables.push(t.table_name);
          continue;
        }
        const rows = await tRes.json();
        (bundle.data as Record<string, unknown[]>)[t.table_name] = rows;
        totalRows += Array.isArray(rows) ? rows.length : 0;
      } catch (err) {
        console.warn(`[compliance-export] table ${t.table_name} failed:`, err);
        failedTables.push(t.table_name);
      }
    }

    (bundle.export_meta as Record<string, unknown>).total_rows = totalRows;
    if (failedTables.length > 0) {
      (bundle.export_meta as Record<string, unknown>).failed_tables = failedTables;
    }

    // Audit-log the export. This is a security-relevant event — a copy of
    // ALL the tenant's data left the system.
    void logAuditEvent({
      tenantPhone: cleanPhone,
      actor: 'admin (OWNER_API_TOKEN)',
      actorType: 'admin',
      action: 'data.export',
      resource: '/api/compliance/export',
      outcome: failedTables.length > 0 ? 'failure' : 'success',
      payload: {
        total_rows: totalRows,
        tables_exported: tables.length - failedTables.length,
        failed_tables: failedTables.length > 0 ? failedTables : undefined,
      },
    });

    return new Response(JSON.stringify(bundle, null, 2), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'content-disposition': `attachment; filename="wisdomworks-export-${cleanPhone}-${Date.now()}.json"`,
      },
    });
  } catch (err: any) {
    console.error('[compliance-export] error:', err);
    return Response.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}

/**
 * Credential access audit.
 *
 * Every time an agent / tool / cron decrypts a stored credential to call
 * an external API, we log it. Append-only. Powers forensics if a
 * credential is ever suspected compromised.
 *
 * Best-effort writes — if Supabase is down or the row insert fails, the
 * caller still gets the decrypted token (we never block on audit). Errors
 * are warned, not thrown.
 */

import { decryptToken } from '@wisdomworks/shared';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

export type ConnectionType = 'oauth_connection' | 'project_connection';

export interface AuditContext {
  tenantPhone: string;
  connectionType: ConnectionType;
  connectionId: string;
  /** Who triggered the access — 'cron:project-sync', 'tool:read_repo_file', etc. */
  caller: string;
  callerContext?: string;
  agentInstanceId?: string;
  agentRunId?: string;
}

async function writeAuditRow(ctx: AuditContext, ok: boolean, error?: string): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/credential_access_log`, {
      method: 'POST',
      headers: { ...headers(), Prefer: 'return=minimal' },
      body: JSON.stringify({
        tenant_phone: ctx.tenantPhone,
        connection_type: ctx.connectionType,
        connection_id: ctx.connectionId,
        caller: ctx.caller.slice(0, 100),
        caller_context: ctx.callerContext?.slice(0, 200) ?? null,
        agent_instance_id: ctx.agentInstanceId ?? null,
        agent_run_id: ctx.agentRunId ?? null,
        ok,
        error: error?.slice(0, 200) ?? null,
      }),
    });
  } catch (err) {
    // Audit failure must never block the actual operation
    console.warn('[credential-audit] write failed:', err);
  }
}

/**
 * Decrypt a stored credential and write an audit row. Use this everywhere
 * a credential is decrypted for an outbound API call. Returns the
 * plaintext token (or throws if decryption fails).
 */
export async function auditedDecrypt(encryptedValue: string, ctx: AuditContext): Promise<string> {
  try {
    const decrypted = await decryptToken(encryptedValue);
    // Fire-and-forget audit so we never delay the API call
    void writeAuditRow(ctx, true);
    return decrypted;
  } catch (err: any) {
    void writeAuditRow(ctx, false, err?.message ?? String(err));
    throw err;
  }
}

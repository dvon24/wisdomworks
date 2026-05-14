/**
 * Story 6.8 — HMAC row signatures.
 *
 * Computes HMAC-SHA256 over a canonical JSON representation of a row's
 * sensitive fields using the HMAC_ROW_SECRET env var. Symmetric: the same
 * fields hashed with the same key produce the same HMAC, so verify-on-read
 * is just "recompute + compare."
 *
 * Canonical form is JSON.stringify on a sorted-keys object. Keep the field
 * list per row-type STABLE — changing it would invalidate every prior
 * HMAC. If you need to add/remove a field from the signed set, bump the
 * version prefix and handle both during a transition window.
 */

import { createHmac } from 'node:crypto';

const HMAC_VERSION = 'v1';

function getSecret(): string {
  const secret = process.env.HMAC_ROW_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('HMAC_ROW_SECRET env var missing or too short (need >=32 chars)');
  }
  return secret;
}

/**
 * Produce the canonical text that gets HMAC'd. Sorted-keys JSON over the
 * provided fields, prefixed with the HMAC version so we can rotate the
 * signing schema later.
 */
function canonicalize(fields: Record<string, unknown>): string {
  const sortedKeys = Object.keys(fields).sort();
  const sorted: Record<string, unknown> = {};
  for (const k of sortedKeys) {
    sorted[k] = fields[k];
  }
  return `${HMAC_VERSION}:${JSON.stringify(sorted)}`;
}

/**
 * Compute the HMAC-SHA256 over the canonical fields. Returns hex string
 * suitable for storing in a TEXT column.
 */
export function computeRowHmac(fields: Record<string, unknown>): string {
  const canonical = canonicalize(fields);
  return createHmac('sha256', getSecret()).update(canonical).digest('hex');
}

/**
 * Verify a stored HMAC against the fields. Returns:
 *   { verified: true }                 — HMAC matches
 *   { verified: false, reason: '...' } — HMAC mismatch or unsigned row
 *
 * Pass `treatUnsignedAsLegacy: true` (default) during Phase A to NOT fail
 * on rows with NULL/empty stored HMACs (those are pre-backfill legacy
 * rows). Flip to `false` after backfill to treat unsigned rows as errors.
 */
export function verifyRowHmac(
  fields: Record<string, unknown>,
  stored: string | null | undefined,
  options: { treatUnsignedAsLegacy?: boolean } = {},
): { verified: boolean; reason?: 'legacy_unsigned' | 'hmac_mismatch' } {
  const legacyOk = options.treatUnsignedAsLegacy ?? true;
  if (!stored) {
    return legacyOk
      ? { verified: false, reason: 'legacy_unsigned' }
      : { verified: false, reason: 'legacy_unsigned' };
  }
  const expected = computeRowHmac(fields);
  if (expected === stored) return { verified: true };
  return { verified: false, reason: 'hmac_mismatch' };
}

/**
 * Helpers for the specific tables in scope. Each one defines the canonical
 * field set for that row type. CHANGING THESE FIELDS is a breaking change —
 * every existing row's HMAC becomes invalid. If you must change, bump
 * HMAC_VERSION and run a migration to re-sign during transition.
 */

export interface OAuthConnectionHmacFields {
  phone_number: string;
  provider: string;
  service: string;
  account_email: string | null;
  access_token: string;         // already encrypted at rest with TOKEN_ENCRYPTION_KEY; we HMAC the ciphertext
  refresh_token: string | null;
  status: string;
}

export function computeOAuthConnectionHmac(row: OAuthConnectionHmacFields): string {
  return computeRowHmac({
    type: 'oauth_connection',
    phone_number: row.phone_number,
    provider: row.provider,
    service: row.service,
    account_email: row.account_email,
    access_token: row.access_token,
    refresh_token: row.refresh_token,
    status: row.status,
  });
}

export interface ProjectConnectionHmacFields {
  tenant_phone: string;
  provider: string;
  project_id: string;
  display_name: string | null;
  access_token: string;
  refresh_token: string | null;
  status: string;
}

export function computeProjectConnectionHmac(row: ProjectConnectionHmacFields): string {
  return computeRowHmac({
    type: 'project_connection',
    tenant_phone: row.tenant_phone,
    provider: row.provider,
    project_id: row.project_id,
    display_name: row.display_name,
    access_token: row.access_token,
    refresh_token: row.refresh_token,
    status: row.status,
  });
}

export interface ComplianceProfileHmacFields {
  tenant_phone: string;
  frameworks: string[];
  signed_agreements: unknown[];     // jsonb — pass the actual array
  activation_gates: string[];
  egress_allowlist: string[] | null;
}

export function computeComplianceProfileHmac(row: ComplianceProfileHmacFields): string {
  return computeRowHmac({
    type: 'compliance_profile',
    tenant_phone: row.tenant_phone,
    frameworks: [...row.frameworks].sort(),  // order-independent
    signed_agreements: row.signed_agreements,
    activation_gates: [...row.activation_gates].sort(),
    egress_allowlist: row.egress_allowlist ? [...row.egress_allowlist].sort() : null,
  });
}

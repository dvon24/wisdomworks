/**
 * Story 6.12 — Per-tenant outbound egress allowlist (Pattern 4).
 *
 * Inspects the destination URL of every outbound fetch made on behalf of
 * a tenant against that tenant's compliance profile's egress_allowlist.
 *
 * Three modes:
 *   - profile absent / egress_allowlist NULL → unrestricted (default for
 *     non-compliance-bound tenants). Pass-through.
 *   - egress_allowlist == [] → deny-all. Useful for paranoid tenants and
 *     during incident response.
 *   - egress_allowlist == [domain, ...] → allow only matching domains.
 *     Subdomain match: "api.stripe.com" allowed, "stripe.com" entry
 *     does NOT auto-allow subdomains — be explicit.
 *
 * Every blocked call emits a `governance.bypass` audit event so the
 * tenant can see what was attempted (and what tool tried it).
 *
 * Designed as a thin wrapper around fetch. Call sites that need to make
 * tenant-scoped outbound calls should use guardedFetch instead of
 * native fetch.
 */

import { loadComplianceProfile } from './compliance-profile';
import { logAuditEvent } from './audit-log';

export interface EgressDecision {
  allowed: boolean;
  reason?: string;
  policyMode: 'unrestricted' | 'allowlist' | 'deny_all';
}

/**
 * Check whether a URL is permitted for the given tenant. Pure decision
 * function — does not log. Use guardedFetch for the logging + blocking
 * combination.
 */
export async function checkEgressPolicy(
  tenantPhone: string,
  targetUrl: string,
): Promise<EgressDecision> {
  let host: string;
  try {
    host = new URL(targetUrl).hostname.toLowerCase();
  } catch {
    return { allowed: false, reason: 'invalid URL', policyMode: 'allowlist' };
  }

  const profile = await loadComplianceProfile(tenantPhone);
  // No profile or no egress restriction → unrestricted.
  if (!profile || profile.egressAllowlist === null) {
    return { allowed: true, policyMode: 'unrestricted' };
  }
  if (profile.egressAllowlist.length === 0) {
    return { allowed: false, reason: 'tenant policy denies all outbound', policyMode: 'deny_all' };
  }
  // Exact match. We intentionally don't do subdomain magic — be explicit
  // about which subdomains are allowed.
  const allowed = profile.egressAllowlist.some((d) => d.toLowerCase() === host);
  return {
    allowed,
    reason: allowed ? undefined : `domain ${host} not in tenant allowlist`,
    policyMode: 'allowlist',
  };
}

/**
 * Wrapper around fetch() that applies the tenant's egress policy before
 * sending the request. Blocked calls return a synthetic Response with
 * status 451 (Unavailable For Legal Reasons) and emit an audit event.
 *
 * Use this instead of native fetch() for ANY tenant-scoped outbound
 * call (third-party APIs, webhook deliveries, model providers when we
 * support private-cloud routing).
 */
export async function guardedFetch(
  tenantPhone: string,
  input: string | URL,
  init?: RequestInit,
  context?: { actor?: string; actorType?: 'agent' | 'system'; toolName?: string },
): Promise<Response> {
  const targetUrl = typeof input === 'string' ? input : input.toString();
  const decision = await checkEgressPolicy(tenantPhone, targetUrl);

  if (!decision.allowed) {
    // Audit the blocked call so the tenant has a record.
    void logAuditEvent({
      tenantPhone,
      actor: context?.actor ?? 'system',
      actorType: context?.actorType ?? 'system',
      action: 'governance.bypass',
      resource: targetUrl,
      outcome: 'blocked',
      payload: {
        reason: decision.reason ?? 'egress policy violation',
        policy_mode: decision.policyMode,
        tool: context?.toolName,
      },
    });
    return new Response(
      JSON.stringify({
        error: 'egress_blocked',
        reason: decision.reason ?? 'tenant compliance policy blocks this destination',
        policy_mode: decision.policyMode,
      }),
      { status: 451, headers: { 'content-type': 'application/json' } },
    );
  }

  return fetch(input, init);
}

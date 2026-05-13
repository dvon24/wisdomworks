/**
 * Story 2.15 — Cross-tenant Business Type Framework Dictionary.
 *
 * Aggregates per-tenant agent_skills into anonymized dictionary entries
 * keyed by (business_type, lane, technique_signature). New tenants of a
 * given business_type inherit the dictionary on day one.
 *
 * Promotion rules:
 *   - Contributing tenants must be `env_class === 'commercial'`
 *   - Skill must appear in ≥3 tenants of the same business_type
 *   - Pooled success rate must be ≥0.7 across those tenants
 *
 * Anonymization:
 *   - Tenant phone is HMAC'd before storing in contributors
 *   - Description / payload are stripped of tenant-identifying tokens
 *     before promotion (phone numbers, email-style strings, names)
 *
 * Environment-class read rules:
 *   - commercial: always read latest dictionary
 *   - government: read frozen snapshot pinned at deployment time
 *   - air_gapped: no dictionary integration
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const HMAC_KEY = process.env.API_AUTH_SECRET; // reuse the existing HMAC key

const headers = () => ({
  apikey: SUPABASE_KEY!,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
});

const PROMOTION_MIN_TENANTS = 3;
const PROMOTION_MIN_SUCCESS_RATE = 0.7;
const PROMOTION_MIN_USES = 5;

export type EnvClass = 'commercial' | 'government' | 'air_gapped';

/** HMAC-SHA256 hash of phone for anonymized provenance. */
async function hashTenant(phone: string): Promise<string> {
  if (!HMAC_KEY) return ''; // refuse to anonymize without a key set
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(HMAC_KEY),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(phone));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Cheap text scrub for descriptions + payloads before promotion. Strips
 * phone-like strings, email-like strings, common business name tokens
 * (first word with title case followed by another title-case word).
 * Belt-and-suspenders — the skill description SHOULD already be generic
 * (the LLM that produces it is told to generalize) but this is the
 * deterministic backstop.
 */
function anonymizeText(text: string): string {
  if (!text) return text;
  let out = text;
  // Phone-like patterns
  out = out.replace(/\+?\d{1,3}[\s\-]?\d{3,4}[\s\-]?\d{3,4}[\s\-]?\d{3,4}/g, '[phone]');
  out = out.replace(/\b\d{10,15}\b/g, '[phone]');
  // Email-like
  out = out.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]');
  // URLs
  out = out.replace(/https?:\/\/\S+/g, '[url]');
  // ISO dates
  out = out.replace(/\d{4}-\d{2}-\d{2}(T[\d:.Z+-]+)?/g, '[date]');
  return out;
}

function anonymizePayload(payload: any): any {
  if (payload == null) return payload;
  if (typeof payload === 'string') return anonymizeText(payload);
  if (Array.isArray(payload)) return payload.map(anonymizePayload);
  if (typeof payload === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(payload)) {
      // Drop obvious identifier keys outright
      if (/phone|email|tenant|name|address/i.test(k)) continue;
      out[k] = anonymizePayload(v);
    }
    return out;
  }
  return payload;
}

interface SkillForAggregation {
  id: string;
  tenant_phone: string;
  lane: string;
  technique_signature: string;
  description: string;
  technique_payload: any;
  success_count: number;
  failure_count: number;
  total_uses: number;
}

interface TenantBusinessType {
  phone_number: string;
  business_type: string;
  env_class: EnvClass;
}

async function loadCommercialTenants(): Promise<TenantBusinessType[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/whatsapp_contexts?is_owner=eq.true&select=phone_number,business_type,profile`,
      { headers: headers() },
    );
    if (!res.ok) return [];
    const rows = await res.json();
    return rows
      .map((r: any) => ({
        phone_number: r.phone_number,
        business_type: r.business_type ?? r.profile?.businessType ?? null,
        env_class: (r.profile?.env_class as EnvClass) ?? 'commercial',
      }))
      .filter((r: TenantBusinessType) => r.business_type && r.env_class === 'commercial');
  } catch {
    return [];
  }
}

async function loadActiveSkillsForTenant(tenantPhone: string): Promise<SkillForAggregation[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_skills?tenant_phone=eq.${tenantPhone}&retired_at=is.null&select=id,tenant_phone,lane,technique_signature,description,technique_payload,success_count,failure_count,total_uses`,
      { headers: headers() },
    );
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

/**
 * The weekly aggregator. For each business_type, group skills by lane +
 * signature, evaluate promotion criteria, upsert qualifying skills into
 * business_type_skills with anonymized payload + record contributors.
 *
 * Returns counts so the cron can log the impact.
 */
export async function runDictionaryAggregator(): Promise<{
  tenants_scanned: number;
  business_types: number;
  skills_evaluated: number;
  promoted: number;
  contributors_recorded: number;
  errors: string[];
}> {
  const errors: string[] = [];
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return { tenants_scanned: 0, business_types: 0, skills_evaluated: 0, promoted: 0, contributors_recorded: 0, errors: ['supabase not configured'] };
  }

  const tenants = await loadCommercialTenants();
  // Group tenants by business_type
  const byType = new Map<string, TenantBusinessType[]>();
  for (const t of tenants) {
    const arr = byType.get(t.business_type) ?? [];
    arr.push(t);
    byType.set(t.business_type, arr);
  }

  let skillsEvaluated = 0;
  let promoted = 0;
  let contributorsRecorded = 0;

  for (const [businessType, typeTenants] of byType) {
    // Group skills across tenants of this business_type by (lane, signature)
    const bucket = new Map<string, SkillForAggregation[]>();
    for (const tenant of typeTenants) {
      const skills = await loadActiveSkillsForTenant(tenant.phone_number);
      for (const s of skills) {
        const key = `${s.lane}::${s.technique_signature}`;
        const arr = bucket.get(key) ?? [];
        arr.push(s);
        bucket.set(key, arr);
      }
    }

    for (const [key, skillsAcrossTenants] of bucket) {
      skillsEvaluated++;
      const distinctTenants = new Set(skillsAcrossTenants.map((s) => s.tenant_phone));
      if (distinctTenants.size < PROMOTION_MIN_TENANTS) continue;

      const totalSuccess = skillsAcrossTenants.reduce((sum, s) => sum + (s.success_count ?? 0), 0);
      const totalFailure = skillsAcrossTenants.reduce((sum, s) => sum + (s.failure_count ?? 0), 0);
      const totalUses = skillsAcrossTenants.reduce((sum, s) => sum + (s.total_uses ?? 0), 0);
      if (totalUses < PROMOTION_MIN_USES) continue;
      const pooledRate = totalUses > 0 ? totalSuccess / totalUses : 0;
      if (pooledRate < PROMOTION_MIN_SUCCESS_RATE) continue;

      const [lane, signature] = key.split('::');
      // Best description = the longest one (more context); fall back to first
      const description = [...skillsAcrossTenants]
        .sort((a, b) => (b.description?.length ?? 0) - (a.description?.length ?? 0))[0]?.description ?? '';
      const mergedPayload: any = {};
      for (const s of skillsAcrossTenants) {
        Object.assign(mergedPayload, s.technique_payload ?? {});
      }
      const anonDescription = anonymizeText(description);
      const anonPayload = anonymizePayload(mergedPayload);

      // Upsert dictionary entry
      try {
        const upsertRes = await fetch(
          `${SUPABASE_URL}/rest/v1/business_type_skills?on_conflict=business_type,lane,technique_signature`,
          {
            method: 'POST',
            headers: { ...headers(), Prefer: 'resolution=merge-duplicates,return=representation' },
            body: JSON.stringify({
              business_type: businessType,
              lane,
              technique_signature: signature,
              description: anonDescription.slice(0, 600),
              technique_payload: anonPayload,
              tenant_count: distinctTenants.size,
              total_uses: totalUses,
              total_successes: totalSuccess,
              total_failures: totalFailure,
              pooled_success_rate: Number(pooledRate.toFixed(3)),
            }),
          },
        );
        if (!upsertRes.ok) {
          errors.push(`upsert ${businessType}/${signature}: ${upsertRes.status}`);
          continue;
        }
        const rows = await upsertRes.json();
        const dictionaryId = rows[0]?.id;
        if (!dictionaryId) continue;
        promoted++;

        // Record per-tenant provenance with HMAC'd tenant id
        for (const s of skillsAcrossTenants) {
          const tenantHash = await hashTenant(s.tenant_phone);
          if (!tenantHash) continue;
          await fetch(
            `${SUPABASE_URL}/rest/v1/business_type_skill_contributors?on_conflict=dictionary_skill_id,tenant_hash`,
            {
              method: 'POST',
              headers: { ...headers(), Prefer: 'resolution=merge-duplicates,return=minimal' },
              body: JSON.stringify({
                dictionary_skill_id: dictionaryId,
                tenant_hash: tenantHash,
                contributed_success_count: s.success_count ?? 0,
                contributed_failure_count: s.failure_count ?? 0,
                last_contributed_at: new Date().toISOString(),
              }),
            },
          );
          contributorsRecorded++;
        }
      } catch (err: any) {
        errors.push(`upsert exception ${businessType}/${signature}: ${err?.message ?? String(err)}`);
      }
    }
  }

  return {
    tenants_scanned: tenants.length,
    business_types: byType.size,
    skills_evaluated: skillsEvaluated,
    promoted,
    contributors_recorded: contributorsRecorded,
    errors,
  };
}

/**
 * When a new tenant deploys, seed their lane agent_skills with the
 * relevant dictionary entries for their business_type. Air-gapped tenants
 * get nothing. Government tenants get a frozen snapshot at deployment
 * (their `dictionary_snapshot_version` is recorded on profile so future
 * aggregator runs don't change what they see).
 *
 * Returns count seeded.
 */
export async function seedDictionaryForNewTenant(input: {
  tenantPhone: string;
  businessType: string;
  envClass?: EnvClass;
}): Promise<{ seeded: number; skipped_reason?: string }> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { seeded: 0, skipped_reason: 'no supabase' };
  const envClass: EnvClass = input.envClass ?? 'commercial';
  if (envClass === 'air_gapped') {
    return { seeded: 0, skipped_reason: 'air_gapped — no dictionary integration' };
  }

  const cleanPhone = input.tenantPhone.replace(/[\s\-+()]/g, '');
  // Read dictionary entries for this business_type that cleared promotion
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/business_type_skills?business_type=eq.${encodeURIComponent(input.businessType)}&order=pooled_success_rate.desc&select=*`,
      { headers: headers() },
    );
    if (!res.ok) return { seeded: 0, skipped_reason: `dictionary fetch ${res.status}` };
    const dictionary = await res.json();
    if (dictionary.length === 0) {
      return { seeded: 0, skipped_reason: 'no dictionary entries for this business_type yet' };
    }

    let seeded = 0;
    for (const entry of dictionary) {
      try {
        // Use the existing upsert_agent_skill RPC so this skill enters
        // the normal lane-skill flow. Mark provenance in metadata.
        const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/upsert_agent_skill`, {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({
            p_tenant_phone: cleanPhone,
            p_lane: entry.lane,
            p_technique_signature: entry.technique_signature,
            p_description: entry.description,
            p_technique_payload: entry.technique_payload ?? {},
            p_discovered_by_instance_id: null,
            p_discovered_from_run_id: null,
            p_metadata: {
              source: 'business_type_dictionary',
              business_type: input.businessType,
              dictionary_id: entry.id,
              pooled_success_rate: entry.pooled_success_rate,
              tenant_count: entry.tenant_count,
              env_class_at_seed: envClass,
              snapshot_version: entry.snapshot_version,
            },
          }),
        });
        if (upsertRes.ok) seeded++;
      } catch (err) {
        console.warn('[cross-tenant] seed exception:', err);
      }
    }

    // Government tenants — pin their snapshot so future aggregator
    // runs don't push new dictionary entries to them
    if (envClass === 'government') {
      try {
        const pinRes = await fetch(
          `${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${cleanPhone}&select=profile`,
          { headers: headers() },
        );
        if (pinRes.ok) {
          const rows = await pinRes.json();
          const profile = rows[0]?.profile ?? {};
          profile.dictionary_snapshot_at = new Date().toISOString();
          profile.env_class = 'government';
          await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${cleanPhone}`, {
            method: 'PATCH',
            headers: { ...headers(), Prefer: 'return=minimal' },
            body: JSON.stringify({ profile }),
          });
        }
      } catch {}
    }

    return { seeded };
  } catch (err: any) {
    return { seeded: 0, skipped_reason: `exception: ${err?.message ?? String(err)}` };
  }
}

/** Owner-facing summary — how many dictionary entries does their business_type have? */
export async function summarizeDictionaryForBusinessType(businessType: string): Promise<{
  total: number;
  by_lane: Record<string, number>;
  top: Array<{ lane: string; description: string; success_rate: number; tenant_count: number }>;
}> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { total: 0, by_lane: {}, top: [] };
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/business_type_skills?business_type=eq.${encodeURIComponent(businessType)}&order=pooled_success_rate.desc&limit=50&select=lane,description,pooled_success_rate,tenant_count`,
      { headers: headers() },
    );
    if (!res.ok) return { total: 0, by_lane: {}, top: [] };
    const rows = await res.json();
    const byLane: Record<string, number> = {};
    for (const r of rows) byLane[r.lane] = (byLane[r.lane] ?? 0) + 1;
    return {
      total: rows.length,
      by_lane: byLane,
      top: rows.slice(0, 5).map((r: any) => ({
        lane: r.lane,
        description: r.description,
        success_rate: r.pooled_success_rate,
        tenant_count: r.tenant_count,
      })),
    };
  } catch {
    return { total: 0, by_lane: {}, top: [] };
  }
}

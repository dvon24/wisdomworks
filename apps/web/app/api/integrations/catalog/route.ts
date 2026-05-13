/**
 * Integration catalog API — drives the deck's Connections tab card grid
 * and any onboarding picker UI.
 *
 * GET /api/integrations/catalog?phone=<tenant_phone>
 *   Returns the live providers with `connected: true|false` per provider
 *   so the UI can render the right state.
 */

import { NextResponse } from 'next/server';
import { liveProviders, catalogForVertical } from '../../_lib/integration-catalog';
import { requireOwnerAuth } from '../../_lib/api-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const phone = url.searchParams.get('phone');
  const denied = await requireOwnerAuth(request, phone);
  if (denied) return denied;

  const cleanPhone = phone!.replace(/[\s\-+()]/g, '');

  // Find which providers the tenant has already connected
  const connectedSet = new Set<string>();
  let verticalLabel: string | null = null;
  if (SUPABASE_URL && SUPABASE_KEY) {
    try {
      const [connRes, ctxRes] = await Promise.all([
        fetch(
          `${SUPABASE_URL}/rest/v1/oauth_connections?phone_number=eq.${cleanPhone}&status=eq.active&select=provider`,
          { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
        ),
        fetch(
          `${SUPABASE_URL}/rest/v1/whatsapp_contexts?phone_number=eq.${cleanPhone}&select=profile`,
          { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
        ),
      ]);
      const connRows = connRes.ok ? await connRes.json() : [];
      for (const r of connRows) connectedSet.add(r.provider);
      const ctxRows = ctxRes.ok ? await ctxRes.json() : [];
      verticalLabel = ctxRows[0]?.profile?.vertical_template?.label ?? null;
    } catch {}
  }

  const all = liveProviders();
  const recommended = verticalLabel ? catalogForVertical(verticalLabel) : [];
  const recommendedIds = new Set(recommended.map((p) => p.provider));

  return NextResponse.json({
    vertical_label: verticalLabel,
    providers: all.map((p) => ({
      provider: p.provider,
      label: p.label,
      emoji: p.emoji,
      tagline: p.tagline,
      service: p.service,
      categories: p.categories,
      authMethod: p.authMethod,
      oauthPath: p.oauthPath,
      connected: connectedSet.has(p.provider),
      recommended: recommendedIds.has(p.provider),
      costNote: p.costNote ?? null,
    })),
  });
}

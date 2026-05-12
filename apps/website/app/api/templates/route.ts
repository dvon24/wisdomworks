/**
 * Vertical templates API — surfaces the picker payload for the
 * onboarding flow. The website renders a card per template at the
 * start of onboarding; clicking a card seeds the chat with that
 * vertical's pills and agent roster preview.
 *
 * Public read — no tenant data here, just the catalog.
 */

import { VERTICAL_TEMPLATES } from '@wisdomworks/shared';

export const dynamic = 'force-dynamic';

export async function GET() {
  const templates = VERTICAL_TEMPLATES.map((t) => ({
    id: t.label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z_]/g, ''),
    label: t.label,
    tagline: t.tagline,
    emoji: t.emoji,
    matches: t.matches,
    onboardingPills: t.onboardingPills,
    defaultAgents: t.defaultAgents.map((a) => ({
      role: a.role,
      name: a.name,
      tier: a.tier,
      description: a.description,
      required: a.required,
      lane: a.lane,
    })),
    recommendedTools: t.recommendedTools,
  }));

  return Response.json({ templates });
}
